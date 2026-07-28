import { FieldValue } from 'firebase-admin/firestore';

const NOVEL_ID = 'psychic_petals';
const NOVEL_TITLE = 'Psychic Petals';

/**
 * Validates the required root-level fields of a novel payload.
 * Returns an array of error messages (empty when valid).
 *
 * @param {object} body - The parsed request body.
 * @returns {string[]} Array of validation error messages.
 */
export function validateNovelPayload(body) {
  const errors = [];

  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    errors.push('`title` is required and must be a non-empty string.');
  }

  if (!body.author || typeof body.author !== 'string' || body.author.trim() === '') {
    errors.push('`author` is required and must be a non-empty string.');
  }

  const validStatuses = ['draft', 'published', 'archived', 'completed'];
  if (body.status && !validStatuses.includes(body.status)) {
    errors.push(`\`status\` must be one of: ${validStatuses.join(', ')}.`);
  }

  if (body.metadata !== undefined) {
    if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      errors.push('`metadata` must be an object.');
    } else {
      if (body.metadata.tags !== undefined && !Array.isArray(body.metadata.tags)) {
        errors.push('`metadata.tags` must be an array of strings.');
      }
      if (body.metadata.totalWords !== undefined && typeof body.metadata.totalWords !== 'number') {
        errors.push('`metadata.totalWords` must be a number.');
      }
    }
  }

  if (body.episodes !== undefined && !Array.isArray(body.episodes)) {
    errors.push('`episodes` must be an array.');
  }

  return errors;
}

/**
 * Builds a Firestore-ready novel document.
 *
 * Two call patterns are supported:
 *   - Sync script: pass `currentData` (existing Firestore doc) and `timestamp` (ISO string).
 *   - API routes:  pass `body` (request body) and `timestamp` (FieldValue.serverTimestamp()).
 *
 * @param {object} opts
 * @param {object} [opts.currentData] - Existing Firestore doc (sync script).
 * @param {object} [opts.body] - Request body (API routes).
 * @param {string|FieldValue} opts.timestamp - ISO string or FieldValue.serverTimestamp().
 * @param {boolean} [opts.includeId=false] - Include _id field (sync script only).
 */
export function buildNovelDocument({ currentData, body, timestamp, includeId = false }) {
  if (!body) {
    // Sync script path: merge existing data with defaults
    const doc = {
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
        totalWords: 0,
      },
    };
    if (includeId) {
      doc._id = NOVEL_ID;
    }
    return doc;
  }

  return {
    title: body.title.trim(),
    description: body.description ?? '',
    author: body.author.trim(),
    status: body.status ?? 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      tags: body.metadata?.tags ?? [],
      coverImage: body.metadata?.coverImage ?? '',
      totalWords: body.metadata?.totalWords ?? 0,
    },
  };
}

/**
 * Validates an episode payload.
 *
 * @param {object} body - The parsed request body for the episode.
 * @returns {string[]} Array of validation error messages.
 */
export function validateEpisodePayload(body) {
  const errors = [];

  if (body.title !== undefined && typeof body.title !== 'string') {
    errors.push('`title` must be a string.');
  }
  
  if (body.episodeNumber !== undefined && typeof body.episodeNumber !== 'number') {
    errors.push('`episodeNumber` must be a number.');
  }

  if (body.chapters !== undefined && !Array.isArray(body.chapters)) {
    errors.push('`chapters` must be an array.');
  }

  return errors;
}

/**
 * Builds an episode object from the validated request body.
 *
 * @param {object} body - The validated, parsed request body.
 * @returns {object} The episode object.
 */
export function buildEpisodeObject(body) {
  const fallbackDate = new Date().toISOString();
  return {
    episodeNumber: body.episodeNumber ?? 1,
    title: body.title ?? '',
    summary: body.summary ?? '',
    published: body.published ?? false,
    chapters: (body.chapters ?? []).map((ch, chIdx) => ({
      chapterNumber: ch.chapterNumber ?? chIdx + 1,
      title: ch.title ?? '',
      content: ch.content ?? '',
      wordCount: ch.wordCount ?? 0,
      lastEdited: ch.lastEdited ?? fallbackDate,
      notes: ch.notes ?? '',
    })),
  };
}

/**
 * Validates a chapter payload.
 *
 * @param {object} body - The parsed request body for the chapter.
 * @returns {string[]} Array of validation error messages.
 */
export function validateChapterPayload(body) {
  const errors = [];

  if (body.title !== undefined && typeof body.title !== 'string') {
    errors.push('\`title\` must be a string.');
  }

  if (body.content !== undefined && typeof body.content !== 'string') {
    errors.push('\`content\` must be a string.');
  }

  if (body.chapterNumber !== undefined && typeof body.chapterNumber !== 'number') {
    errors.push('\`chapterNumber\` must be a number.');
  }

  return errors;
}

/**
 * Builds a chapter object from the validated request body.
 *
 * @param {object} body - The validated, parsed request body.
 * @returns {object} The chapter object.
 */
export function buildChapterObject(body) {
  const fallbackDate = new Date().toISOString();
  return {
    chapterNumber: body.chapterNumber ?? 1,
    title: body.title ?? '',
    content: body.content ?? '',
    wordCount: body.wordCount ?? 0,
    lastEdited: body.lastEdited ?? fallbackDate,
    notes: body.notes ?? '',
  };
}
