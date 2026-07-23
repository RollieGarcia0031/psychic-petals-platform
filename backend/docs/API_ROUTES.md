# API Routes Documentation

This document provides a comprehensive overview of the backend API routes located in `backend/routes/novels.js`. Each endpoint description includes the HTTP method, URL path, purpose, request payload schema, and example response payload.

---

## Table of Contents

| # | Method | Route | Description |
|---|--------|-------|-------------|
| 1 | `GET` | [`/api/novel`](#1-get-apinovel) | List all novels |
| 2 | `POST` | [`/api/novel/add`](#2-post-apinoveladd) | Create a new novel |
| 3 | `POST` | [`/api/novel/:id/episodes`](#3-post-apinovelidepisodes) | Add an episode |
| 4 | `GET` | [`/api/novel/:id/episodes`](#4-get-apinovelidepisodes) | Get all episodes |
| 5 | `GET` | [`/api/novel/:id/episodes/:episodeNumber/chapters`](#5-get-apinovelidepisodesepisodenumberchapters) | Get all chapters |
| 6 | `POST` | [`/api/novel/:id/episodes/:episodeNumber/chapters`](#6-post-apinovelidepisodesepisodenumberchapters) | Add a chapter |
| 7 | `PUT` | [`/api/novel/:id/episodes/:episodeNumber/chapters/:chapterNumber`](#7-put-apinovelidepisodesepisodenumberchapterschapternumber) | Update a chapter |

- [Validation Utilities](#validation-utilities)

---

## Base Path
All routes are prefixed with `/api/novel`.

---

### 1. GET `/api/novel`
**Purpose**: Retrieve a list of all novels.

**Request**: No payload.

**Response (200)**:
```json
{
  "success": true,
  "novels": [
    {
      "id": "<novelId>",
      "title": "<string>",
      "author": "<string>",
      "status": "draft | published | archived | completed"
    }
    // ... more novels
  ]
}
```

**Error (500)**:
```json
{
  "success": false,
  "message": "Failed to fetch novels.",
  "error": "<error message>"
}
```
---

### 2. POST `/api/novel/add`
**Purpose**: Create a new novel.

**Request Payload**:
```json
{
  "title": "<string>",            // required
  "author": "<string>",           // required
  "description": "<string>",      // optional, defaults to ""
  "status": "draft | published | archived | completed", // optional, defaults to "draft"
  "episodes": [],                  // optional, array of episodes (default [])
  "metadata": {
    "tags": [],                     // optional, array of strings
    "coverImage": "<string>",      // optional, URL or path
    "totalWords": 0                 // optional, number
  }
}
```
**Response (201)**:
```json
{
  "success": true,
  "message": "Novel created successfully.",
  "id": "<generatedNovelId>"
}
```
**Validation Failure (400)**:
```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": ["<validation error messages>"]
}
```
**Server Error (500)**:
```json
{
  "success": false,
  "message": "Failed to create novel.",
  "error": "<error message>"
}
```
---

### 3. POST `/api/novel/:id/episodes`
**Purpose**: Add a new episode to an existing novel.

**URL Parameters**:
- `id` – Novel document ID.

**Request Payload** (episode object):
```json
{
  "episodeNumber": <number>,   // optional – auto‑assigned if omitted
  "title": "<string>",
  "summary": "<string>",
  "published": <boolean>,
  "chapters": []               // optional – array of chapter objects
}
```
**Response (200)**:
```json
{
  "success": true,
  "message": "Episode added successfully.",
  "episode": { /* full episode object with assigned episodeNumber */ }
}
```
**Validation Failure (400)** – same shape as in route 2.

**Not Found (404)** – novel does not exist.

**Server Error (500)** – similar to previous routes.
---

### 4. GET `/api/novel/:id/episodes`
**Purpose**: Retrieve all episodes of a novel.

**Response (200)**:
```json
{
  "success": true,
  "episodes": [
    {
      "episodeNumber": <number>,
      "title": "<string>",
      "summary": "<string>",
      "published": <boolean>,
      "chapters": [ /* chapter objects */ ]
    }
    // ... more episodes
  ]
}
```
**Not Found (404)** – novel not found.
**Server Error (500)** – as above.
---

### 5. GET `/api/novel/:id/episodes/:episodeNumber/chapters`
**Purpose**: Retrieve all chapters of a specific episode.

**Response (200)**:
```json
{
  "success": true,
  "chapters": [
    {
      "chapterNumber": <number>,
      "title": "<string>",
      "content": "<string>",
      "wordCount": <number>,
      "lastEdited": "<ISO‑8601 date>",
      "notes": "<string>"
    }
    // ... more chapters
  ]
}
```
**Errors**: 404 for missing novel or episode, 500 for server issues.
---

### 6. POST `/api/novel/:id/episodes/:episodeNumber/chapters`
**Purpose**: Add a new chapter to a specific episode.

**Request Payload** (chapter object):
```json
{
  "chapterNumber": <number>,   // optional – auto‑assigned if omitted
  "title": "<string>",
  "content": "<string>",
  "wordCount": <number>,
  "lastEdited": "<ISO‑8601 date>",   // optional – defaults to now
  "notes": "<string>"
}
```
**Response (200)**:
```json
{
  "success": true,
  "message": "Chapter added successfully.",
  "chapter": { /* full chapter object with assigned chapterNumber */ }
}
```
**Validation Failure (400)** – same schema as earlier.
**Not Found (404)** – novel or episode missing.
**Server Error (500)** – as above.
---

### 7. PUT `/api/novel/:id/episodes/:episodeNumber/chapters/:chapterNumber`
**Purpose**: Update an existing chapter.

**Request Payload** – same shape as the chapter object (fields to update). `chapterNumber` path param is authoritative and will not be changed.

**Response (200)**:
```json
{
  "success": true,
  "message": "Chapter updated successfully.",
  "chapter": { /* updated chapter object */ }
}
```
**Validation Failure (400)** – payload validation.
**Not Found (404)** – novel, episode, or chapter missing.
**Server Error (500)** – as above.
---

## Validation Utilities
The route file imports helper functions from `../utils/novelUtils.js`:
- `validateNovelPayload` – ensures required fields for a novel.
- `validateEpisodePayload` – validates episode objects.
- `validateChapterPayload` – validates chapter objects.
- `buildNovelDocument`, `buildEpisodeObject`, `buildChapterObject` – create properly shaped Firestore documents.

These functions return an array of error strings; a non‑empty array triggers a **400 Bad Request** response.

---

