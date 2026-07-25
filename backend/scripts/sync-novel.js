#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const NOVEL_ID = 'psychic_petals';
const NOVEL_TITLE = 'Psychic Petals';

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

  return {
    novelDir: options['novel-dir'],
    changedFiles: (options.changed ?? '')
      .split(',')
      .map((file) => file.trim())
      .filter(Boolean),
  };
}

/**
 * Convert a story path into its Firestore location.
 *
 * Story files use the canonical flat layout main/episode-NN/NN-slug.md.
 * Both numeric prefixes are required so Firestore locations remain stable.
 */
export function parseChapterPath(filePath) {
  // Normalise separators so the regex works on any platform.
  const normalizedPath = filePath.split(path.sep).join('/').replace(/\\/g, '/');
  const directMatch = normalizedPath.match(/^main\/episode-(\d+)\/(\d+)-(.+)\.md$/i);
  if (directMatch) {
    return {
      episodeNumber: Number.parseInt(directMatch[1], 10),
      chapterNumber: Number.parseInt(directMatch[2], 10),
      slug: directMatch[3],
    };
  }

  return null;
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

export function countWords(content) {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Build a metadata-only novel document for the root Firestore document.
 *
 * Per docs/DATABASE.md, the root novel document contains only metadata —
 * episodes and chapters live in subcollections.
 */
export function buildNovelDocument(currentData, timestamp) {
  return {
    _id: NOVEL_ID,
    title: NOVEL_TITLE,
    description:
      currentData?.description ??
      'A magical realism and slice of life novel about quiet, personal moments in a world of psionic societies.',
    author: currentData?.author ?? 'RollieGarcia0031',
    status: currentData?.status ?? 'draft',
    createdAt: currentData?.createdAt ?? timestamp,
    updatedAt: timestamp,
    metadata: {
      tags: currentData?.metadata?.tags ?? ['magical-realism', 'slice-of-life'],
      coverImage: currentData?.metadata?.coverImage ?? '',
      totalWords: 0, // recalculated at the end of the sync
    },
  };
}

async function readChangedChapters(novelDir, changedFiles) {
  const chapters = [];
  for (const filePath of changedFiles) {
    const location = parseChapterPath(filePath);
    if (!location) {
      console.warn(`Skipping unsupported story path: ${filePath}`);
      continue;
    }

    let content;
    try {
      content = await readFile(path.resolve(novelDir, filePath), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        console.warn(`Skipping deleted story path: ${filePath}`);
        continue;
      }
      throw error;
    }
    chapters.push({
      ...location,
      title: extractTitle(content, `Chapter ${location.chapterNumber}`),
      content,
      wordCount: countWords(content),
    });
  }
  return chapters;
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

/**
 * Calculate the total word count for an episode by summing all chapters
 * in its chapters subcollection.
 */
async function calculateEpisodeTotalWords(chaptersRef) {
  const snapshot = await chaptersRef.orderBy('chapterNumber').get();
  let totalWords = 0;
  snapshot.forEach((doc) => {
    totalWords += doc.data().wordCount ?? 0;
  });
  return totalWords;
}

async function main() {
  const { novelDir, changedFiles } = parseArguments(process.argv.slice(2));
  if (changedFiles.length === 0) {
    console.log('No changed Markdown files supplied; nothing to sync.');
    return;
  }

  const chapters = await readChangedChapters(novelDir, changedFiles);
  if (chapters.length === 0) {
    console.log('No supported chapter files found; nothing to sync.');
    return;
  }

  const db = initializeFirestore();
  const novelRef = db.collection('novels').doc(NOVEL_ID);
  const timestamp = new Date().toISOString();

  // Track which episode numbers were touched so we can recalc their totals
  const touchedEpisodeNumbers = new Set();

  // Group chapters by episode for batch-friendly processing
  const chaptersByEpisode = {};
  for (const chapter of chapters) {
    const epNum = chapter.episodeNumber;
    if (!chaptersByEpisode[epNum]) chaptersByEpisode[epNum] = [];
    chaptersByEpisode[epNum].push(chapter);
    touchedEpisodeNumbers.add(epNum);
  }

  // ── Step 1: Upsert chapters into the correct subcollection paths ──────
  //
  //   novels/{novelId}/episodes/{episodeNumber}/chapters/{chapterNumber}
  //
  for (const [episodeNumber, episodeChapters] of Object.entries(chaptersByEpisode)) {
    const episodeRef = novelRef.collection('episodes').doc(episodeNumber);

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

    // Batch-upsert all chapters for this episode.
    // Read each existing chapter first so we don't clobber fields set
    // via the API routes (especially `notes`).
    const batch = db.batch();
    for (const chapter of episodeChapters) {
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
      });
    }
    await batch.commit();
  }

  // ── Step 2: Recalculate word counts for each touched episode ──────────
  //
  //   novels/{novelId}/episodes/{episodeNumber}
  //
  for (const epNum of touchedEpisodeNumbers) {
    const episodeRef = novelRef.collection('episodes').doc(String(epNum));
    const chaptersRef = episodeRef.collection('chapters');
    const totalWords = await calculateEpisodeTotalWords(chaptersRef);
    await episodeRef.update({ totalWords });
  }

  // ── Step 3: Upsert the root-level novel metadata document ─────────────
  //
  //   novels/{novelId}
  //
  const novelSnapshot = await novelRef.get();
  const currentNovel = novelSnapshot.exists ? novelSnapshot.data() : {};

  // Recalculate novel-level totalWords from all episodes
  const episodesSnapshot = await novelRef.collection('episodes').get();
  let totalWordsNovel = 0;
  episodesSnapshot.forEach((doc) => {
    totalWordsNovel += doc.data().totalWords ?? 0;
  });

  const novelDoc = buildNovelDocument(currentNovel, timestamp);
  novelDoc.metadata.totalWords = totalWordsNovel;
  await novelRef.set(novelDoc, { merge: true });

  const epLog = [...touchedEpisodeNumbers].sort((a, b) => a - b).join(', ');
  console.log(`Synced ${chapters.length} chapter(s) to novels/${NOVEL_ID} (episodes: ${epLog}).`);
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
