#!/usr/bin/env node

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_NOVEL_ID, buildNovelDocument } from '../utils/novelUtils.js';

/** Maximum size in bytes of a single chapter file before it is rejected. */
export const MAX_FILE_SIZE = 512 * 1024;

/** Maximum operations allowed in a single Firestore batch (Firestore caps at 500). */
export const MAX_BATCH_OPERATIONS = 500;

/** Frontmatter keys recognised by the chapter parser; everything else is ignored. */
const FRONTMATTER_KEYS = new Set(['title', 'episode', 'chapter', 'status', 'translationOf']);

/** Split an array into chunks of at most `size` items each. */
export function chunk(array, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got: ${size}`);
  }
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

/** Parse the command-line arguments accepted by this script. */
export function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;

    const key = argument.slice(2);
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

  const novelId = options['novel-id']?.trim();
  if (options['novel-id'] !== undefined && !novelId) {
    throw new Error('--novel-id must not be empty.');
  }

  return {
    novelDir: options['novel-dir'],
    novelId: novelId || DEFAULT_NOVEL_ID,
    changedFiles: (options.changed ?? '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
    deletedFiles: (options.deleted ?? '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
  };
}

/**
 * Resolve the Firestore novel document ID for a story language.
 *
 * English (explicit prefix or legacy bare layout) maps to the base novel ID;
 * every other language gets its own suffixed document (e.g. `psychic_petals_tl`).
 */
export function resolveNovelId(baseNovelId, language) {
  if (!language || language === 'en') return baseNovelId;
  return `${baseNovelId}_${language}`;
}

/**
 * Convert a story path into its Firestore location.
 *
 * Accepted layouts (both numeric prefixes required for stable locations):
 *   main/episode-NN/NN-slug.md        (legacy English)
 *   main/en/episode-NN/NN-slug.md     (English)
 *   main/tl/episode-NN/NN-slug.md     (any two-letter lowercase language prefix)
 *
 * The returned `language` defaults to 'en' for legacy unprefixed paths.
 */
export function parseChapterPath(filePath) {
  // Normalise separators so the regex works on any platform.
  const normalizedPath = filePath.split(path.sep).join('/').replace(/\\/g, '/');
  const match = normalizedPath.match(/^main(?:\/([a-z]{2}))?\/episode-(\d+)\/(\d+)-(.+)\.md$/);
  if (!match) return null;

  return {
    language: match[1] ?? 'en',
    episodeNumber: Number.parseInt(match[2], 10),
    chapterNumber: Number.parseInt(match[3], 10),
    slug: match[4],
  };
}

/**
 * Minimal hand-rolled YAML frontmatter parser (no dependencies).
 *
 * Recognises a leading `---` fence containing flat `key: value` pairs and
 * returns only the keys in FRONTMATTER_KEYS (`title`, `episode`, `chapter`,
 * `status`, `translationOf`). Numeric values are coerced to integers,
 * surrounding quotes are stripped, and blank/unknown lines are ignored.
 * Returns null when the content has no valid frontmatter fence.
 */
export function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) return null;

  const data = {};
  for (const line of lines.slice(1, closeIndex)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    if (!FRONTMATTER_KEYS.has(key)) continue;

    const rawValue = line.slice(colonIndex + 1).trim();
    if (!rawValue) continue;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');

    if (key === 'episode' || key === 'chapter') {
      if (!/^\d+$/.test(value)) continue;
      data[key] = Number.parseInt(value, 10);
      continue;
    }
    data[key] = value;
  }
  return data;
}

/**
 * Merge frontmatter overrides into a path-derived location.
 * Frontmatter values win; absent values keep the path-derived ones.
 */
export function resolveChapterLocation(pathLocation, frontmatter) {
  if (!frontmatter) return { ...pathLocation };
  return {
    ...pathLocation,
    episodeNumber: frontmatter.episode ?? pathLocation.episodeNumber,
    chapterNumber: frontmatter.chapter ?? pathLocation.chapterNumber,
  };
}

/** Extract a readable chapter title from the first level-one Markdown heading. */
export function extractTitle(content, fallbackTitle) {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1];
  if (!heading) return fallbackTitle;

  const title = heading
    .replace(/<\/?center>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();

  return title || fallbackTitle;
}

/** Recursively find all Markdown files in a directory. */
export async function getAllMarkdownFiles(dir) {
  const files = [];
  async function scan(currentDir) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  await scan(dir);
  return files;
}

export function countWords(content) {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Return true when resolvedPath is strictly inside baseDir.
 * Used as a defence-in-depth check against path traversal in readChangedChapters.
 */
export function isInsideDir(baseDir, resolvedPath) {
  const base = path.resolve(baseDir);
  return resolvedPath.startsWith(base + path.sep);
}

export async function readChangedChapters(novelDir, changedFiles) {
  const chapters = [];
  const extraDeletedFiles = [];

  let canonicalNovelDir;
  try {
    canonicalNovelDir = await realpath(novelDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn(`Skipping sync, novel directory not found: ${novelDir}`);
      return { chapters, extraDeletedFiles };
    }
    throw error;
  }

  for (const filePath of changedFiles) {
    const pathLocation = parseChapterPath(filePath);
    if (!pathLocation) {
      console.warn(`Skipping unsupported story path: ${filePath}`);
      continue;
    }

    const resolvedFilePath = path.resolve(canonicalNovelDir, filePath);
    if (!isInsideDir(canonicalNovelDir, resolvedFilePath)) {
      console.warn(`Skipping path that escapes novel directory: ${filePath}`);
      continue;
    }

    let canonicalFilePath;
    try {
      canonicalFilePath = await realpath(resolvedFilePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        console.warn(`Detected deleted story path: ${filePath}`);
        extraDeletedFiles.push(filePath);
        continue;
      }
      throw error;
    }

    if (!isInsideDir(canonicalNovelDir, canonicalFilePath)) {
      console.warn(`Skipping path that escapes novel directory via symlink: ${filePath}`);
      continue;
    }

    const fileStat = await stat(canonicalFilePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      console.warn(
        `Skipping oversized story file (${fileStat.size} bytes > ${MAX_FILE_SIZE}): ${filePath}`,
      );
      continue;
    }

    let content;
    try {
      content = await readFile(canonicalFilePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        console.warn(`Detected deleted story path: ${filePath}`);
        extraDeletedFiles.push(filePath);
        continue;
      }
      throw error;
    }

    if (!content || content.trim() === '') {
      console.warn(`Detected empty chapter content, marking for deletion: ${filePath}`);
      extraDeletedFiles.push(filePath);
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
  return { chapters, extraDeletedFiles };
}

/** Delete removed chapters from Firestore. */
export async function deleteChapters(novelRef, deletedFiles) {
  const deletedChapters = [];
  for (const filePath of deletedFiles) {
    const location = parseChapterPath(filePath);
    if (!location) {
      console.warn(`Skipping unsupported deleted story path: ${filePath}`);
      continue;
    }

    const chapterRef = novelRef
      .collection('episodes')
      .doc(location.episodeNumber.toString())
      .collection('chapters')
      .doc(location.chapterNumber.toString());

    await chapterRef.delete();
    deletedChapters.push(location);
  }
  return deletedChapters;
}

/**
 * Bucket chapters by the Firestore novel document they belong to.
 * Returns `{ [resolvedNovelId]: { language, chapters[] } }` so each language
 * version can be reconciled independently.
 */
export function groupChaptersByNovel(chapters, baseNovelId) {
  const groups = {};
  for (const chapter of chapters) {
    const novelId = resolveNovelId(baseNovelId, chapter.language);
    if (!groups[novelId]) {
      groups[novelId] = { language: chapter.language, chapters: [] };
    }
    groups[novelId].chapters.push(chapter);
  }
  return groups;
}

/**
 * Group deleted story paths by their resolved novel document ID so deletions
 * land in the correct language version. Unparsable paths are skipped — they
 * never mapped to a chapter document in the first place.
 */
export function groupDeletedFilesByNovel(deletedFiles, baseNovelId) {
  const groups = {};
  for (const filePath of deletedFiles) {
    const location = parseChapterPath(filePath);
    if (!location) {
      console.warn(`Skipping unsupported deleted story path: ${filePath}`);
      continue;
    }
    const novelId = resolveNovelId(baseNovelId, location.language);
    if (!groups[novelId]) {
      groups[novelId] = { language: location.language, files: [] };
    }
    groups[novelId].files.push(filePath);
  }
  return groups;
}

/**
 * Scan every Markdown file under `novelDir/main` and build the set of chapter
 * keys that exist on disk, bucketed per resolved novel document ID. Frontmatter
 * overrides are applied exactly as during upserts so reconciliation compares
 * like with like. Empty or unreadable files are skipped (they count as absent).
 *
 * Returns `{ [resolvedNovelId]: Set<'episode-chapter'> }`.
 */
export async function scanExistingChapters(novelDir, baseNovelId) {
  const mainDir = path.resolve(novelDir, 'main');
  const files = await getAllMarkdownFiles(mainDir);

  const keysByNovel = {};
  for (const file of files) {
    const relativePath = path.relative(novelDir, file);
    const pathLocation = parseChapterPath(relativePath);
    if (!pathLocation) continue;

    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch {
      console.warn(`Reconciliation scan: skipping unreadable file: ${relativePath}`);
      continue;
    }
    if (!content.trim()) continue;

    const location = resolveChapterLocation(pathLocation, parseFrontmatter(content));
    const novelId = resolveNovelId(baseNovelId, location.language);
    if (!keysByNovel[novelId]) keysByNovel[novelId] = new Set();
    keysByNovel[novelId].add(`${location.episodeNumber}-${location.chapterNumber}`);
  }
  return keysByNovel;
}

/**
 * Reconciliation for one novel document: delete every chapter doc under
 * `novelRef` whose `episode-chapter` key is not present in `existingKeys`.
 * Returns the removed locations so callers can refresh affected rollups.
 */
export async function deleteOrphanedChapters(novelRef, existingKeys) {
  const removedChapters = [];
  const episodesSnapshot = await novelRef.collection('episodes').get();

  for (const epDoc of episodesSnapshot.docs) {
    const epNum = Number.parseInt(epDoc.id, 10);
    if (Number.isNaN(epNum)) continue;

    const chaptersSnapshot = await epDoc.ref.collection('chapters').get();
    for (const chDoc of chaptersSnapshot.docs) {
      const chNum = Number.parseInt(chDoc.id, 10);
      if (Number.isNaN(chNum)) continue;

      if (!existingKeys.has(`${epNum}-${chNum}`)) {
        console.warn(
          `Reconciliation: deleting orphaned chapter doc from Firestore: episode ${epNum}, chapter ${chNum}`,
        );
        await chDoc.ref.delete();
        removedChapters.push({ episodeNumber: epNum, chapterNumber: chNum });
      }
    }
  }
  return removedChapters;
}

function initializeFirestore() {
  if (getApps().length > 0) return getFirestore();

  const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!encodedKey) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY must contain Base64-encoded Firebase service-account JSON.',
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(encodedKey.replace(/\s/g, ''), 'base64').toString('utf8'),
    );
  } catch (error) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_KEY is not valid Base64-encoded service-account JSON: ${error.message}`,
    );
  }

  const credential = cert(serviceAccount);
  return getFirestore(initializeApp({ credential }));
}

export { initializeFirestore };

/**
 * Calculate the total word count for an episode by summing all chapters
 * in its chapters subcollection.
 */
export async function calculateEpisodeTotalWords(chaptersRef) {
  const snapshot = await chaptersRef.orderBy('chapterNumber').get();
  let totalWords = 0;
  snapshot.forEach((doc) => {
    totalWords += doc.data().wordCount ?? 0;
  });
  return totalWords;
}

/**
 * Batch-upsert chapters into `novelRef`, grouping them per episode and
 * auto-creating any missing episode document along the way. Existing chapter
 * docs are read first so API-managed fields (especially `notes`) survive.
 *
 * Returns the set of touched episode numbers so callers can refresh rollups.
 */
export async function upsertChapters(db, novelRef, chapters, timestamp) {
  const touchedEpisodeNumbers = new Set();

  // Group chapters by episode for batch-friendly processing
  const chaptersByEpisode = {};
  for (const chapter of chapters) {
    const epNum = chapter.episodeNumber;
    if (!chaptersByEpisode[epNum]) chaptersByEpisode[epNum] = [];
    chaptersByEpisode[epNum].push(chapter);
    touchedEpisodeNumbers.add(epNum);
  }

  for (const [episodeNumber, episodeChapters] of Object.entries(chaptersByEpisode)) {
    const episodeRef = novelRef.collection('episodes').doc(episodeNumber.toString());

    // Auto-create episode document if it doesn't exist yet
    const episodeSnapshot = await episodeRef.get();
    if (!episodeSnapshot.exists) {
      await episodeRef.set({
        episodeNumber: Number.parseInt(episodeNumber, 10),
        title: `Episode ${episodeNumber}`,
        summary: '',
        published: false,
        totalWords: 0,
      });
    }

    // Batch-upsert all chapters for this episode. Read each existing
    // chapter first so we don't clobber fields set via the API routes
    // (especially `notes`). Chunk the chapter list so every Firestore
    // batch stays within the 500-operation limit.
    for (const episodeChunk of chunk(episodeChapters, MAX_BATCH_OPERATIONS)) {
      const batch = db.batch();
      for (const chapter of episodeChunk) {
        const chapterRef = episodeRef
          .collection('chapters')
          .doc(chapter.chapterNumber.toString());

        const existingSnap = await chapterRef.get();
        const existing = existingSnap.exists ? existingSnap.data() : {};

        batch.set(chapterRef, {
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          slug: chapter.slug,
          content: chapter.content,
          wordCount: chapter.wordCount,
          lastEdited: timestamp,
          notes: existing.notes ?? '',
          language: chapter.language,
          status: chapter.status ?? '',
          translationOf: chapter.translationOf ?? '',
        });
      }
      await batch.commit();
    }
  }

  return touchedEpisodeNumbers;
}

/**
 * Recalculate the `totalWords` rollup on each given episode from the
 * chapter docs currently stored underneath it.
 */
export async function refreshEpisodeTotals(novelRef, episodeNumbers) {
  for (const episodeNumber of episodeNumbers) {
    const episodeRef = novelRef.collection('episodes').doc(String(episodeNumber));
    const totalWords = await calculateEpisodeTotalWords(episodeRef.collection('chapters'));
    await episodeRef.update({ totalWords });
  }
}

/**
 * Upsert the root-level novel metadata document (`novels/{novelId}`).
 * Preserves existing metadata via buildNovelDocument, stamps the language
 * version, and recalculates the novel-level totalWords from all episodes.
 */
export async function upsertNovelDocument(novelRef, { language, timestamp } = {}) {
  const novelSnapshot = await novelRef.get();
  const currentData = novelSnapshot.exists ? novelSnapshot.data() : {};

  const episodesSnapshot = await novelRef.collection('episodes').get();
  let totalWordsNovel = 0;
  episodesSnapshot.forEach((doc) => {
    totalWordsNovel += doc.data().totalWords ?? 0;
  });

  // Derive the _id field from the ref so translated versions (e.g.
  // novels/psychic_petals_tl) stamp their own suffixed ID, not the default.
  const novelDoc = buildNovelDocument({
    currentData,
    timestamp,
    includeId: true,
    language,
    novelId: novelRef.id,
  });
  novelDoc.metadata.totalWords = totalWordsNovel;
  await novelRef.set(novelDoc, { merge: true });
  return novelDoc;
}

async function main() {
  const { novelDir, novelId, changedFiles, deletedFiles } = parseArguments(process.argv.slice(2));
  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    console.log('No changed or deleted Markdown files supplied; nothing to sync.');
    return;
  }

  const { chapters, extraDeletedFiles } = await readChangedChapters(novelDir, changedFiles);
  const allDeletedFiles = [...deletedFiles, ...extraDeletedFiles];

  if (chapters.length === 0 && allDeletedFiles.length === 0) {
    console.log('No supported chapter files to sync or delete.');
    return;
  }

  // Route work per language version: en/bare files target the base novel doc,
  // other prefixes target their own `{novelId}_{lang}` documents.
  const chapterGroups = groupChaptersByNovel(chapters, novelId);
  const deletionGroups = groupDeletedFilesByNovel(allDeletedFiles, novelId);
  const targetNovelIds = [
    ...new Set([...Object.keys(chapterGroups), ...Object.keys(deletionGroups)]),
  ];

  const db = initializeFirestore();
  const timestamp = new Date().toISOString();

  // One disk scan shared by all versions; each novel reconciles independently
  // against its own slice so languages self-heal without clobbering each other.
  const keysByNovel = await scanExistingChapters(novelDir, novelId);

  for (const groupNovelId of targetNovelIds) {
    const language =
      chapterGroups[groupNovelId]?.language ?? deletionGroups[groupNovelId].language;
    const novelRef = db.collection('novels').doc(groupNovelId);

    // Delete chapters whose files were explicitly reported as removed
    const deletedChapters = await deleteChapters(
      novelRef,
      deletionGroups[groupNovelId]?.files ?? [],
    );

    // Reconciliation: remove this novel's docs that no longer exist on disk
    const orphanedChapters = await deleteOrphanedChapters(
      novelRef,
      keysByNovel[groupNovelId] ?? new Set(),
    );

    // Upsert changed chapters into the correct subcollection paths:
    //   novels/{novelId}/episodes/{episodeNumber}/chapters/{chapterNumber}
    const upsertedEpisodes = await upsertChapters(
      db,
      novelRef,
      chapterGroups[groupNovelId]?.chapters ?? [],
      timestamp,
    );

    // Recalculate word counts for every touched or drained episode
    const affectedEpisodes = new Set(upsertedEpisodes);
    for (const location of [...deletedChapters, ...orphanedChapters]) {
      affectedEpisodes.add(location.episodeNumber);
    }
    await refreshEpisodeTotals(novelRef, affectedEpisodes);

    // Root-level novel metadata document
    await upsertNovelDocument(novelRef, { language, timestamp });

    const removedCount = deletedChapters.length + orphanedChapters.length;
    const epLog = [...affectedEpisodes].sort((a, b) => a - b).join(', ') || 'none';
    console.log(
      `Synced novels/${groupNovelId} (${language}): ${upsertedEpisodes.size > 0 ? chapterGroups[groupNovelId].chapters.length : 0} chapter(s) written, ${removedCount} chapter(s) removed (episodes: ${epLog}).`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(`Novel sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
