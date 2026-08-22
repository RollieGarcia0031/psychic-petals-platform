#!/usr/bin/env node

/**
 * reset-novel.js — destructive "nuke and rebuild" database recovery tool.
 *
 * Unlike scripts/sync-novel.js (whose reconciliation only removes orphaned
 * chapter docs), this tool deletes EVERYTHING under each target novel
 * document — the root doc plus its `episodes` and `chapters` subcollections —
 * guaranteeing clean state: no stale empty episodes, no leftover metadata
 * fields. It then rebuilds every episode/chapter document purely from the
 * Markdown sources on disk, recalculating the totalWords rollups per episode
 * and novel.
 *
 * WARNING: the rebuild also wipes API-managed fields such as chapter `notes`
 * previously set through the dashboard. Only run this when the on-disk novel
 * content is known-good.
 *
 * Usage:
 *   node scripts/reset-novel.js --novel-dir <path> [--novel-id psychic_petals] [--lang tl] --yes
 *
 * Arguments:
 *   --novel-dir  (required) Path to the novel repository root (contains main/).
 *   --novel-id   Base Firestore novel document ID (default: psychic_petals).
 *                Language variants resolve to `{novel-id}_{lang}` documents.
 *   --lang       Optional two-letter language filter (e.g. `en`, `tl`) to
 *                reset only that version. `en` targets the base document;
 *                without it every language version found on disk is reset.
 *   --yes        Required confirmation flag. The script prints a summary of
 *                what will be deleted and refuses to run without it.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_NOVEL_ID } from '../utils/novelUtils.js';
import {
  MAX_FILE_SIZE,
  countWords,
  extractTitle,
  getAllMarkdownFiles,
  initializeFirestore,
  parseChapterPath,
  parseFrontmatter,
  refreshEpisodeTotals,
  resolveChapterLocation,
  resolveNovelId,
  upsertChapters,
  upsertNovelDocument,
} from './sync-novel.js';

const BOOLEAN_FLAGS = new Set(['yes']);
const VALUE_FLAGS = new Set(['novel-dir', 'novel-id', 'lang']);

/** Parse the command-line arguments accepted by this script. */
export function parseResetArguments(argv) {
  const options = {};
  const flags = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;

    const key = argument.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    if (!VALUE_FLAGS.has(key)) {
      throw new Error(`Unknown argument: --${key}.`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = value;
    index += 1;
  }

  if (!options['novel-dir']) {
    throw new Error('Missing required --novel-dir argument.');
  }

  const lang = options.lang?.trim().toLowerCase() || null;
  if (options.lang !== undefined && !/^[a-z]{2}$/.test(lang)) {
    throw new Error('--lang must be a two-letter lowercase language code (e.g. en, tl).');
  }

  const novelId = options['novel-id']?.trim();
  if (options['novel-id'] !== undefined && !novelId) {
    throw new Error('--novel-id must not be empty.');
  }

  return {
    novelDir: options['novel-dir'],
    novelId: novelId || DEFAULT_NOVEL_ID,
    lang,
    assumeYes: flags.has('yes'),
  };
}

/**
 * Determine which novel documents to reset from the chapters found on disk.
 * English always targets the base document; every other discovered language
 * targets its `{novelId}_{lang}` suffix. With a `--lang` filter only that
 * single version is selected.
 */
export function discoverResetTargets(chapters, baseNovelId, langFilter = null) {
  const languages = new Set(['en']);
  for (const chapter of chapters) {
    languages.add(chapter.language);
  }

  const selected = langFilter ? [langFilter] : [...languages].sort();
  return selected.map((language) => ({
    language,
    novelId: resolveNovelId(baseNovelId, language),
  }));
}

/**
 * Scan ALL chapter files under `{novelDir}/main` across every language
 * directory and parse them into chapter objects, applying path-derived values
 * with frontmatter precedence exactly like scripts/sync-novel.js. Empty,
 * unreadable-oversized, or non-chapter files are skipped so they cannot wipe
 * valid data during the rebuild.
 */
export async function loadChaptersFromDisk(novelDir) {
  const canonicalNovelDir = await realpath(novelDir);
  const files = (await getAllMarkdownFiles(path.join(canonicalNovelDir, 'main'))).sort();

  const chapters = [];
  for (const file of files) {
    const relativePath = path.relative(canonicalNovelDir, file)
      .split(path.sep)
      .join('/');

    const pathLocation = parseChapterPath(relativePath);
    if (!pathLocation) {
      console.warn(`Reset: skipping unsupported story path: ${relativePath}`);
      continue;
    }

    const fileStat = await stat(file);
    if (fileStat.size > MAX_FILE_SIZE) {
      console.warn(
        `Reset: skipping oversized story file (${fileStat.size} bytes > ${MAX_FILE_SIZE}): ${relativePath}`,
      );
      continue;
    }

    const content = await readFile(file, 'utf8');
    if (!content.trim()) {
      console.warn(`Reset: skipping empty chapter file: ${relativePath}`);
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    const location = resolveChapterLocation(pathLocation, frontmatter);

    chapters.push({
      ...location,
      title: frontmatter?.title ?? extractTitle(content, `Chapter ${location.chapterNumber}`),
      status: frontmatter?.status ?? '',
      translationOf: frontmatter?.translationOf ?? '',
      content,
      wordCount: countWords(content),
    });
  }
  return chapters;
}

/** Read-only inspection of a novel document for the pre-wipe summary. */
export async function inspectNovel(novelRef) {
  const rootSnapshot = await novelRef.get();
  const episodesSnapshot = await novelRef.collection('episodes').get();

  let chapterCount = 0;
  for (const epDoc of episodesSnapshot.docs) {
    const chaptersSnapshot = await epDoc.ref.collection('chapters').get();
    chapterCount += chaptersSnapshot.docs.length;
  }

  return {
    exists: rootSnapshot.exists,
    episodeCount: episodesSnapshot.docs.length,
    chapterCount,
  };
}

/** Build the human-readable summary lines printed before any deletion. */
export function formatResetSummary(targets, inspectionsByNovelId) {
  const lines = [
    `About to DELETE AND REBUILD ${targets.length} novel document(s):`,
    'All stored chapter fields will be rewritten from disk — API-managed fields such as `notes` WILL BE LOST.',
  ];
  for (const target of targets) {
    const info =
      inspectionsByNovelId[target.novelId] ??
      { exists: false, episodeCount: 0, chapterCount: 0 };
    lines.push(
      `  novels/${target.novelId} (${target.language}): ${info.exists ? 'exists' : 'missing'} — ` +
        `${info.episodeCount} episode(s), ${info.chapterCount} chapter(s) to delete`,
    );
  }
  return lines;
}

/**
 * Delete everything under one novel document: all chapter docs, then all
 * episode docs, then the root doc itself. Unlike sync reconciliation this
 * guarantees no stale empty episodes or leftover metadata survive.
 */
export async function wipeNovel(novelRef) {
  let deletedEpisodes = 0;
  let deletedChapters = 0;

  const episodesSnapshot = await novelRef.collection('episodes').get();
  for (const epDoc of episodesSnapshot.docs) {
    const chaptersSnapshot = await epDoc.ref.collection('chapters').get();
    for (const chDoc of chaptersSnapshot.docs) {
      await chDoc.ref.delete();
      deletedChapters += 1;
    }
    await epDoc.ref.delete();
    deletedEpisodes += 1;
  }

  await novelRef.delete();
  return { deletedEpisodes, deletedChapters };
}

/**
 * Full rebuild of one novel document from disk-sourced chapters: recreate
 * episode docs (auto-created by upsertChapters), rewrite every chapter doc
 * fresh (notes reset to ''), recalculate totalWords rollups per episode via
 * refreshEpisodeTotals, and rebuild the root metadata document via
 * upsertNovelDocument. Returns summary stats for logging/tests.
 */
export async function rebuildNovel(db, novelRef, chapters, { language, timestamp }) {
  await upsertChapters(db, novelRef, chapters, timestamp);

  const episodesSnapshot = await novelRef.collection('episodes').get();
  const episodeNumbers = episodesSnapshot.docs
    .map((epDoc) => Number.parseInt(epDoc.id, 10))
    .filter((num) => !Number.isNaN(num));
  await refreshEpisodeTotals(novelRef, episodeNumbers);

  const novelDoc = await upsertNovelDocument(novelRef, { language, timestamp });

  return {
    writtenChapters: chapters.length,
    episodeCount: episodeNumbers.length,
    totalWords: novelDoc.metadata.totalWords,
  };
}

/**
 * Orchestration entry point, separated from main() so tests can drive it
 * with explicit argv instead of mutating process.argv.
 */
export async function runReset(argv) {
  const { novelDir, novelId, lang, assumeYes } = parseResetArguments(argv);

  // Defence against a mistyped --novel-dir: even --yes refuses to operate on
  // a directory that has no main/ folder underneath it.
  let canonicalNovelDir;
  try {
    canonicalNovelDir = await realpath(novelDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Novel directory not found: ${novelDir}`);
    }
    throw error;
  }

  let hasMainDir = false;
  try {
    hasMainDir = (await stat(path.join(canonicalNovelDir, 'main'))).isDirectory();
  } catch {
    hasMainDir = false;
  }
  if (!hasMainDir) {
    throw new Error(`No main/ directory under ${canonicalNovelDir}; refusing to reset.`);
  }

  // Scan the full tree once; every target version filters out its own slice.
  const allChapters = await loadChaptersFromDisk(canonicalNovelDir);
  const targets = discoverResetTargets(allChapters, novelId, lang);

  const db = initializeFirestore();
  const timestamp = new Date().toISOString();

  // Read-only inspection pass feeding the confirmation summary.
  const inspectionsByNovelId = {};
  for (const target of targets) {
    inspectionsByNovelId[target.novelId] = await inspectNovel(
      db.collection('novels').doc(target.novelId),
    );
  }

  for (const line of formatResetSummary(targets, inspectionsByNovelId)) {
    console.log(line);
  }

  // Destructive-action guard: refuse without explicit confirmation.
  if (!assumeYes) {
    console.error('\nRefusing to reset without the --yes confirmation flag.');
    process.exitCode = 1;
    return { ok: false, reason: 'missing-confirmation', targets };
  }

  const results = [];
  for (const target of targets) {
    const novelRef = db.collection('novels').doc(target.novelId);
    const chapters = allChapters.filter(
      (chapter) => resolveNovelId(novelId, chapter.language) === target.novelId,
    );

    const wiped = await wipeNovel(novelRef);
    const rebuilt = await rebuildNovel(db, novelRef, chapters, {
      language: target.language,
      timestamp,
    });

    console.log(
      `Reset novels/${target.novelId} (${target.language}): deleted ${wiped.deletedEpisodes} episode(s)/${wiped.deletedChapters} chapter(s); ` +
        `rebuilt ${rebuilt.writtenChapters} chapter(s) across ${rebuilt.episodeCount} episode(s), ${rebuilt.totalWords} words.`,
    );
    results.push({ ...target, wiped, rebuilt });
  }

  return { ok: true, targets, results };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  runReset(process.argv.slice(2)).catch((error) => {
    console.error(`Novel reset failed: ${error.message}`);
    process.exitCode = 1;
  });
}
