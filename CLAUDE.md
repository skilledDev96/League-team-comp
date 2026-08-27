# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Frontend and backend are separate packages, with the Firebase project at the repo root:

- **`frontend/`** — the Angular app (**Bom Squad Draft Hub**). GitHub Pages deploys
  only this (see `.github/workflows/deploy.yml`, which filters on `frontend/**`).
- **`api/`** — the Cloud Functions. Its own `package.json`, `tsconfig` and build.
- **`e2e/`** — Playwright checks against the **deployed** system, not a local
  build. Its own package again; see `e2e/README.md`.
- **root** — `firebase.json`, `.firebaserc`, `firestore.rules`, and `scripts/`,
  which both packages share.

`firebase.json` points at `api/` via `"source": "api"`, so the folder name is ours
to choose. The `firebase deploy --only functions` command is *not* — "functions"
there is the Firebase product, not the directory.

## Commands

```bash
# from frontend/
npm start            # ng serve — dev server on http://localhost:4200
npm run build        # production build to dist/bom-squad
npm test             # vitest via @angular/build:unit-test
npm run watch        # dev build in watch mode

# from api/
npm test             # vitest run (Riot logic unit tests)
npm run build        # tsc build of the functions

# from e2e/ — runs against the live site and functions
npm test             # 10 public checks, +10 more if a test account is configured

# from the repo root, where firebase.json is
npm run deploy:functions   # firebase deploy --only functions (all five)
npm run deploy:rules       # firestore rules only
npm run key:check          # probe the Riot API key
```

Both packages install and build independently; there is no workspace linking them.
Each build stamps the current git SHA into its own `build-info.ts` via
`scripts/gen-build-info.mjs`, so a deployed frontend can be compared against a
deployed backend — Pages deploys itself, the functions do not.

Run the suite once (CI-style) with `npm test -- --no-watch`; filter with `npx ng test --include='**/ui.service.spec.ts'` or by test name. `src/test-setup.ts` (wired via `angular.json` `test.options.setupFiles`) polyfills `window.matchMedia` and stubs `fetch` so services that fetch on construction (e.g. `ChampionDataService`) stay offline in tests. Specs live next to their targets and cover pure logic rather than components: permissions (`core/access`), persistence (`services/team-data.service`, `core/strip-undefined`), the fearless draft maths (`pages/tournaments/draft.util`), the admin draft conversions (`pages/admin/admin-drafts`), and the shared utilities. The Cloud Functions have their own vitest suite covering the logic lifted out of `index.ts` — request validation, Riot error classification, match aggregation, player insights, cache trust and champion-overlap matching; run it with `npm run functions:test`. CI runs both unit suites before the builds, as separate jobs — `api` failing no
longer hides the frontend result.

The `e2e/` suite is deliberately **not** a pull-request gate: it exercises what
is deployed, so on a PR it would report on `main`. It runs after a Pages deploy
(`deploy.yml`, the `verify` job) and daily at 07:00 UTC
(`e2e-scheduled.yml`). Its most useful check asks whether `api/` has changed
since the commit the deployed backend reports — Pages publishes itself, the
functions do not, and that gap is how a broken enrichment endpoint once survived
until a user noticed.

## Local vs Firebase mode — the core runtime switch

`frontend/src/app/core/firebase.ts` `isFirebaseConfigured()` returns true when `environment.firebase.apiKey` **and** `projectId` are set. This single flag drives the whole app:

- **Firebase mode**: Firestore is the source of truth; login is Google sign-in gated by `access/{email}` role docs.
- **Local mode**: no backend. `TeamDataService` seeds from `SEED_DATA` into `localStorage` (`bom-team-data`), and `AuthService` treats *any* email/password as an admin session (`sessionStorage` flag `bom-local-auth`).

`environment.ts` is committed **with real Firebase web config**, so `npm start` runs against real Firebase and requires sign-in. To develop offline in local mode, blank the `apiKey` in `environment.ts` — **do not commit that change**. (Firebase web config is public by design; it is not a secret.)

## Architecture

**`TeamDataService` (`frontend/src/app/services/team-data.service.ts`) is the single source of truth.** Every page reads from its signals (`players`, `comps`, `compResults`, `fillIns`, `accessEntries`, `teamIdentity`, `macroSummary`, `resourceLinks`, `settings`). All writes go through `persistUpsert`/`persistRemove`, which branch on `this.mode`:
- Firebase mode → Firestore `setDoc`/`deleteDoc`, with `stripUndefined()` first (Firestore rejects `undefined` fields).
- Local mode → mutate the signal + `persistLocal()` to `localStorage`.

In Firebase mode the signals are kept live by `onSnapshot` listeners set up in `initFirebase()`. When adding a new persisted entity, wire **all** of: the model in `team.models.ts` + `TeamData`, a signal, an `onSnapshot` listener, `EntityKey`, `pushLocalToSignals`/`persistLocal`, `seedFirestore`, and CRUD methods — mirror how `compResults` is done.

**Firestore layout**: list collections `players`, `fillIns`, `comps`, `compResults`, `access`; singleton docs under `meta/` (`teamIdentity`, `macro`, `resourceLinks`, `settings`). `SEED_DATA` (`frontend/src/app/data/seed-data.ts`) is the one-time migration source and the local-mode seed; its shape must stay in sync with the `TeamData` interface.

**Auth & roles** (`frontend/src/app/services/auth.service.ts`): roles are `admin` / `contributor` / `viewer`. `canEdit()` is true for local mode, `admin`, or `contributor`; `canManageUsers()` for local mode or `admin`. A bootstrap admin email is hardcoded (`ruanhart7@gmail.com`) in both the service and `firestore.rules`. Content routes are gated by `viewerGuard` (`frontend/src/app/app.routes.ts`); `AuthService.ready`/`waitUntilReady()` prevents guard-redirect races on refresh.

**Firestore security** (`firestore.rules`, at the repo root): public read on everything; writes require `canEdit()` via the catch-all `match /{document=**}`, so a new collection is automatically covered (public read, editor write) — no rules change needed. `access` and `meta/settings` have their own stricter rules.

**Cloud Functions** (`api/src/`): `enrichPlayer`, `getTeamSynergy`, `getCompAnalysis` and `riotKeyHealth` are `onRequest` with `cors: true`; `checkRiotKey` is a scheduled probe. All use the `RIOT_API_KEY` secret and deploy to region `europe-west1` (see `SynergyService.functionUrl()`). `index.ts` holds the handlers and the Riot I/O; the logic they call sits in tested modules beside it (`parse-request`, `riot-errors`, `match-stats`, `insights`, `analysis-cache`, `comp-match`). Deploy **all** of them with `npm run deploy:functions` from the repo root.

**Pages and routes** (`frontend/src/app/app.routes.ts`, nav in `app/app.html`): every
route is lazy via `loadComponent`, and every content route is behind `viewerGuard`
(`/admin` uses `authGuard`). `/` and `/login` are the login page; the rest are
`/overview`, `/players` (player-intel), `/profiles`, `/player/:id`, `/comps`,
`/analysis`, `/review`, `/tournaments`, `/synergy`, `/admin`. Adding a page means
touching both files — the route alone leaves it unreachable.

**The analysis data flow** is worth knowing before touching either analysis page:

1. `CompAnalysisService.refresh()` POSTs the roster and comps to `getCompAnalysis`.
2. The function scans `match/v5/.../by-puuid/{puuid}/ids` for `TEAM_QUEUES`, caches
   each match at Firestore `matchCache/{matchId}` as a `CachedMatch` stamped with
   `CACHE_VERSION`, attributes games to comps, and returns a `CompAnalysis`.
3. That result is persisted into `TeamData.compAnalysis`, so pages read it from
   `TeamDataService.compAnalysis()` — **no page calls Riot directly.**
4. `/analysis` owns the Refresh button. `/review` is read-only over the same
   payload and answers a different question (why the games went the way they
   did), which is why it is a separate page rather than another panel. It
   toggles between losses and wins; `describeLoss` and `describeWin` in
   `api/src/objectives.ts` are deliberate mirrors on shared thresholds, and the
   page counts both through one `summarise` so the two cannot drift.

Adding a field to a cached match means **bumping `CACHE_VERSION`** in
`analysis-cache.ts`. Old entries then re-fetch once, inside `MAX_NEW_FETCHES` per
run — so the field is *absent* on some matches for several refreshes, and any UI
over it has to say so rather than render a zero. Riot rate limits hard; that
budget is the reason the cache exists at all.

**Which comp a game counts as** is decided in `api/src/comp-attribution.ts`, not
by the champion matcher alone. Two human corrections sit on top of `matchComp`:

- `Comp.countsUnder` — a standing rule folding one comp's games into another,
  for near-duplicate drafts kept separate to play from. Edited on the Comps page.
- `compOverrides/{matchId}` — one game placed by hand, for an off-book game that
  really was a known comp, or one the matcher read wrongly. Edited in the game
  panel on Analysis.

Precedence is explicit-beats-rule: an override names the comp, then that comp's
own `countsUnder` applies. `resolveAlias` guards against `countsUnder` cycles;
two separate edits can create one.

**The rules are applied twice, and both are needed.** The backend applies them so
the stored analysis and `perComp` are right. The browser applies them again in
`core/comp-alias.ts`, because the Analysis page re-derives comp membership from
`nearCompName` on every render so the strictness slider can respond without a
Riot call — and that re-derivation ignores `game.compId` entirely. Wiring only
the backend leaves an override visibly doing nothing: the game stays off the
books and the win rate never moves, which is exactly what shipped on 27 Aug 2026.
Anything that decides which comp a game belongs to must go through
`effectiveComp`, never `game.compId` alone.

Two questions are asked of a cached entry, and conflating them makes a
`CACHE_VERSION` bump silently do nothing:

- **`isCacheCurrent`** — has it got everything today's code reads? Only the
  current stamp counts. **Unversioned entries are stale, not fine**: versioning
  arrived on 23 Aug 2026, so the oldest entries carry no stamp at all and are
  exactly the ones most likely to be missing a new field.
- **`isCacheUsable`** — is it sound enough to serve when the budget is spent?
  A structural check. A stale entry still carries the roster and the result, so
  it is served rather than dropped; otherwise every match past the per-run budget
  would fall out of the win rates until the backfill caught up.

## Conventions

- **Angular 22, standalone components, signals throughout.** No NgModules; components declare their own `imports`. State is signals + `computed`; prefer this over RxJS for view state.
- Forms use `[ngModel]` + `(ngModelChange)` with `FormsModule` (template-driven, one-way bound to signals), not reactive forms — see `admin.component.html`.
- Styling is one global `frontend/src/styles.css` (no per-component styles) built on CSS custom properties. Theme is switched via `body[data-theme="..."]` (`dark`, `dark-blue`, `dark-red`, `light`); **always style through tokens** (`--accent`, `--text-0/1`, `--ok` for wins/positive, `--warn` for losses/negative, `--card-border`, `--surface-*`) so all four themes work.
- Shared UI lives in `frontend/src/app/shared/` (e.g. `overflow-menu.component.ts`, `champion-chip.component.ts`, `external-profiles.component.ts`); reuse these rather than re-rolling menus/chips.
- Commit messages in this repo are a single imperative summary line describing the user-facing change, often with a short rationale after a semicolon.
