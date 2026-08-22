# Database Schema Documentation

This document describes the database schema used for storing novels in our backend. The primary data store is **Firestore**.

To avoid large document size limits and allow scaling, the data model organizes episodes and chapters as **subcollections** under each novel document.

---

## Language Versions

Each language version of the story is stored as its **own novel document** in the same collection, following an ID suffix convention:

| Version | Novel Document ID | Source directory |
|---------|-------------------|------------------|
| English (canonical) | `psychic_petals` | `main/en/episode-NN/…` (legacy: `main/episode-NN/…`) |
| Tagalog | `psychic_petals_tl` | `main/tl/episode-NN/…` |

The sync script (`scripts/sync-novel.js`) derives the target document from the story file's path prefix:

```text
main/episode-NN/NN-slug.md      →  novels/psychic_petals/episodes/N/chapters/M
main/en/episode-NN/NN-slug.md   →  novels/psychic_petals/episodes/N/chapters/M
main/tl/episode-NN/NN-slug.md   →  novels/psychic_petals_tl/episodes/N/chapters/M
main/{lang}/episode-NN/…        →  novels/psychic_petals_{lang}/episodes/N/chapters/M
```

Chapter numbers stay aligned **1:1 across versions** — chapter `2` in `psychic_petals_tl` is the translation of chapter `2` in `psychic_petals`. This lets readers switch languages without losing their position.

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
  "language": "en",
  "createdAt": "<Firestore Timestamp or ISO string>",
  "updatedAt": "<Firestore Timestamp or ISO string>",
  "metadata": {
    "tags": ["magical-realism", "slice-of-life"],
    "coverImage": "url-or-path",
    "totalWords": 3350
  }
}
```

> **Note:** The `_id` is **not** stored as a document field — it is the Firestore document ID. The API routes rely on Firestore's auto-generated ID, while the sync script writes the constant `"psychic_petals"` as the document ID (and optionally stores it as a `_id` field). Translated versions use suffixed IDs (e.g., `"psychic_petals_tl"`) — see [Language Versions](#language-versions).

#### Field Definitions
- **`_id`** (`String`): The unique identifier for the novel document. Stored as the Firestore document ID (not a field in the document).
- **`title`** (`String`): The main title of the novel.
- **`description`** (`String`): A summary, blurb, or synopsis of the novel.
- **`author`** (`String`): The name or pen name of the author.
- **`status`** (`String`): The current publication status (e.g., `"draft"`, `"published"`, `"archived"`, `"completed"`).
- **`language`** (`String`, *sync-script only*): ISO 639-1 code of this version's language (`"en"`, `"tl"`, …). Derived from the story path prefix; defaults to `"en"` for legacy unprefixed paths. Used by the frontend for the language switcher.
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
- **`language`** (`String`, *sync-script only*): ISO 639-1 code of this chapter's prose (`"en"`, `"tl"`, …). Matches the parent novel's `language` field; derived from the story file's path prefix.
- **`status`** (`String`, *sync-script only*): Drafting workflow status taken from the chapter file's YAML frontmatter (e.g., `"draft"`, `"final"`). Empty string when the file has no frontmatter.
- **`translationOf`** (`String`, *sync-script only*): For translated chapters, a reference to the source chapter this text translates, formatted as `"{episodeNumber}/{chapterNumber}"` (e.g., `"1/2"` = English episode 1, chapter 2). Set via YAML frontmatter; empty string on original-language chapters.

#### Chapter Frontmatter

Translated chapters declare their metadata in YAML frontmatter so identity survives
file renames and translations stay linked to their source:

```markdown
---
title: Tahanan
episode: 1
chapter: 2
status: draft
translationOf: 1/2
---

# Tahanan

Prose starts here…
```

Frontmatter values override defaults derived from the file path and first `#`
heading. Files without frontmatter continue to sync exactly as before (legacy
English layout included).
