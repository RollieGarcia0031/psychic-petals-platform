#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const NOVEL_ID = 'psychic_petals';
const DEFAULT_NOVEL = {
  _id: NOVEL_ID,
  title: 'Psychic Petals',
  description: 'A magical realism and slice of life novel about quiet, personal moments in a world of psionic societies.',
  author: 'RollieGarcia0031',
  status: 'draft',
  episodes: [],
  metadata: {
    tags: ['magical-realism', 'slice-of-life'],
    totalWords: 0,
  },
};

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
 * The preferred layout is main/episode-NN/NN-slug.md. The repository also
 * contains the documented nested form main/episode-NN/chapter-NN/file.md,
 * where the chapter directory supplies the chapter number.
 */
export function parseChapterPath(filePath) {
  const normalizedPath = filePath.split(path.sep).join('/');
  const directMatch = normalizedPath.match(/^main\/episode-(\d+)\/(\d+)-(.+)\.md$/i);
  if (directMatch) {
    return {
      episodeNumber: Number.parseInt(directMatch[1], 10),
      chapterNumber: Number.parseInt(directMatch[2], 10),
      slug: directMatch[3],
    };
  }

  const nestedMatch = normalizedPath.match(/^main\/episode-(\d+)\/chapter-(\d+)\/([^/]+)\.md$/i);
  if (!nestedMatch) return null;

  const filename = nestedMatch[3];
  const numberedFilename = filename.match(/^\d+-(.+)$/);
  return {
    episodeNumber: Number.parseInt(nestedMatch[1], 10),
    chapterNumber: Number.parseInt(nestedMatch[2], 10),
    slug: numberedFilename ? numberedFilename[1] : filename,
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

export function countWords(content) {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function buildUpdatedNovel(currentNovel, chapters, timestamp) {
  return {
    ...DEFAULT_NOVEL,
    ...currentNovel,
    _id: NOVEL_ID,
    createdAt: currentNovel?.createdAt ?? timestamp,
    updatedAt: timestamp,
    metadata: {
      ...DEFAULT_NOVEL.metadata,
      ...(currentNovel?.metadata ?? {}),
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

    const content = await readFile(path.resolve(novelDir, filePath), 'utf8');
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
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain Base64-encoded Firebase service-account JSON.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(Buffer.from(encodedKey.replace(/\s/g, ''), 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY is not valid Base64-encoded service-account JSON: ${error.message}`);
  }

  const credential = cert(serviceAccount);
  return getFirestore(initializeApp({ credential }));
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

  // Ensure the novel document exists
  const novelSnapshot = await novelRef.get();
  if (!novelSnapshot.exists) {
    const defaultNovelDoc = {
      title: DEFAULT_NOVEL.title,
      description: DEFAULT_NOVEL.description,
      author: DEFAULT_NOVEL.author,
      status: DEFAULT_NOVEL.status,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        ...DEFAULT_NOVEL.metadata,
      }
    };
    await novelRef.set(defaultNovelDoc);
  }

  // Sync each changed chapter
  for (const chapter of chapters) {
    const episodeRef = novelRef.collection('episodes').doc(chapter.episodeNumber.toString());
    const episodeSnapshot = await episodeRef.get();
    
    // If the episode document doesn't exist, create it with default values
    if (!episodeSnapshot.exists) {
      await episodeRef.set({
        episodeNumber: chapter.episodeNumber,
        title: `Episode ${chapter.episodeNumber}`,
        summary: '',
        published: false,
        totalWords: 0
      });
    }

    const chapterRef = episodeRef.collection('chapters').doc(chapter.chapterNumber.toString());
    const chapterSnapshot = await chapterRef.get();
    const existingChapterData = chapterSnapshot.exists ? chapterSnapshot.data() : {};
    
    const updatedChapter = {
      ...existingChapterData,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount,
      lastEdited: timestamp,
      notes: existingChapterData.notes ?? '',
      slug: chapter.slug ?? ''
    };
    
    await chapterRef.set(updatedChapter);
  }

  // Recalculate word counts
  const episodesSnapshot = await novelRef.collection('episodes').get();
  let totalWordsNovel = 0;

  for (const epDoc of episodesSnapshot.docs) {
    const epRef = epDoc.ref;
    const chaptersSnapshot = await epRef.collection('chapters').get();
    
    let totalWordsEpisode = 0;
    chaptersSnapshot.forEach((chDoc) => {
      totalWordsEpisode += chDoc.data().wordCount ?? 0;
    });

    await epRef.update({
      totalWords: totalWordsEpisode
    });

    totalWordsNovel += totalWordsEpisode;
  }

  // Update novel document with total word counts and updatedAt
  await novelRef.update({
    'metadata.totalWords': totalWordsNovel,
    updatedAt: timestamp
  });

  console.log(`Synced ${chapters.length} chapter(s) to novels/${NOVEL_ID}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`Novel sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
