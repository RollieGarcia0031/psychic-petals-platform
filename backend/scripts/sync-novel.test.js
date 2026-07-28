import { describe, it, expect } from 'vitest';
import {
  parseArguments,
  parseChapterPath,
  extractTitle,
  countWords,
} from './sync-novel.js';
import { buildNovelDocument } from '../utils/novelUtils.js';

// ---------------------------------------------------------------------------
// parseArguments
// ---------------------------------------------------------------------------
describe('parseArguments', () => {
  it('parses --novel-dir and --changed correctly', () => {
    const result = parseArguments([
      '--novel-dir',
      '../../novel',
      '--changed',
      'main/episode-01/01-the-classroom-intro.md,main/episode-01/02-new-friend.md',
    ]);

    expect(result).toEqual({
      novelDir: '../../novel',
      changedFiles: [
        'main/episode-01/01-the-classroom-intro.md',
        'main/episode-01/02-new-friend.md',
      ],
    });
  });

  it('handles a single changed file', () => {
    const result = parseArguments([
      '--novel-dir',
      '/tmp/test',
      '--changed',
      'main/episode-01/01-hello.md',
    ]);

    expect(result.changedFiles).toEqual(['main/episode-01/01-hello.md']);
  });

  it('handles empty --changed gracefully', () => {
    const result = parseArguments(['--novel-dir', '/tmp/test', '--changed', '']);

    expect(result.changedFiles).toEqual([]);
  });

  it('strips whitespace from file paths', () => {
    const result = parseArguments([
      '--novel-dir',
      '/tmp/test',
      '--changed',
      ' a.md ,  b.md ',
    ]);

    expect(result.changedFiles).toEqual(['a.md', 'b.md']);
  });

  it('throws when --novel-dir is missing', () => {
    expect(() => parseArguments([])).toThrow('Missing required --novel-dir');
  });

  it('throws when a flag has no value', () => {
    expect(() => parseArguments(['--novel-dir'])).toThrow(
      'Missing value for --novel-dir',
    );
  });

  it('throws when a value looks like another flag', () => {
    expect(() => parseArguments(['--novel-dir', '--changed', '--changed', 'x'])).toThrow(
      'Missing value for --novel-dir',
    );
  });

  it('skips positional arguments that are not flags', () => {
    const result = parseArguments([
      'node',
      'script.js',
      '--novel-dir',
      '/tmp/n',
      '--changed',
      'f1.md',
    ]);
    expect(result.novelDir).toBe('/tmp/n');
    expect(result.changedFiles).toEqual(['f1.md']);
  });
});

// ---------------------------------------------------------------------------
// parseChapterPath
// ---------------------------------------------------------------------------
describe('parseChapterPath', () => {
  it('parses a standard episode chapter path', () => {
    const result = parseChapterPath('main/episode-01/01-the-classroom-intro.md');

    expect(result).toEqual({
      episodeNumber: 1,
      chapterNumber: 1,
      slug: 'the-classroom-intro',
    });
  });

  it('parses a multi-digit episode and chapter', () => {
    const result = parseChapterPath('main/episode-12/42-a-deep-dive.md');

    expect(result).toEqual({
      episodeNumber: 12,
      chapterNumber: 42,
      slug: 'a-deep-dive',
    });
  });

  it('parses a path with Windows-style separators', () => {
    const result = parseChapterPath('main\\episode-03\\07-character-dev.md');

    expect(result).toEqual({
      episodeNumber: 3,
      chapterNumber: 7,
      slug: 'character-dev',
    });
  });

  it('returns null for a path outside the main directory', () => {
    expect(parseChapterPath('outline/episode-01/01-intro.md')).toBeNull();
  });

  it('returns null for a path without a chapter number prefix', () => {
    expect(parseChapterPath('main/episode-01/intro.md')).toBeNull();
  });

  it('returns null for a non-.md file', () => {
    expect(parseChapterPath('main/episode-01/01-intro.txt')).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(parseChapterPath('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTitle
// ---------------------------------------------------------------------------
describe('extractTitle', () => {
  it('extracts a plain markdown heading', () => {
    const content = '# Chapter 1: The Beginning\n\nSome text here.';
    expect(extractTitle(content, 'Fallback')).toBe('Chapter 1: The Beginning');
  });

  it('extracts a heading with <center> tags', () => {
    const content = '# <center>Chapter One</center>\n\nBody text.';
    expect(extractTitle(content, 'Fallback')).toBe('Chapter One');
  });

  it('extracts a heading with other HTML tags', () => {
    const content = '# <em>Prologue</em>\n\nOnce upon a time...';
    expect(extractTitle(content, 'Fallback')).toBe('Prologue');
  });

  it('trims whitespace from the title', () => {
    const content = '#    Spaced Out   \n\nContent.';
    expect(extractTitle(content, 'Fallback')).toBe('Spaced Out');
  });

  it('returns fallback when there is no heading', () => {
    const content = 'Just some text without a heading.';
    expect(extractTitle(content, 'Fallback Title')).toBe('Fallback Title');
  });

  it('returns fallback when content is empty', () => {
    expect(extractTitle('', 'Fallback')).toBe('Fallback');
  });

  it('returns fallback when heading is empty after stripping tags', () => {
    const content = '# <center></center>\n\nBody.';
    expect(extractTitle(content, 'Fallback')).toBe('Fallback');
  });

  it('ignores HTML tags inside the heading text after center tags', () => {
    const content = '# <center>Chapter <strong>3</strong></center>\n\nBody.';
    expect(extractTitle(content, 'Fallback')).toBe('Chapter 3');
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------
describe('countWords', () => {
  it('counts words in a simple sentence', () => {
    expect(countWords('Hello world')).toBe(2);
  });

  it('counts words in multiline content', () => {
    const content = 'Line one.\nLine two.\n\nLine three.';
    expect(countWords(content)).toBe(6);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n  \t  ')).toBe(0);
  });

  it('counts words with extra whitespace', () => {
    expect(countWords('   lots    of   spaces   ')).toBe(3);
  });

  it('counts words in markdown content', () => {
    const md = '# Chapter Title\n\nThis is the body of the chapter with several words.';
    expect(countWords(md)).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// buildNovelDocument
// ---------------------------------------------------------------------------
describe('buildNovelDocument', () => {
  const testTimestamp = '2026-07-25T12:00:00.000Z';

  describe('currentData path (sync script)', () => {
    it('builds a document with defaults when no current data exists', () => {
      const doc = buildNovelDocument({ currentData: undefined, timestamp: testTimestamp, includeId: true });

      expect(doc).toEqual({
        _id: 'psychic_petals',
        title: 'Psychic Petals',
        description:
          'A magical realism and slice of life novel about quiet, personal moments in a world of psionic societies.',
        author: 'RollieGarcia0031',
        status: 'draft',
        createdAt: testTimestamp,
        updatedAt: testTimestamp,
        metadata: {
          tags: ['magical-realism', 'slice-of-life'],
          coverImage: '',
          totalWords: 0,
        },
      });
    });

    it('builds a document with defaults when current data is null', () => {
      const doc = buildNovelDocument({ currentData: null, timestamp: testTimestamp, includeId: true });

      expect(doc._id).toBe('psychic_petals');
      expect(doc.status).toBe('draft');
      expect(doc.metadata.tags).toEqual(['magical-realism', 'slice-of-life']);
    });

    it('preserves fields from current data', () => {
      const current = {
        description: 'Custom description.',
        author: 'Custom Author',
        status: 'published',
        createdAt: '2026-01-01T00:00:00.000Z',
        metadata: {
          tags: ['fantasy'],
          coverImage: 'https://example.com/cover.jpg',
        },
      };

      const doc = buildNovelDocument({ currentData: current, timestamp: testTimestamp, includeId: true });

      expect(doc.description).toBe('Custom description.');
      expect(doc.author).toBe('Custom Author');
      expect(doc.status).toBe('published');
      expect(doc.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(doc.metadata.tags).toEqual(['fantasy']);
      expect(doc.metadata.coverImage).toBe('https://example.com/cover.jpg');
    });

    it('overrides updatedAt with the provided timestamp', () => {
      const current = { updatedAt: '2026-01-01T00:00:00.000Z' };
      const doc = buildNovelDocument({ currentData: current, timestamp: testTimestamp, includeId: true });

      expect(doc.updatedAt).toBe(testTimestamp);
    });

    it('sets totalWords to 0 (recalculated at sync end)', () => {
      const doc = buildNovelDocument({ currentData: {}, timestamp: testTimestamp, includeId: true });
      expect(doc.metadata.totalWords).toBe(0);
    });

    it('omits _id when includeId is false', () => {
      const doc = buildNovelDocument({ currentData: {}, timestamp: testTimestamp });
      expect(doc._id).toBeUndefined();
    });

    it('fills in missing nested metadata fields with defaults', () => {
      const current = { metadata: { tags: ['sci-fi'] } };
      const doc = buildNovelDocument({ currentData: current, timestamp: testTimestamp, includeId: true });

      expect(doc.metadata.tags).toEqual(['sci-fi']);
      expect(doc.metadata.coverImage).toBe('');
    });
  });

  describe('body path (API routes)', () => {
    it('builds a document from request body', () => {
      const doc = buildNovelDocument({
        body: { title: 'My Novel', author: 'Author', metadata: {} },
        timestamp: testTimestamp,
      });

      expect(doc).toEqual({
        title: 'My Novel',
        description: '',
        author: 'Author',
        status: 'draft',
        createdAt: testTimestamp,
        updatedAt: testTimestamp,
        metadata: {
          tags: [],
          coverImage: '',
          totalWords: 0,
        },
      });
    });

    it('trims title and author', () => {
      const doc = buildNovelDocument({
        body: { title: '  Spaced Title  ', author: '  Spaced Author  ' },
        timestamp: testTimestamp,
      });

      expect(doc.title).toBe('Spaced Title');
      expect(doc.author).toBe('Spaced Author');
    });

    it('uses provided status and metadata', () => {
      const doc = buildNovelDocument({
        body: {
          title: 'Novel',
          author: 'Author',
          status: 'published',
          description: 'A great book.',
          metadata: { tags: ['fantasy'], coverImage: 'img.jpg', totalWords: 5000 },
        },
        timestamp: testTimestamp,
      });

      expect(doc.status).toBe('published');
      expect(doc.description).toBe('A great book.');
      expect(doc.metadata.tags).toEqual(['fantasy']);
      expect(doc.metadata.coverImage).toBe('img.jpg');
      expect(doc.metadata.totalWords).toBe(5000);
    });

    it('does not include _id field', () => {
      const doc = buildNovelDocument({
        body: { title: 'Novel', author: 'Author' },
        timestamp: testTimestamp,
      });
      expect(doc._id).toBeUndefined();
    });
  });
});
