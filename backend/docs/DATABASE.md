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
  "_id": "psychic_petals",
  "title": "Psychic Petals",
  "description": "A magical realism and slice of life novel...",
  "author": "RollieGarcia0031",
  "status": "draft",
  "createdAt": "2026-07-17T16:26:12Z",
  "updatedAt": "2026-07-24T18:30:00Z",
  "metadata": {
    "tags": ["magical-realism", "slice-of-life"],
    "coverImage": "url-or-path",
    "totalWords": 3350
  }
}
```

#### Field Definitions
- **`_id`** (`String`): The unique identifier for the novel document.
- **`title`** (`String`): The main title of the novel.
- **`description`** (`String`): A summary, blurb, or synopsis of the novel.
- **`author`** (`String`): The name or pen name of the author.
- **`status`** (`String`): The current publication status (e.g., `"draft"`, `"published"`, `"archived"`, `"completed"`).
- **`createdAt`** (`String` or Firestore `Timestamp`): The date and time the novel was originally created.
- **`updatedAt`** (`String` or Firestore `Timestamp`): The date and time the novel was last modified.
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
- **`totalWords`** (`Number`): The total words in this episode.

---

## 3. Subcollection: `chapters`

**Path:** `/novels/{novelId}/episodes/{episodeNumber}/chapters/{chapterNumber}`

Chapters represent the actual readable content of the novel. The document ID is the string representation of `chapterNumber` (e.g., `"1"`).

### Document Fields
- **`chapterNumber`** (`Number`): The sequential ordering of the chapter *within* the episode.
- **`title`** (`String`): The title of the chapter.
- **`slug`** (`String`): The URL slug derived from the chapter file name.
- **`content`** (`String`): The actual full text of the chapter (Markdown or HTML).
- **`wordCount`** (`Number`): The number of words in this specific chapter.
- **`lastEdited`** (`String` or Firestore `Timestamp`): The date and time the chapter content was last modified.
- **`notes`** (`String`): Private notes, outlines, or to-do lists from the author regarding this specific chapter.
