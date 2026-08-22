# Psychic Petals Platform - Backend

This directory contains the backend API service for **Psychic Petals**, a novel platform.

## Overview

The primary purpose of this backend is to provide a robust API service for saving, managing, and retrieving the content of the novel "Psychic Petals". 

The novel itself is maintained and versioned in its own dedicated GitHub repository:
[https://github.com/RollieGarcia0031/psychic-petals](https://github.com/RollieGarcia0031/psychic-petals).

This backend acts as the bridge between the storage/database layer (Firestore) and client applications (such as a frontend web reader). It handles the retrieval of episodes and chapters to be served to readers, as well as the saving of new content and updates to the novel's metadata.

## Documentation

For more information on how the novel data is structured and stored within our database, please refer to the database schema documentation:
- [Database Schema Documentation (Firestore)](./docs/DATABASE.md)

## Scripts

Both scripts are standalone CLIs run from this directory. They require `.env` with
`FIREBASE_SERVICE_ACCOUNT_KEY` (Base64-encoded service-account JSON) — see `.env.example`.

### `scripts/sync-novel.js` — incremental prose sync

Syncs changed/deleted Markdown chapter files into Firestore, reconciling each language
version independently:

```bash
node scripts/sync-novel.js \
  --novel-dir ../psychic-petals-novel \
  --changed main/en/episode-01/01-unlabeled-maps.md \
  --deleted main/tl/episode-01/02-tahanan.md
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--novel-dir` | yes | Path to the novel repository root. |
| `--changed` | no | Comma-separated story paths added/modified since last sync. |
| `--deleted` | no | Comma-separated story paths removed since last sync. |
| `--novel-id` | no | Base novel document ID override (default: `psychic_petals`). |

Chapter routing by path prefix: `main/en/…` and legacy `main/episode-NN/…` target
`novels/psychic_petals`; any other two-letter prefix (e.g. `main/tl/…`) targets its own
`novels/psychic_petals_{lang}` document. Reconciliation runs per version so languages
self-heal without touching each other. Chapter YAML frontmatter (`title`, `episode`,
`chapter`, `status`, `translationOf`) overrides H1/path-derived values — see
[DATABASE.md](./docs/DATABASE.md).

### `scripts/reset-novel.js` — destructive nuke-and-rebuild recovery tool

> **WARNING: destructive by design.** Unlike the sync script's reconciliation (which only
> removes orphaned chapter docs), reset deletes **everything** under the target novel
> documents — root doc plus `episodes` and `chapters` subcollections — and rebuilds purely
> from disk. This also wipes API-managed fields such as chapter **`notes`** set through the
> dashboard, plus any metadata not derivable from files. Only use when the on-disk novel
> content is known-good.

```bash
# Dry summary first (prints what would be deleted, then refuses):
node scripts/reset-novel.js --novel-dir ../psychic-petals-novel

# Reset every language version found on disk:
node scripts/reset-novel.js --novel-dir ../psychic-petals-novel --yes

# Reset only the Tagalog version:
node scripts/reset-novel.js --novel-dir ../psychic-petals-novel --lang tl --yes
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--novel-dir` | yes | Path to the novel repository root (must contain `main/`). |
| `--novel-id` | no | Base novel document ID override (default: `psychic_petals`). |
| `--lang` | no | Two-letter filter to reset a single version (e.g. `tl`; `en` = base). |
| `--yes` | yes* | Explicit confirmation flag; the script refuses to run without it. |

\* The script prints a per-document deletion summary (episode/chapter counts) before
asking for confirmation, and additionally refuses to operate on a `--novel-dir` that has
no `main/` folder — even with `--yes`.
