import express from 'express';
import { db } from '../config/firebase.js';
import { validateNovelPayload, buildNovelDocument, validateEpisodePayload, buildEpisodeObject } from '../utils/novelUtils.js';

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
    
    // Using FieldValue from firebase-admin requires importing it.
    // We can also fetch, modify, and update the document.
    const novelData = doc.data();
    const episodes = novelData.episodes || [];
    
    // Automatically assign episodeNumber if not provided
    const newEpisodeNumber = req.body.episodeNumber ?? (episodes.length > 0 ? Math.max(...episodes.map(e => e.episodeNumber)) + 1 : 1);
    const episodeData = { ...req.body, episodeNumber: newEpisodeNumber };
    
    const newEpisode = buildEpisodeObject(episodeData);

    episodes.push(newEpisode);

    await novelRef.update({
      episodes: episodes,
      updatedAt: new Date().toISOString() // Or FieldValue.serverTimestamp() if imported
    });

    return res.status(200).json({
      success: true,
      message: 'Episode added successfully.',
      episode: newEpisode,
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

    const novelData = doc.data();
    const episodes = novelData.episodes || [];

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

export default router;
