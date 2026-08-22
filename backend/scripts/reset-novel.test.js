import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Firestore mock harness — a minimal in-memory document store that mimics the
// subset of the firebase-admin API used by sync-novel.js and reset-novel.js.
// Defined inside vi.hoisted so the module mocks below can reference it.
// ---------------------------------------------------------------------------
const { dbMock } = vi.hoisted(() => {
  function createFirestoreMock() {
    const store = new Map();
    const deletedPaths = [];

    const docRef = (segments) => {
      const docPath = segments.join('/');
      return {
        path: docPath,
        id: segments[segments.length - 1],
        async get() {
          const exists = store.has(docPath);
          return {
            exists,
            id: this.id,
            data: () => (exists ? structuredClone(store.get(docPath)) : undefined),
            ref: this,
          };
        },
        async set(data, options) {
          // Mirror Firestore: with { merge: true } unspecified fields survive.
          const merged =
            options?.merge && store.has(docPath)
              ? { ...store.get(docPath), ...structuredClone(data) }
              : structuredClone(data);
          store.set(docPath, merged);
        },
        async update(data) {
          if (!store.has(docPath)) {
            throw new Error(`update() on missing document: ${docPath}`);
          }
          store.set(docPath, { ...store.get(docPath), ...structuredClone(data) });
        },
        async delete() {
          deletedPaths.push(docPath);
          store.delete(docPath);
        },
        collection(name) {
          return collectionRef([...segments, name]);
        },
      };
    };

    const collectionRef = (segments) => {
      const collPath = segments.join('/');
      const prefix = `${collPath}/`;
      const directChildIds = () =>
        [...new Set(
          [...store.keys()]
            .filter((p) => p.startsWith(prefix))
            .map((p) => p.slice(prefix.length).split('/')[0]),
        )].sort((a, b) => {
          const numA = Number(a);
          const numB = Number(b);
          if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
          return a < b ? -1 : 1;
        });

      return {
        path: collPath,
        doc(id) {
          return docRef([...segments, String(id)]);
        },
        async get() {
          const docs = directChildIds().map((id) => {
            const ref = docRef([...segments, id]);
            // Mimic a Firestore QueryDocumentSnapshot: id, ref, data().
            return {
              id,
              ref,
              data: () =>
                store.has(ref.path) ? structuredClone(store.get(ref.path)) : undefined,
            };
          });
          return {
            docs,
            size: docs.length,
            empty: docs.length === 0,
            forEach(callback) {
              docs.forEach(callback);
            },
          };
        },
        orderBy() {
          return this;
        },
      };
    };

    return {
      store,
      deletedPaths,
      batch() {
        let operations = [];
        return {
          set(ref, data) {
            operations.push([ref.path, data]);
          },
          async commit() {
            for (const [refPath, data] of operations) {
              store.set(refPath, structuredClone(data));
            }
            operations = [];
          },
        };
      },
      collection(name) {
        return collectionRef([name]);
      },
    };
  }

  return { dbMock: createFirestoreMock() };
});

vi.mock('firebase-admin/app', () => ({
  cert: (input) => input,
  getApps: () => [],
  initializeApp: () => ({ mocked: true }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => dbMock,
}));

const {
  parseResetArguments,
  discoverResetTargets,
  loadChaptersFromDisk,
  formatResetSummary,
  inspectNovel,
  wipeNovel,
  rebuildNovel,
  runReset,
} = await import('./reset-novel.js');

// Exercised here because the mock Firestore harness lives in this file.
const { refreshEpisodeTotals } = await import('./sync-novel.js');

/** Word count helper mirroring the whitespace-splitting contract. */
const wc = (text) => text.trim().split(/\s+/).length;

// Recording console fakes keep test output clean while still allowing call
// assertions. Manually swapped/restored instead of vi.spyOn so repeated
// nesting across describes can never corrupt spy state.
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};
let consoleCalls;

beforeAll(() => {
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = Buffer.from(
    JSON.stringify({ project_id: 'test-project' }),
  ).toString('base64');
});

beforeEach(() => {
  dbMock.store.clear();
  dbMock.deletedPaths.length = 0;
  consoleCalls = { log: [], warn: [], error: [] };
  console.log = (...args) => consoleCalls.log.push(args);
  console.warn = (...args) => consoleCalls.warn.push(args);
  console.error = (...args) => consoleCalls.error.push(args);
});

afterEach(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  process.exitCode = undefined;
});

const EN_CH1 = '# Unlabeled Maps\n\none two three four five';
const EN_CH2 = '# Home\n\nsix seven eight';
const TL_BODY_1 = ['', '# Old Heading Loses', '', 'isa dalawa tatlo'].join('\n');
const TL_STUB_1 = [
  '---',
  'title: Mga Mapang Di-Pinalagyan',
  'episode: 1',
  'chapter: 1',
  'status: draft',
  'translationOf: 1/1',
  '---',
  ...TL_BODY_1.split('\n'),
].join('\n');
const TL_BODY_2 = ['', '# Tahanan', '', 'apat lima anim'].join('\n');
const TL_STUB_2 = [
  '---',
  'title: Tahanan',
  'episode: 1',
  'chapter: 2',
  'status: draft',
  'translationOf: 1/2',
  '---',
  ...TL_BODY_2.split('\n'),
].join('\n');

/**
 * Create a temporary novel directory containing legacy English, explicit en,
 * and tl chapter files (one tl stub carrying frontmatter overrides).
 */
async function createNovelFixture() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-reset-'));
  const novelDir = path.join(tempRoot, 'novel');

  await mkdir(path.join(novelDir, 'main', 'episode-01'), { recursive: true });
  await mkdir(path.join(novelDir, 'main', 'en', 'episode-01'), { recursive: true });
  await mkdir(path.join(novelDir, 'main', 'tl', 'episode-01'), { recursive: true });
  await mkdir(path.join(novelDir, 'outlines'), { recursive: true });

  await writeFile(path.join(novelDir, 'main', 'episode-01', '01-unlabeled-maps.md'), EN_CH1);
  await writeFile(path.join(novelDir, 'main', 'en', 'episode-01', '02-home.md'), EN_CH2);
  await writeFile(
    path.join(novelDir, 'main', 'tl', 'episode-01', '01-mga-mapang-di-pinalagyan.md'),
    TL_STUB_1,
  );
  await writeFile(path.join(novelDir, 'main', 'tl', 'episode-01', '02-tahanan.md'), TL_STUB_2);
  await writeFile(path.join(novelDir, 'outlines', '01-not-prose.md'), '# Outline');

  return { tempRoot, novelDir };
}

function seedDoc(docPath, data) {
  dbMock.store.set(docPath, structuredClone(data));
}

describe('parseResetArguments', () => {
  it('defaults to psychic_petals, no language filter, and no confirmation', () => {
    expect(parseResetArguments(['--novel-dir', '/tmp/novel'])).toEqual({
      novelDir: '/tmp/novel',
      novelId: 'psychic_petals',
      lang: null,
      assumeYes: false,
    });
  });

  it('accepts --yes in any position', () => {
    const first = parseResetArguments(['--yes', '--novel-dir', '/tmp/n']);
    const second = parseResetArguments(['--novel-dir', '/tmp/n', '--yes']);
    expect(first.assumeYes).toBe(true);
    expect(second.assumeYes).toBe(true);
  });

  it('accepts --novel-id and --lang overrides', () => {
    const result = parseResetArguments([
      '--novel-dir',
      '/tmp/n',
      '--novel-id',
      'other_novel',
      '--lang',
      'tl',
    ]);
    expect(result.novelId).toBe('other_novel');
    expect(result.lang).toBe('tl');
  });

  it('normalises --lang casing and whitespace', () => {
    const result = parseResetArguments(['--novel-dir', '/tmp/n', '--lang', ' TL ']);
    expect(result.lang).toBe('tl');
  });

  it('rejects malformed --lang values', () => {
    expect(() => parseResetArguments(['--novel-dir', '/n', '--lang', 'eng'])).toThrow('--lang');
    expect(() => parseResetArguments(['--novel-dir', '/n', '--lang', ''])).toThrow('--lang');
  });

  it('requires --novel-dir', () => {
    expect(() => parseResetArguments([])).toThrow('Missing required --novel-dir');
  });

  it('rejects unknown flags instead of silently ignoring typos', () => {
    expect(() => parseResetArguments(['--novel-dir', '/n', '--nuke'])).toThrow('Unknown argument');
  });

  it('rejects flags missing their value', () => {
    expect(() => parseResetArguments(['--novel-dir'])).toThrow('Missing value for --novel-dir');
    expect(() => parseResetArguments(['--novel-dir', '/n', '--novel-id'])).toThrow(
      'Missing value for --novel-id',
    );
  });
});

describe('discoverResetTargets', () => {
  const chapters = [
    { language: 'en', episodeNumber: 1, chapterNumber: 1 },
    { language: 'tl', episodeNumber: 1, chapterNumber: 1 },
    { language: 'tl', episodeNumber: 1, chapterNumber: 2 },
  ];

  it('targets the base document plus every discovered language, sorted', () => {
    expect(discoverResetTargets(chapters, 'psychic_petals')).toEqual([
      { language: 'en', novelId: 'psychic_petals' },
      { language: 'tl', novelId: 'psychic_petals_tl' },
    ]);
  });

  it('always includes English even when only translated files exist', () => {
    expect(discoverResetTargets([{ language: 'ja' }], 'base')).toEqual([
      { language: 'en', novelId: 'base' },
      { language: 'ja', novelId: 'base_ja' },
    ]);
  });

  it('with a --lang filter resets exactly one version', () => {
    expect(discoverResetTargets(chapters, 'psychic_petals', 'tl')).toEqual([
      { language: 'tl', novelId: 'psychic_petals_tl' },
    ]);
    expect(discoverResetTargets(chapters, 'psychic_petals', 'en')).toEqual([
      { language: 'en', novelId: 'psychic_petals' },
    ]);
  });

  it('refuses a lang filter that matches no chapter on disk', () => {
    expect(() => discoverResetTargets(chapters, 'psychic_petals', 'ja')).toThrow(
      /No ja chapter files found/,
    );
    // Also refuses the base language when zero English chapters exist.
    expect(() => discoverResetTargets([{ language: 'tl' }], 'psychic_petals', 'en')).toThrow(
      /No en chapter files found/,
    );
  });

  it('handles an empty disk scan by still offering the base version', () => {
    expect(discoverResetTargets([], 'psychic_petals')).toEqual([
      { language: 'en', novelId: 'psychic_petals' },
    ]);
    // …but an explicit filter on an empty scan has nothing to rebuild from.
    expect(() => discoverResetTargets([], 'psychic_petals', 'tl')).toThrow(/No tl chapter files/);
  });
});

describe('loadChaptersFromDisk', () => {
  it('loads every chapter across layouts with frontmatter precedence', async () => {
    const { tempRoot, novelDir } = await createNovelFixture();
    try {
      const chapters = await loadChaptersFromDisk(novelDir);

      expect(chapters).toHaveLength(4);

      const byKey = new Map(chapters.map((c) => [`${c.language}-${c.chapterNumber}`, c]));

      // Legacy bare layout -> base novel, language defaults to en.
      expect(byKey.get('en-1')).toMatchObject({
        language: 'en',
        episodeNumber: 1,
        chapterNumber: 1,
        slug: 'unlabeled-maps',
        title: 'Unlabeled Maps',
        status: '',
        translationOf: '',
        wordCount: wc(EN_CH1),
      });

      // Explicit en prefix behaves identically.
      expect(byKey.get('en-2')).toMatchObject({
        language: 'en',
        episodeNumber: 1,
        chapterNumber: 2,
        slug: 'home',
        title: 'Home',
        wordCount: wc(EN_CH2),
      });

      // Frontmatter overrides the H1 heading; status/translationOf captured.
      expect(byKey.get('tl-1')).toMatchObject({
        language: 'tl',
        episodeNumber: 1,
        chapterNumber: 1,
        title: 'Mga Mapang Di-Pinalagyan',
        status: 'draft',
        translationOf: '1/1',
      });
      expect(byKey.get('tl-2')).toMatchObject({
        language: 'tl',
        title: 'Tahanan',
        status: 'draft',
        translationOf: '1/2',
      });
      // Content and word counts cover the body only, never the fence.
      expect(byKey.get('tl-1').content).toBe(TL_BODY_1);
      expect(byKey.get('tl-2').content).toBe(TL_BODY_2);
      expect(byKey.get('tl-2').wordCount).toBe(wc(TL_BODY_2));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips unsupported paths such as non-chapter markdown files', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-reset-'));
    const novelDir = path.join(tempRoot, 'novel');
    await mkdir(path.join(novelDir, 'main'), { recursive: true });
    await writeFile(path.join(novelDir, 'main', 'README.md'), '# Not a chapter');

    try {
      const chapters = await loadChaptersFromDisk(novelDir);
      expect(chapters).toHaveLength(0);
      expect(consoleCalls.warn.some(([msg]) => String(msg).includes('unsupported story path'))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips empty chapter files so they cannot erase valid data on rebuild', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-reset-'));
    const novelDir = path.join(tempRoot, 'novel');
    await mkdir(path.join(novelDir, 'main', 'episode-01'), { recursive: true });
    await writeFile(path.join(novelDir, 'main', 'episode-01', '01-empty.md'), '   \n\t\n');

    try {
      const chapters = await loadChaptersFromDisk(novelDir);
      expect(chapters).toHaveLength(0);
      expect(consoleCalls.warn.some(([msg]) => String(msg).includes('empty chapter file'))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('formatResetSummary', () => {
  it('lists each target document with its wipe counts', () => {
    const targets = [
      { language: 'en', novelId: 'psychic_petals' },
      { language: 'tl', novelId: 'psychic_petals_tl' },
    ];
    const lines = formatResetSummary(targets, {
      psychic_petals: { exists: true, episodeCount: 2, chapterCount: 5 },
    });

    expect(lines[0]).toContain('DELETE AND REBUILD 2 novel document(s)');
    expect(lines.some((line) => line.includes('`notes`'))).toBe(true);
    expect(lines.some((line) => line.includes('novels/psychic_petals (en): exists'))).toBe(true);
    expect(lines.some((line) => line.includes('2 episode(s), 5 chapter(s) to delete'))).toBe(true);
    expect(lines.some((line) => line.includes('novels/psychic_petals_tl (tl): missing'))).toBe(true);
  });
});

describe('wipeNovel', () => {
  it('deletes the whole subtree of its own document and nothing else', async () => {
    seedDoc('novels/psychic_petals', { title: 'stale' });
    seedDoc('novels/psychic_petals/episodes/1', { episodeNumber: 1 });
    seedDoc('novels/psychic_petals/episodes/1/chapters/1', { content: 'old' });
    seedDoc('novels/psychic_petals/episodes/1/chapters/2', { content: 'old' });
    seedDoc('novels/psychic_petals/episodes/9', { episodeNumber: 9 });
    seedDoc('novels/other_book/episodes/1', { episodeNumber: 1 });
    seedDoc('novels/other_book/episodes/1/chapters/1', { content: 'keep' });
    seedDoc('authors/someone', { name: 'keep' });

    const novelRef = dbMock.collection('novels').doc('psychic_petals');
    const wiped = await wipeNovel(novelRef);

    expect(wiped).toEqual({ deletedEpisodes: 2, deletedChapters: 2 });

    // Everything under the target document is gone…
    expect([...dbMock.store.keys()].filter((p) => p.startsWith('novels/psychic_petals'))).toEqual([]);
    expect(dbMock.deletedPaths.every((p) => p === 'novels/psychic_petals' || p.startsWith('novels/psychic_petals/'))).toBe(true);

    // …while sibling novels and unrelated collections survive untouched.
    expect(dbMock.store.has('novels/other_book/episodes/1/chapters/1')).toBe(true);
    expect(dbMock.store.has('authors/someone')).toBe(true);
  });

  it('is a no-op when the document does not exist', async () => {
    const novelRef = dbMock.collection('novels').doc('never_existed');
    const wiped = await wipeNovel(novelRef);
    expect(wiped).toEqual({ deletedEpisodes: 0, deletedChapters: 0 });
  });
});

describe('refreshEpisodeTotals', () => {
  it('skips missing episode docs and merge-updates existing ones', async () => {
    const novelRef = dbMock.collection('novels').doc('psychic_petals');
    // Episode 2 exists with unrelated fields; episode 9 does not exist at all.
    dbMock.store.set('novels/psychic_petals/episodes/2', {
      published: true,
      totalWords: 0,
    });
    dbMock.store.set('novels/psychic_petals/episodes/2/chapters/1', { wordCount: 7 });
    dbMock.store.set('novels/psychic_petals/episodes/2/chapters/2', { wordCount: 3 });

    await expect(refreshEpisodeTotals(novelRef, [2, 9])).resolves.toBeUndefined();

    const refreshed = dbMock.store.get('novels/psychic_petals/episodes/2');
    expect(refreshed.totalWords).toBe(10);
    // Merging set preserves the other fields on an existing episode doc.
    expect(refreshed.published).toBe(true);
    // The missing episode was skipped instead of throwing or being created.
    expect(dbMock.store.has('novels/psychic_petals/episodes/9')).toBe(false);
  });
});

describe('rebuildNovel', () => {
  const timestamp = '2026-08-22T00:00:00.000Z';

  function buildTlChapters() {
    return [
      {
        language: 'tl',
        episodeNumber: 1,
        chapterNumber: 1,
        slug: 'mga-mapang-di-pinalagyan',
        title: 'Mga Mapang Di-Pinalagyan',
        status: 'draft',
        translationOf: '1/1',
        content: 'isa dalawa tatlo apat',
        wordCount: wc('isa dalawa tatlo apat'),
      },
      {
        language: 'tl',
        episodeNumber: 1,
        chapterNumber: 2,
        slug: 'tahanan',
        title: 'Tahanan',
        status: 'draft',
        translationOf: '1/2',
        content: 'lima anim',
        wordCount: wc('lima anim'),
      },
      {
        language: 'tl',
        episodeNumber: 2,
        chapterNumber: 1,
        slug: 'mga-chords',
        title: 'Mga Chords',
        status: '',
        translationOf: '',
        content: 'pito walo siyam',
        wordCount: wc('pito walo siyam'),
      },
    ];
  }

  it('recreates episodes, rewrites chapters fresh, and recalculates rollups', async () => {
    const novelRef = dbMock.collection('novels').doc('psychic_petals_tl');
    const stats = await rebuildNovel(dbMock, novelRef, buildTlChapters(), {
      language: 'tl',
      timestamp,
    });

    expect(stats.writtenChapters).toBe(3);
    expect(stats.episodeCount).toBe(2);

    // Episode documents recreated with sync-script defaults.
    const ep1 = dbMock.store.get('novels/psychic_petals_tl/episodes/1');
    const ep2 = dbMock.store.get('novels/psychic_petals_tl/episodes/2');
    expect(ep1).toMatchObject({ episodeNumber: 1, published: false, totalWords: 6 });
    expect(ep2).toMatchObject({ episodeNumber: 2, published: false, totalWords: 3 });

    // Chapter docs rewritten fresh: notes reset to '', metadata stamped.
    const ch11 = dbMock.store.get('novels/psychic_petals_tl/episodes/1/chapters/1');
    expect(ch11).toMatchObject({
      chapterNumber: 1,
      title: 'Mga Mapang Di-Pinalagyan',
      language: 'tl',
      status: 'draft',
      translationOf: '1/1',
      wordCount: 4,
      notes: '',
      lastEdited: timestamp,
    });

    // Novel-level aggregate recalculated across all episodes.
    const root = dbMock.store.get('novels/psychic_petals_tl');
    expect(root.metadata.totalWords).toBe(9);
    expect(root.language).toBe('tl');
    expect(root._id).toBe('psychic_petals_tl');
  });

  it('rebuilding an empty chapter set yields just the root document', async () => {
    const novelRef = dbMock.collection('novels').doc('empty_version');
    const stats = await rebuildNovel(dbMock, novelRef, [], { language: 'en', timestamp });

    expect(stats).toEqual({ writtenChapters: 0, episodeCount: 0, totalWords: 0 });
    expect([...dbMock.store.keys()]).toEqual(['novels/empty_version']);
    expect(dbMock.store.get('novels/empty_version').language).toBe('en');
  });
});

describe('inspectNovel', () => {
  it('counts episodes and chapters and reports existence', async () => {
    seedDoc('novels/psychic_petals', { title: 'x' });
    seedDoc('novels/psychic_petals/episodes/1', {});
    seedDoc('novels/psychic_petals/episodes/1/chapters/1', {});
    seedDoc('novels/psychic_petals/episodes/1/chapters/2', {});

    const info = await inspectNovel(dbMock.collection('novels').doc('psychic_petals'));
    expect(info).toEqual({ exists: true, episodeCount: 1, chapterCount: 2 });

    const missing = await inspectNovel(dbMock.collection('novels').doc('ghost'));
    expect(missing).toEqual({ exists: false, episodeCount: 0, chapterCount: 0 });
  });
});

describe('runReset', () => {
  const timestampSeed = { title: 'Psychic Petals', status: 'published' };

  /** Seed stale database state including orphans and API-managed fields. */
  function seedStaleDatabase() {
    seedDoc('novels/psychic_petals', { ...timestampSeed, extraStaleField: true });
    seedDoc('novels/psychic_petals/episodes/1', { episodeNumber: 1, totalWords: 999 });
    seedDoc('novels/psychic_petals/episodes/1/chapters/1', {
      content: 'stale',
      notes: 'dashboard notes that must be wiped',
      staleField: 'leftover',
    });
    // Stale empty episode + orphaned chapter: reconciliation would keep these.
    seedDoc('novels/psychic_petals/episodes/9', { episodeNumber: 9, totalWords: 0 });
    seedDoc('novels/psychic_petals/episodes/9/chapters/3', { content: 'orphan' });
    seedDoc('novels/psychic_petals_tl', { title: 'stale tl' });
    seedDoc('novels/psychic_petals_tl/episodes/1', { episodeNumber: 1 });
    seedDoc('novels/psychic_petals_tl/episodes/1/chapters/1', { content: 'stale tl chapter' });
    // Unrelated data that must never be touched.
    seedDoc('novels/unrelated_novel/episodes/1/chapters/1', { content: 'precious' });
    seedDoc('authors/rollie', { name: 'Rollie' });
  }

  it('refuses to run without --yes and leaves the database untouched', async () => {
    const { tempRoot, novelDir } = await createNovelFixture();
    try {
      seedStaleDatabase();

      const result = await runReset(['--novel-dir', novelDir]);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('missing-confirmation');
      expect(process.exitCode).toBe(1);
      expect(dbMock.deletedPaths).toHaveLength(0);
      expect(dbMock.store.has('novels/psychic_petals/episodes/9/chapters/3')).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('performs a full nuke-and-rebuild of both versions with --yes', async () => {
    const { tempRoot, novelDir } = await createNovelFixture();
    try {
      seedStaleDatabase();

      const result = await runReset(['--novel-dir', novelDir, '--yes']);

      expect(result.ok).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(result.targets.map((t) => t.novelId)).toEqual([
        'psychic_petals',
        'psychic_petals_tl',
      ]);

      // Stale state is gone: orphaned episode 9, dashboard notes, leftover fields.
      expect(dbMock.store.has('novels/psychic_petals/episodes/9')).toBe(false);
      expect(dbMock.store.has('novels/psychic_petals/episodes/9/chapters/3')).toBe(false);
      const rebuiltEn = dbMock.store.get('novels/psychic_petals/episodes/1/chapters/1');
      expect(rebuiltEn.notes).toBe('');
      expect(rebuiltEn.staleField).toBeUndefined();
      expect(rebuiltEn.content).toBe(EN_CH1);
      expect(rebuiltEn.title).toBe('Unlabeled Maps');
      expect(rebuiltEn.language).toBe('en');

      // Episode totals recalculated per episode; root aggregate is the sum.
      expect(dbMock.store.get('novels/psychic_petals/episodes/1').totalWords)
        .toBe(wc(EN_CH1) + wc(EN_CH2));
      expect(dbMock.store.get('novels/psychic_petals').metadata.totalWords)
        .toBe(wc(EN_CH1) + wc(EN_CH2));
      expect(dbMock.store.get('novels/psychic_petals').extraStaleField).toBeUndefined();

      // Tagalog version rebuilt from its stubs with frontmatter applied.
      const rebuiltTl = dbMock.store.get('novels/psychic_petals_tl/episodes/1/chapters/2');
      expect(rebuiltTl.title).toBe('Tahanan');
      expect(rebuiltTl.translationOf).toBe('1/2');
      // Stored content is the body only — no `---` fence lines.
      expect(rebuiltTl.content).toBe(TL_BODY_2);
      expect(dbMock.store.get('novels/psychic_petals_tl').language).toBe('tl');
      expect(dbMock.store.get('novels/psychic_petals_tl/episodes/1').totalWords)
        // Frontmatter is stripped; totals count body words only.
        .toBe(wc(TL_BODY_1) + wc(TL_BODY_2));

      // Wipe scope: unrelated collections and novels untouched.
      expect(dbMock.store.has('novels/unrelated_novel/episodes/1/chapters/1')).toBe(true);
      expect(dbMock.store.has('authors/rollie')).toBe(true);
      expect(
        dbMock.deletedPaths.some((p) => !p.startsWith('novels/psychic_petals')),
      ).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('resets only the filtered language with --lang and preserves other versions', async () => {
    const { tempRoot, novelDir } = await createNovelFixture();
    try {
      seedStaleDatabase();
      const enBefore = JSON.stringify([...dbMock.store.entries()].filter(([p]) => p.includes('unrelated')));

      const result = await runReset(['--novel-dir', novelDir, '--lang', 'tl', '--yes']);

      expect(result.ok).toBe(true);
      expect(result.targets.map((t) => t.novelId)).toEqual(['psychic_petals_tl']);

      // Only the Tagalog version was rebuilt…
      expect(dbMock.store.get('novels/psychic_petals_tl/episodes/1/chapters/1').title)
        .toBe('Mga Mapang Di-Pinalagyan');

      // …while everything else — including stale English state — is untouched.
      expect(dbMock.store.has('novels/psychic_petals/episodes/9/chapters/3')).toBe(true);
      const enAfter = JSON.stringify([...dbMock.store.entries()].filter(([p]) => p.includes('unrelated')));
      expect(enAfter).toBe(enBefore);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws when the novel directory has no main/ folder even with --yes', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-reset-'));
    const novelDir = path.join(tempRoot, 'not-a-novel');
    await mkdir(novelDir, { recursive: true });

    try {
      await expect(runReset(['--novel-dir', novelDir, '--yes'])).rejects.toThrow(
        /No main\/ directory/,
      );
      expect(dbMock.deletedPaths).toHaveLength(0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
