# Copilot instructions — Bom Squad Draft Hub

The canonical, fuller guide is [`CLAUDE.md`](../CLAUDE.md) at the repo root. Read it for architecture detail. Key points:

## Repo shape
- **Angular app** in `frontend/`, **Cloud Functions** in `api/`, Firebase config at the repo root. GitHub Pages deploys only `frontend/`.

## Commands (from `frontend/`, unless noted)
- `npm start` — dev server (localhost:4200)
- `npm run build` — production build
- `npm test` — vitest (note: `app.spec.ts` is stale default scaffold and fails)
- Cloud Functions: `npm test` / `npm run build` from `api/`; deploy with `npm run deploy:functions` from the repo root

## Architecture essentials
- **`TeamDataService` is the single source of truth.** All pages read its signals; all writes go through `persistUpsert`/`persistRemove`, which branch on `mode`.
- **Dual mode** via `isFirebaseConfigured()` (`core/firebase.ts`): Firebase (Firestore + Google auth) when `apiKey`+`projectId` are set, else **local mode** (localStorage seeded from `SEED_DATA`, "Enter local preview" = admin). `environment.ts` ships real Firebase web config, so `npm start` hits real Firebase; to work offline, blank `apiKey` locally and **don't commit it**.
- Adding a persisted entity means touching all of: `team.models.ts` + `TeamData`, a signal, an `onSnapshot` listener, `EntityKey`, `pushLocalToSignals`/`persistLocal`, `seedFirestore`, CRUD — mirror `compResults`.
- Firestore: list collections (`players`, `fillIns`, `comps`, `compResults`, `access`) + `meta/*` singletons. Rules: public read, `canEdit()` write via catch-all, so new collections need no rules change.
- Cloud Functions (`api/src/index.ts`): `enrichPlayer`, `getOpponentHistory`, `getCompAnalysis`, `refreshTeamDataOnce`, `draftAdvice`, `gameReview`, `riotKeyHealth`, `syncChampionTraits`, `crawlOnce` and `buildMatchupIndexOnce` are `onRequest` with `cors: true` (every one but `riotKeyHealth` takes a Firebase ID token; the last three are admin-only manual triggers, POST, through `admitAdmin` in `api/src/admin-auth.ts`), and `refreshTeamData`, `refreshTeams`, `checkRiotKey`, `refreshChampionTraits`, `crawlChampionStats` and `buildMatchupIndex` are scheduled — sixteen in all; `RIOT_API_KEY` secret on the Riot ones, `ANTHROPIC_API_KEY` on `draftAdvice`, `gameReview` and the morning `refreshTeamData` and `refreshTeams`, region `europe-west1`. `CLAUDE.md` says what each does. The team-scoped functions work for one team through `computeCompAnalysis`, `reviewGame` and `runTeamRefresh`: `getCompAnalysis`, `gameReview` and `refreshTeamDataOnce` take an optional `teamId` (absent is the root, Bom Squad), `refreshTeamData` at 06:30 is the root's, and `refreshTeams` (07:00 to 07:45, one non-default team a tick) picks its team from the root `teams` list; a team id puts every team read and write under `teams/{teamId}/` through `api/src/team-scope.ts`, and the response echoes the `teamId` it resolved to.

## Conventions
- Angular 22, **standalone components + signals** (no NgModules, minimal RxJS for view state).
- Template-driven forms: `[ngModel]` + `(ngModelChange)` with `FormsModule`.
- One global `styles.css` with CSS-variable tokens; theme via `body[data-theme]` (`dark`/`dark-blue`/`dark-red`/`light`). Style through tokens (`--ok` = win/positive, `--warn` = loss/negative) so all themes work.
- Reuse shared components in `app/src/app/shared/` (overflow menu, champion chip, external profiles).
- Commits: single imperative summary line, optional rationale after a semicolon.
