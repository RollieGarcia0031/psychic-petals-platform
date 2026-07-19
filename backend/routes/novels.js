import express from 'express';
import { db } from '../config/firebase.js';
import { validateNovelPayload, buildNovelDocument } from '../utils/novelUtils.js';

const router = express.Router();

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

export default router;
