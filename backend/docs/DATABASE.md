# Database Schema Documentation

This document describes the database schema used for storing novels in our backend. The primary data store is **Firestore**.

## Collection: `novels`

Each document in the `novels` collection represents a single novel and contains its entire hierarchy, including episodes and chapters. This nested, document-oriented structure is ideal for Firestore, allowing you to retrieve a whole novel's structure efficiently in a single read.

### Document Structure

Below is an example of a novel document and a detailed breakdown of its fields.

#### Example Document

```json
{
  "_id": "novel_hello_world",
  "title": "Hello World",
  "description": "A story about greetings...",
  "author": "Your Name",
  "status": "draft",
  "createdAt": "2026-07-17T16:26:12Z",
  "updatedAt": "2026-07-17T16:26:12Z",
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "Episode 1: The Beginning",
      "summary": "Optional short summary",
      "published": false,
      "chapters": [
        {
          "chapterNumber": 1,
          "title": "Chapter 1: Awakening",
          "content": "Full text here... (Markdown or HTML)",
          "wordCount": 2450,
          "lastEdited": "2026-07-17T16:26:12Z",
          "notes": "Author's private notes..."
        },
        {
          "chapterNumber": 2,
          "title": "Chapter 2: The Journey",
          "content": "...",
          "wordCount": 3100,
          "lastEdited": "2026-07-17T16:26:12Z",
          "notes": ""
        }
      ]
    }
  ],
  "metadata": {
    "tags": ["fantasy", "slice-of-life"],
    "coverImage": "url-or-path",
    "totalWords": 12500
  }
}
```

---

### Field Definitions

#### Root Fields
- **`_id`** (`String`): The unique identifier for the novel document. In Firestore, this is typically the document ID itself.
- **`title`** (`String`): The main title of the novel.
- **`description`** (`String`): A summary, blurb, or synopsis of the novel.
- **`author`** (`String`): The name or pen name of the author.
- **`status`** (`String`): The current publication status (e.g., `"draft"`, `"published"`, `"archived"`, `"completed"`).
- **`createdAt`** (`String` or Firestore `Timestamp`): The date and time the novel was originally created.
- **`updatedAt`** (`String` or Firestore `Timestamp`): The date and time the novel was last modified.

#### `episodes` (Array)
An array of objects representing "Episodes". Episodes group multiple chapters together, functioning similarly to a "Volume", "Arc", or "Season" in a serialized story.
- **`episodeNumber`** (`Number`): The sequential ordering of the episode (e.g., 1, 2, 3).
- **`title`** (`String`): The title of the episode.
- **`summary`** (`String`): An optional short overview of the events within this episode.
- **`published`** (`Boolean`): A flag indicating whether this specific episode (and its published chapters) is visible to readers.

#### `chapters` (Array inside `episodes`)
An array of objects nested within each episode. These represent the actual readable content of the novel.
- **`chapterNumber`** (`Number`): The sequential ordering of the chapter *within* the episode.
- **`title`** (`String`): The title of the chapter.
- **`content`** (`String`): The actual full text of the chapter. This can be stored as plain text, Markdown, or HTML.
- **`wordCount`** (`Number`): The number of words in this specific chapter.
- **`lastEdited`** (`String` or Firestore `Timestamp`): The date and time the chapter content was last modified.
- **`notes`** (`String`): Private notes, outlines, or to-do lists from the author regarding this specific chapter (not visible to readers).

#### `metadata` (Object)
An object containing additional classification and display data for the novel. Grouping these fields keeps the root level clean.
- **`tags`** (`Array of Strings`): Genres or descriptors associated with the novel (e.g., `["fantasy", "slice-of-life"]`). Useful for querying and filtering.
- **`coverImage`** (`String`): A URL or storage path pointing to the novel's cover artwork.
- **`totalWords`** (`Number`): The aggregate word count of all chapters in the novel, often updated when a chapter is saved.
