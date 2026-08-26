# Bom Squad Draft Hub

A data-driven League of Legends prep app for the Bom Squad team — drafts, comps
and macro, a tactical board, real match analysis from the Riot API, and per-player
development tracking.

The app is an Angular single-page app in [`frontend/`](frontend/), deployed to GitHub Pages,
with a Firebase (Firestore + Auth) backend and Cloud Functions for Riot API access.

## Run locally

```bash
cd app
npm install
npm start        # dev server on http://localhost:4200
```

By default the dev server runs against the configured Firebase project (sign-in
required). To develop offline, blank `apiKey` in `src/environments/environment.ts`
(do not commit that) and the app falls back to in-browser local storage.

## Common commands (from `frontend/`)

- `npm start` — dev server
- `npm run build` — production build
- `npm test -- --no-watch` — unit tests (vitest)
- `npm run functions:build` / `npm run functions:deploy` — Cloud Functions

## Architecture

See [`CLAUDE.md`](CLAUDE.md) for the full architecture notes — the `TeamDataService`
single source of truth, the local/Firebase dual mode, Firestore layout, and the
Cloud Functions (`enrichPlayer`, `getTeamSynergy`, `getCompAnalysis`).

Deployment is automatic: pushing to `main` with changes under `frontend/**` publishes
the app to GitHub Pages via the workflow in `.github/workflows/deploy.yml`.
