import express from 'express';
import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { validateNovelPayload, buildNovelDocument, validateEpisodePayload, buildEpisodeObject, validateChapterPayload, buildChapterObject } from '../utils/novelUtils.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/novel  –  Get a list of all novels
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/novel
 * @desc    Get a list of all novels including their IDs.
 */
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('novels').get();
    const novels = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      novels.push({
        id: doc.id,
        title: data.title,
        author: data.author,
        status: data.status,
      });
    });

    return res.status(200).json({
      success: true,
      novels,
    });
  } catch (error) {
    console.error('[GET /api/novel] Error fetching novels:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch novels.',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/novel/add  –  Create a new novel
// ---------------------------------------------------------------------------


/**
 * @route   POST /api/novel/add
 * @desc    Add a new novel to the Firestore `novels` collection.
 *
 * Request Body (JSON):
 * {
 *   "title":        string  (required)
 *   "author":       string  (required)
 *   "description":  string  (optional, default: "")
 *   "status":       "draft" | "published" | "archived" | "completed"
 *                           (optional, default: "draft")
 *   "episodes":     Episode[]  (optional, default: [])
 *   "metadata": {
 *     "tags":        string[]  (optional, default: [])
 *     "coverImage":  string    (optional, default: "")
 *     "totalWords":  number    (optional, default: 0)
 *   }
 * }
 *
 * Episode shape:
 * {
 *   "episodeNumber": number,
 *   "title":         string,
 *   "summary":       string,
 *   "published":     boolean,
 *   "chapters":      Chapter[]
 * }
 *
 * Chapter shape:
 * {
 *   "chapterNumber": number,
 *   "title":         string,
 *   "content":       string,
 *   "wordCount":     number,
 *   "lastEdited":    string (ISO 8601),
 *   "notes":         string
 * }
 */
router.post('/add', async (req, res) => {
  // --- Validation ---
  const errors = validateNovelPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  try {
    const novelDoc = buildNovelDocument(req.body);

    // Firestore auto-generates the document ID which acts as `_id`
    const docRef = await db.collection('novels').add(novelDoc);
    const novelId = docRef.id;

    // Save initial episodes and chapters if any
    if (Array.isArray(req.body.episodes) && req.body.episodes.length > 0) {
      const batch = db.batch();
      
      req.body.episodes.forEach((ep, epIdx) => {
        const episodeNumber = ep.episodeNumber ?? (epIdx + 1);
        const episodeRef = db.collection('novels').doc(novelId).collection('episodes').doc(episodeNumber.toString());
        const episodeObj = buildEpisodeObject({ ...ep, episodeNumber });
        
        // Remove chapters array from the episode document we store
        const { chapters, ...episodeData } = episodeObj;
        batch.set(episodeRef, episodeData);

        if (Array.isArray(ep.chapters) && ep.chapters.length > 0) {
          ep.chapters.forEach((ch, chIdx) => {
            const chapterNumber = ch.chapterNumber ?? (chIdx + 1);
            const chapterRef = episodeRef.collection('chapters').doc(chapterNumber.toString());
            const chapterObj = buildChapterObject({ ...ch, chapterNumber });
            batch.set(chapterRef, chapterObj);
          });
        }
      });

      await batch.commit();
    }

    return res.status(201).json({
      success: true,
      message: 'Novel created successfully.',
      id: docRef.id,
    });
  } catch (error) {
    console.error('[POST /api/novel/add] Error writing to Firestore:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create novel.',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/novel/:id/episodes  –  Add an episode to a novel
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/novel/:id/episodes
 * @desc    Add a new episode to a novel's `episodes` array.
 */
router.post('/:id/episodes', async (req, res) => {
  const novelId = req.params.id;

  const errors = validateEpisodePayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  try {
    const novelRef = db.collection('novels').doc(novelId);
    const doc = await novelRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Novel not found.',
      });
    }
    
    // Automatically assign episodeNumber if not provided by finding max episodeNumber in episodes subcollection
    let newEpisodeNumber = req.body.episodeNumber;
    if (newEpisodeNumber === undefined) {
      const lastEpisodeSnapshot = await novelRef.collection('episodes')
        .orderBy('episodeNumber', 'desc')
        .limit(1)
        .get();
      if (!lastEpisodeSnapshot.empty) {
        newEpisodeNumber = (lastEpisodeSnapshot.docs[0].data().episodeNumber || 0) + 1;
      } else {
        newEpisodeNumber = 1;
      }
    }
    
    const episodeData = { ...req.body, episodeNumber: newEpisodeNumber };
    const episodeObj = buildEpisodeObject(episodeData);

    const episodeRef = novelRef.collection('episodes').doc(newEpisodeNumber.toString());

    // Save episode document and its initial chapters if any
    const batch = db.batch();
    const { chapters, ...epDocData } = episodeObj;
    batch.set(episodeRef, epDocData);

    const addedChapters = [];
    if (Array.isArray(chapters) && chapters.length > 0) {
      chapters.forEach((ch, chIdx) => {
        const chapterNumber = ch.chapterNumber ?? (chIdx + 1);
        const chapterRef = episodeRef.collection('chapters').doc(chapterNumber.toString());
        const chapterObj = buildChapterObject({ ...ch, chapterNumber });
        batch.set(chapterRef, chapterObj);
        addedChapters.push(chapterObj);
      });
    }

    await batch.commit();

    await novelRef.update({
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: 'Episode added successfully.',
      episode: {
        ...epDocData,
        chapters: addedChapters,
      },
    });
  } catch (error) {
    console.error(`[POST /api/novel/${novelId}/episodes] Error adding episode:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add episode.',
      error: error.message,
    });
  }
});
// ---------------------------------------------------------------------------
// GET /api/novel/:id/episodes  –  Get all episodes of a novel
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/novel/:id/episodes
 * @desc    Get all episodes of a specific novel.
 */
router.get('/:id/episodes', async (req, res) => {
  const novelId = req.params.id;

  try {
    const novelRef = db.collection('novels').doc(novelId);
    const doc = await novelRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Novel not found.',
      });
    }

    const episodesSnapshot = await novelRef.collection('episodes').orderBy('episodeNumber').get();
    
    const episodes = await Promise.all(
      episodesSnapshot.docs.map(async (epDoc) => {
        const epData = epDoc.data();
        const chaptersSnapshot = await epDoc.ref.collection('chapters').orderBy('chapterNumber').get();
        const chapters = [];
        chaptersSnapshot.forEach((chDoc) => {
          chapters.push(chDoc.data());
        });
        return {
          ...epData,
          chapters,
        };
      })
    );

    return res.status(200).json({
      success: true,
      episodes,
    });
  } catch (error) {
    console.error(`[GET /api/novel/${novelId}/episodes] Error fetching episodes:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch episodes.',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/novel/:id/episodes/:episodeNumber/chapters  –  Get all chapters of an episode
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/novel/:id/episodes/:episodeNumber/chapters
 * @desc    Get all chapters of a specific episode in a novel.
 */
router.get('/:id/episodes/:episodeNumber/chapters', async (req, res) => {
  const novelId = req.params.id;
  const episodeNumber = parseInt(req.params.episodeNumber, 10);

  try {
    const novelRef = db.collection('novels').doc(novelId);
    const doc = await novelRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Novel not found.',
      });
    }

    const episodeRef = novelRef.collection('episodes').doc(episodeNumber.toString());
    const episodeDoc = await episodeRef.get();

    if (!episodeDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found.',
      });
    }

    const chaptersSnapshot = await episodeRef.collection('chapters').orderBy('chapterNumber').get();
    const chapters = [];
    chaptersSnapshot.forEach(chDoc => {
      chapters.push(chDoc.data());
    });

    return res.status(200).json({
      success: true,
      chapters,
    });
  } catch (error) {
    console.error(`[GET /api/novel/${novelId}/episodes/${episodeNumber}/chapters] Error fetching chapters:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chapters.',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/novel/:id/episodes/:episodeNumber/chapters  –  Add a new chapter to an episode
// ---------------------------------------------------------------------------

/**
 * @route   POST /api/novel/:id/episodes/:episodeNumber/chapters
 * @desc    Add a new chapter to a specific episode in a novel.
 */
router.post('/:id/episodes/:episodeNumber/chapters', async (req, res) => {
  const novelId = req.params.id;
  const episodeNumber = parseInt(req.params.episodeNumber, 10);

  const errors = validateChapterPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  try {
    const novelRef = db.collection('novels').doc(novelId);
    const doc = await novelRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Novel not found.',
      });
    }

    const episodeRef = novelRef.collection('episodes').doc(episodeNumber.toString());
    const episodeDoc = await episodeRef.get();

    if (!episodeDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found.',
      });
    }

    // Automatically assign chapterNumber if not provided
    let newChapterNumber = req.body.chapterNumber;
    if (newChapterNumber === undefined) {
      const lastChapterSnapshot = await episodeRef.collection('chapters')
        .orderBy('chapterNumber', 'desc')
        .limit(1)
        .get();
      if (!lastChapterSnapshot.empty) {
        newChapterNumber = (lastChapterSnapshot.docs[0].data().chapterNumber || 0) + 1;
      } else {
        newChapterNumber = 1;
      }
    }
    
    const chapterData = { ...req.body, chapterNumber: newChapterNumber };
    const newChapter = buildChapterObject(chapterData);

    await episodeRef.collection('chapters').doc(newChapterNumber.toString()).set(newChapter);

    await novelRef.update({
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: 'Chapter added successfully.',
      chapter: newChapter,
    });
  } catch (error) {
    console.error(`[POST /api/novel/${novelId}/episodes/${episodeNumber}/chapters] Error adding chapter:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add chapter.',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/novel/:id/episodes/:episodeNumber/chapters/:chapterNumber  –  Update an existing chapter
// ---------------------------------------------------------------------------

/**
 * @route   PUT /api/novel/:id/episodes/:episodeNumber/chapters/:chapterNumber
 * @desc    Update an existing chapter in a specific episode.
 */
router.put('/:id/episodes/:episodeNumber/chapters/:chapterNumber', async (req, res) => {
  const novelId = req.params.id;
  const episodeNumber = parseInt(req.params.episodeNumber, 10);
  const chapterNumber = parseInt(req.params.chapterNumber, 10);

  const errors = validateChapterPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  try {
    const novelRef = db.collection('novels').doc(novelId);
    const doc = await novelRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Novel not found.',
      });
    }

    const episodeRef = novelRef.collection('episodes').doc(episodeNumber.toString());
    const episodeDoc = await episodeRef.get();

    if (!episodeDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found.',
      });
    }

    const chapterRef = episodeRef.collection('chapters').doc(chapterNumber.toString());
    const chapterDoc = await chapterRef.get();

    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found.',
      });
    }

    const updatedChapterData = {
      ...chapterDoc.data(),
      ...req.body,
      chapterNumber: chapterNumber, // keep the path parameter chapterNumber
      lastEdited: new Date().toISOString()
    };

    const updatedChapter = buildChapterObject(updatedChapterData);

    await chapterRef.set(updatedChapter);

    await novelRef.update({
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: 'Chapter updated successfully.',
      chapter: updatedChapter,
    });
  } catch (error) {
    console.error(`[PUT /api/novel/${novelId}/episodes/${episodeNumber}/chapters/${chapterNumber}] Error updating chapter:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update chapter.',
      error: error.message,
    });
  }
});

export default router;
