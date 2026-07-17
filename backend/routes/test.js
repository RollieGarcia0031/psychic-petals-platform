import express from 'express';
import { db } from '../config/firebase.js';

const router = express.Router();

router.post('/test-db', async (req, res) => {
  try {
    const data = req.body;

    // Add a new document with a generated id to the 'test_collection'
    const docRef = await db.collection('test_collection').add({
      ...data,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Document successfully written!',
      id: docRef.id
    });

  } catch (error) {
    console.error('Error writing to database:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
