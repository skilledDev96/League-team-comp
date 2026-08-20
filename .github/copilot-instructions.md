# Copilot instructions — Bom Squad Draft Hub

The canonical, fuller guide is [`CLAUDE.md`](../CLAUDE.md) at the repo root. Read it for architecture detail. Key points:

## Repo shape
- Two apps: a **legacy static site** at the repo root (`index.html`, `scripts/`, `styles/`) and the **active Angular app** in `app/`. All new work is in `app/`. GitHub Pages deploys only `app/`.

## Commands (from `app/`)
- `npm start` — dev server (localhost:4200)
- `npm run build` — production build
- `npm test` — vitest (note: `app.spec.ts` is stale default scaffold and fails)
- `npm run functions:build` / `functions:deploy` — Cloud Functions in `app/functions`

## Architecture essentials
- **`TeamDataService` is the single source of truth.** All pages read its signals; all writes go through `persistUpsert`/`persistRemove`, which branch on `mode`.
- **Dual mode** via `isFirebaseConfigured()` (`core/firebase.ts`): Firebase (Firestore + Google auth) when `apiKey`+`projectId` are set, else **local mode** (localStorage seeded from `SEED_DATA`, any login = admin). `environment.ts` ships real Firebase web config, so `npm start` hits real Firebase; to work offline, blank `apiKey` locally and **don't commit it**.
- Adding a persisted entity means touching all of: `team.models.ts` + `TeamData`, a signal, an `onSnapshot` listener, `EntityKey`, `pushLocalToSignals`/`persistLocal`, `seedFirestore`, CRUD — mirror `compResults`.
- Firestore: list collections (`players`, `fillIns`, `comps`, `compResults`, `access`) + `meta/*` singletons. Rules: public read, `canEdit()` write via catch-all, so new collections need no rules change.
- Cloud Functions (`app/functions/src/index.ts`): `enrichPlayer`, `getTeamSynergy` — `onRequest`, `RIOT_API_KEY` secret, region `europe-west1`.

## Conventions
- Angular 22, **standalone components + signals** (no NgModules, minimal RxJS for view state).
- Template-driven forms: `[ngModel]` + `(ngModelChange)` with `FormsModule`.
- One global `styles.css` with CSS-variable tokens; theme via `body[data-theme]` (`dark`/`dark-blue`/`dark-red`/`light`). Style through tokens (`--ok` = win/positive, `--warn` = loss/negative) so all themes work.
- Reuse shared components in `app/src/app/shared/` (overflow menu, champion chip, external profiles).
- Commits: single imperative summary line, optional rationale after a semicolon.
