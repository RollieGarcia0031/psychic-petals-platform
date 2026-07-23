import { FieldValue } from 'firebase-admin/firestore';

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
 * Builds a Firestore-ready novel document from the validated request body.
 * Optional fields fall back to sensible defaults so the stored document
 * always conforms to the schema defined in docs/DATABASE.md.
 *
 * @param {object} body - The validated, parsed request body.
 * @returns {object} The novel document ready to be written to Firestore.
 */
export function buildNovelDocument(body) {
  const now = FieldValue.serverTimestamp();

  const fallbackDate = new Date().toISOString();

  const metadata = {
    tags: body.metadata?.tags ?? [],
    coverImage: body.metadata?.coverImage ?? '',
    totalWords: body.metadata?.totalWords ?? 0,
  };

  const episodes = (body.episodes ?? []).map((ep, epIdx) => ({
    episodeNumber: ep.episodeNumber ?? epIdx + 1,
    title: ep.title ?? '',
    summary: ep.summary ?? '',
    published: ep.published ?? false,
    chapters: (ep.chapters ?? []).map((ch, chIdx) => ({
      chapterNumber: ch.chapterNumber ?? chIdx + 1,
      title: ch.title ?? '',
      content: ch.content ?? '',
      wordCount: ch.wordCount ?? 0,
      lastEdited: ch.lastEdited ?? fallbackDate,
      notes: ch.notes ?? '',
    })),
  }));

  return {
    title: body.title.trim(),
    description: body.description ?? '',
    author: body.author.trim(),
    status: body.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
    episodes,
    metadata,
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
