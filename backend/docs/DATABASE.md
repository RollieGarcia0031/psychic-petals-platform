# Database Schema Documentation

This document describes the database schema used for storing novels in our backend. The primary data store is **Firestore**.

To avoid large document size limits and allow scaling, the data model organizes episodes and chapters as **subcollections** under each novel document.

---

## 1. Collection: `novels`

Each document in the `novels` collection represents a single novel and contains its metadata.

### Root Document Structure

Below is an example of a novel document structure and field definitions.

#### Example Document (`/novels/psychic_petals`)

```json
{
  "title": "Psychic Petals",
  "description": "A magical realism and slice of life novel...",
  "author": "RollieGarcia0031",
  "status": "draft",
  "createdAt": "<Firestore Timestamp or ISO string>",
  "updatedAt": "<Firestore Timestamp or ISO string>",
  "metadata": {
    "tags": ["magical-realism", "slice-of-life"],
    "coverImage": "url-or-path",
    "totalWords": 3350
  }
}
```

> **Note:** The `_id` is **not** stored as a document field — it is the Firestore document ID. The API routes rely on Firestore's auto-generated ID, while the sync script writes the constant `"psychic_petals"` as the document ID (and optionally stores it as a `_id` field).

#### Field Definitions
- **`_id`** (`String`): The unique identifier for the novel document. Stored as the Firestore document ID (not a field in the document).
- **`title`** (`String`): The main title of the novel.
- **`description`** (`String`): A summary, blurb, or synopsis of the novel.
- **`author`** (`String`): The name or pen name of the author.
- **`status`** (`String`): The current publication status (e.g., `"draft"`, `"published"`, `"archived"`, `"completed"`).
- **`createdAt`** (`Firestore Timestamp` or `String`): The date and time the novel was originally created. The API routes use `FieldValue.serverTimestamp()`; the sync script uses an ISO 8601 string.
- **`updatedAt`** (`Firestore Timestamp` or `String`): The date and time the novel was last modified. Same pattern as `createdAt`.
- **`metadata`** (`Object`):
  - **`tags`** (`Array of Strings`): Genres or descriptors associated with the novel (e.g., `["fantasy", "slice-of-life"]`).
  - **`coverImage`** (`String`): A URL or storage path pointing to the novel's cover artwork.
  - **`totalWords`** (`Number`): The aggregate word count of all chapters in the novel.

---

## 2. Subcollection: `episodes`

**Path:** `/novels/{novelId}/episodes/{episodeNumber}`

Episodes group multiple chapters together, functioning similarly to a "Volume", "Arc", or "Season". The document ID is the string representation of `episodeNumber` (e.g., `"1"`).

### Document Fields
- **`episodeNumber`** (`Number`): The sequential ordering of the episode (e.g., 1, 2, 3).
- **`title`** (`String`): The title of the episode.
- **`summary`** (`String`): An optional short overview of the events within this episode.
- **`published`** (`Boolean`): A flag indicating whether this specific episode is visible to readers.
- **`totalWords`** (`Number`, *sync-script only*): The total words in this episode. Calculated and set by the `scripts/sync-novel.js` sync script; not written by the API routes.

---

## 3. Subcollection: `chapters`

**Path:** `/novels/{novelId}/episodes/{episodeNumber}/chapters/{chapterNumber}`

Chapters represent the actual readable content of the novel. The document ID is the string representation of `chapterNumber` (e.g., `"1"`).

### Document Fields
- **`chapterNumber`** (`Number`): The sequential ordering of the chapter *within* the episode.
- **`title`** (`String`): The title of the chapter.
- **`slug`** (`String`, *sync-script only*): The URL slug derived from the chapter file name. Set by `scripts/sync-novel.js`; not written by the API routes.
- **`content`** (`String`): The actual full text of the chapter (Markdown or HTML).
- **`wordCount`** (`Number`): The number of words in this specific chapter.
- **`lastEdited`** (`String`): The ISO 8601 date-time when the chapter content was last modified. Set by the API routes and the sync script alike.
- **`notes`** (`String`): Private notes, outlines, or to-do lists from the author regarding this specific chapter.
