# AGENTS.md

## Repo structure

Two independent packages — **no workspace-level `package.json`**. Each has its own `node_modules/` and `package-lock.json`.

| Directory | Stack | Entry point |
|-----------|-------|-------------|
| `backend/` | Express 5 (ESM) + Firebase Admin (Firestore) | `backend/index.js` |
| `frontend/` | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 | `frontend/app/` |

## Backend

**Run from `backend/`.**

- `npm run dev` — start with nodemon (port 3000)
- `npm test` — vitest (runs `scripts/**/*.test.js` and `utils/**/*.test.js`)
- `npm run test:watch` — vitest in watch mode

Requires `.env` — see `backend/.env.example`. The key secret is `FIREBASE_SERVICE_ACCOUNT_KEY`, which must be a **Base64-encoded** Firebase service-account JSON file.

Firestore path pattern: `novels/{novelId}/episodes/{episodeNumber}/chapters/{chapterNumber}`

`scripts/sync-novel.js` is a standalone CLI that syncs markdown chapter files to Firestore. It is not imported by the Express server.

## Frontend

**Run from `frontend/`.**

- `npm run dev` — Next.js dev server (port 3000)
- `npm run build` — production build
- `npm run lint` — ESLint (next core-web-vitals + typescript)

Requires `.env` — see `frontend/.env.example`. Uses Firebase client SDK for auth and Firestore reads.

### Next.js 16 warning

This is **Next.js 16** — it has breaking changes from earlier versions. Before writing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`. Existing `frontend/AGENTS.md` has details.

### UI components

Uses **shadcn** (base-nova style) with `lucide-react` icons. Components live in `frontend/components/ui/`. Path alias: `@/*` → `frontend/*`.

### Auth

Session middleware is in `frontend/proxy.ts`. Auth flow uses `frontend/lib/firebase-session.ts` and `frontend/lib/firebase.ts`.

## Story file layout

Chapters are markdown files under a separate repo, synced via `backend/scripts/sync-novel.js`:
```
main/episode-NN/NN-slug.md
```
Both numeric prefixes are required for stable Firestore locations.
