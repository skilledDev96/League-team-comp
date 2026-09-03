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

**Firestore layout**: list collections `players`, `fillIns`, `comps`, `compResults`, `scrims`, `scrimOpponents`, `access`; singleton docs under `meta/` (`teamIdentity`, `macro`, `resourceLinks`, `settings`). `SEED_DATA` (`frontend/src/app/data/seed-data.ts`) is the one-time migration source and the local-mode seed; its shape must stay in sync with the `TeamData` interface.

**Auth & roles** (`frontend/src/app/services/auth.service.ts`): roles are `admin` / `contributor` / `viewer`. `canEdit()` is true for local mode, `admin`, or `contributor`; `canManageUsers()` for local mode or `admin`. A bootstrap admin email is hardcoded (`ruanhart7@gmail.com`) in both the service and `firestore.rules`. Content routes are gated by `viewerGuard` (`frontend/src/app/app.routes.ts`); `AuthService.ready`/`waitUntilReady()` prevents guard-redirect races on refresh.

**Firestore security** (`firestore.rules`, at the repo root): public read on everything; writes require `canEdit()` via the catch-all `match /{document=**}`, so a new collection is automatically covered (public read, editor write) — no rules change needed. `access` and `meta/settings` have their own stricter rules.

**Cloud Functions** (`api/src/`): `enrichPlayer`, `getTeamSynergy`, `getCompAnalysis` and `riotKeyHealth` are `onRequest` with `cors: true`; `checkRiotKey` is a scheduled probe. All use the `RIOT_API_KEY` secret and deploy to region `europe-west1` (see `SynergyService.functionUrl()`). `index.ts` holds the handlers and the Riot I/O; the logic they call sits in tested modules beside it (`parse-request`, `riot-errors`, `match-stats`, `insights`, `analysis-cache`, `comp-match`). Deploy **all** of them with `npm run deploy:functions` from the repo root.

**Pages and routes** (`frontend/src/app/app.routes.ts`, nav in `app/app.html`): every
route is lazy via `loadComponent`, and every content route is behind `viewerGuard`
(`/admin` uses `authGuard`). `/` and `/login` are the login page; the rest are
`/roster`, `/player/:id`, `/comps`, `/analysis`, `/review`, `/tournaments`,
`/synergy`, `/admin`. Adding a page means touching both files — the route alone
leaves it unreachable.

**`/roster` is one page with three modes**, in `pages/roster/`: Cards
(`OverviewComponent`), Table (`TeamProfilesComponent`) and Scouting
(`PlayerIntelComponent`). They were three nav entries answering the same
question at different depths. The shell hosts the three existing components
rather than replacing them — each keeps its own state and controls, and passes
`embedded` so only the shell renders a heading. `@switch` means only the
selected one is alive.

`/overview`, `/players` and `/profiles` **still resolve**, each carrying
`data: { view }` naming the mode it used to be, so old links and the `e2e`
suite land where they always did. Do not turn them into redirects without
checking `e2e/tests/authenticated.spec.ts`, which navigates to `./players`.

**`/scrims` groups replays by opponent, and a scrim opponent is a first-class
record.** A scrim arrives as one `.rofl` with a free-text opponent name; the page
folds them by `slugOpponent(name)` (`pages/scrims/scrim-groups.ts`, pure and
tested) so "MOSS", "moss" and "Moss " are one team. `ScrimOpponent` (keyed by that
same slug, collection `scrimOpponents`) carries the notes, target bans and
scouted roster a `TournamentSeries` carries — the same panel, the same
`OpponentScoutService` (its `scoutRoster` is generic; `scoutSeries` and
`scoutScrimOpponent` are thin wrappers that only differ in where the result is
written). There is no "add opponent" step: the record is created the first time
anything is saved against a group. **The roster table's read-side helpers live in
`core/opponent-view.ts`** (`queueRows`, `reseatOpponent`, `recentForSeat`, the
rate bands…) and are shared by the plan page and the scrims page; do not re-add
copies to either component. `core/note-lines.ts` is likewise the one note parser.

**`/tournaments` → Draft is a live draft room**, used while a draft is actually
happening, and that constraint drives its design. `pages/tournaments/draft/`
holds the component; the rules it obeys are pure and tested next door in
`pages/tournaments/draft-sequence.ts`.

- **The sequence is data, not branching.** `DRAFT_SEQUENCE` is the twenty
  competitive steps — 3 bans each, 6 picks, 2 bans each, 4 picks — so "whose
  turn", "ban or pick" and "are we done" are lookups. `SeriesGame.ourSide` and
  `SeriesGame.draftStep` persist where a game is; both are absent on games saved
  before this existed, which open at step one rather than appearing finished.
- **A champion is held, then confirmed.** Confirming advances the step and
  restarts the 30s clock. `seatFor` proposes the seat from the champion's real
  lane, shown before confirming — picks land in *draft* order, not role order.
- **`bansForTeam` recovers who banned what.** Bans are one flat list because
  under fearless a ban is a ban whoever made it; the sequence appends in turn
  order, so `BAN_TEAMS` reads the team back off the position without storing it.
  A game filled in freely has no such order and is not split on a guess.
- **The free-form controls must stand down while a sequence runs.** The seat ×,
  the ban chip ×, Clear all and the ban typeahead all edit the board *without*
  moving `draftStep`; clearing one pick once left a draft a step ahead of its own
  board, reaching the second ban phase showing five picks instead of six. Undo
  moves both together; Reset wipes the game.
- **Nothing on this screen may change layout height when its state changes.**
  Three separate causes of the page jumping were found and fixed — the champion
  wall had a `max-height` so filtering shrank it, the champion-count line only
  rendered when filtered, and the confirm row appeared conditionally. All now
  occupy reserved space (`.draft-head`, `.draft-confirm-slot`, a fixed grid
  height). Verify a change here by measuring an element's `top` across every
  filter and state, not by eye.
- **The clock is a reminder, not a referee** — it never advances the draft or
  discards a pick. The real clock is in the League client.
- **The page scrolls sideways by ~8px here, and that is a known, accepted
  quirk** (decided 3 Sep 2026 — do not re-raise it as a bug). `.draft-page`
  breaks out of the page column with `margin-inline: calc(50% - 50vw + var(--sbw)/2)`;
  `100vw` counts the vertical scrollbar and the usable width does not, so the
  breakout overshoots by exactly a scrollbar. `--sbw` exists to subtract it and
  reads `0px`: `app.ts` measures it on startup, on `resize`, and via a
  `ResizeObserver` on `body` — but the champion wall scrolls inside its own box,
  so the body's geometry never changes and the observer never fires at a moment
  when the scrollbar exists. Nothing is clipped and the user has chosen to live
  with it. If it ever matters, `overflow-x: clip` on the container masks it in
  one line; repairing the measurement properly means touching the app root.

**Champion lanes come from pro match data, not from Riot.** Riot's champion tags
are *classes*: Gragas is a Fighter in all three of his lanes, and "Support" is
both a tag and a lane. Data Dragon and CommunityDragon carry no position data at
all. `scripts/gen-champion-lanes.mjs` derives
`frontend/src/app/data/champion-lanes.ts` from an Oracle's Elixir export (that
dataset is published for analysts, which is what makes it the compliant source);
read it through `core/champion-lanes.ts`. The CSV is ~64 MB and deliberately not
committed — re-download and re-run to refresh. Flex picks keep **every** lane
they are genuinely played in, and a champion with no pro games passes every lane
filter rather than none, so it can never become unpickable.

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
   `api/src/fights.ts` adds the kill tally on top, which is what separates a
   game lost *in the fights* from one lost *on the map* — two losses that read
   identically without it and need opposite work. It costs no Riot calls: every
   participant is already cached, so it applies to every game, not just the
   freshly fetched ones.

Adding a field to a cached match means **bumping `CACHE_VERSION`** in
`analysis-cache.ts`. Old entries then re-fetch once, inside `MAX_NEW_FETCHES` per
run — so the field is *absent* on some matches for several refreshes, and any UI
over it has to say so rather than render a zero. Riot rate limits hard; that
budget is the reason the cache exists at all.

**`matchCache` is shared, and player enrichment reads it before Riot.**
`enrichPlayer` used to read a fixed twelve matches per queue because each was a
Riot call. It now asks for `ENRICH_SAMPLE_SIZE` (40) match ids — one call at any
length — reads them from `matchCache` in a single `getAll`, and spends Riot
calls only on the ids that miss, capped at `MAX_ENRICH_FETCHES` (12, the old
sample size, so a cold cache is never worse than before). Everything fetched is
written back through `getCachedMatch`, so a second run over the same player is
cheaper than the first.

The cache only covers `TEAM_QUEUES` (440 flex, 700 clash), so **solo queue
starts cold** and warms as enrichment runs; flex — the queue
`fetchRiotEnrichment` treats as primary — is warm from the comp analysis. The
split of cached-versus-fetch lives in `api/src/enrich-sample.ts` (`planSample`,
`cachedToMatch`) and is tested there.

`planSample` deliberately accepts a **stale** entry rather than re-fetching it:
a v3 entry lacks vision and building damage but still carries the champion, the
kills and the result, and spending the budget to complete two averages would
cost the extra games that are the point of the change. Consequently
`summarizeMatches` counts a **separate sample per metric** — `visionSamples`,
`buildingSamples`, `csSamples` — because during a backfill a missing number is
genuinely unknown, and averaging it in as a zero reads as a player who stopped
warding. A cached entry with no `durationSec` is likewise left out of CS per
minute instead of being treated as a one-minute game.

**Lane matchups are collected raw and published pruned — two collections, not
one.** The crawler accumulates every pairing it sees into
`matchupStats/{patch}_{LANE}`, written with `FieldValue.increment` and never
read back. Those documents are large: `16.17_TOP` measured **1.17 MB** two days
into a patch, and the ceiling is C(173,2) = 14,878 pairings in one lane. Fine
for increments, hopeless for a browser pulling it mid-draft.

So `buildMatchupIndex` (scheduled daily, `buildMatchupIndexOnce` for a manual
run) reads each raw bucket and republishes only the pairings worth reading to
`matchupIndex/{patch}_{LANE}` — 1.17 MB becomes ~21 KB. The frontend reads
**only** `matchupIndex`; nothing in the browser should ever touch
`matchupStats`. The rollup overwrites whole rather than merging, so a pairing
dropping below the floor disappears instead of being frozen in.

**There are two floors and they are deliberately different.**
`INDEX_MIN_GAMES` (50, `api/src/matchup-index.ts`) is only a document-size
guard. `MIN_MATCHUP_GAMES` (200, `matchup-stats.service.ts`) is the honesty
threshold, set where the ±0.98/√n interval is tight enough that a genuinely
lopsided matchup separates from even. The client floor is the higher one so it
can be moved by a frontend deploy; it must never drop below the backend's, or
the UI would ask for pairings the index has already discarded.

**Champion keys are Riot's `championName`, which is the id, not the display
name.** Wukong is stored as `MonkeyKing`, Renata Glasc as `Renata`, Nunu &
Willump as `Nunu`. Both `ChampionStatsService` and `MatchupStatsService` resolve
through `ChampionDataService.resolveId()` before stripping to alphanumerics.
Keying off the display name loses those champions silently — a missing rate is
indistinguishable from one below the sample floor, which is how three champions
went without a solo queue rate from the day that service shipped.

**`pairKeyFor` must mirror the crawler exactly.** `laneMatchups` orders the two
champions by `localeCompare` on the raw names and strips *afterwards*, so the
reader has to order first and strip second. It also returns `oursIsA`, because
the stored `winsA` counts wins for whichever champion sorted first — read it as
ours when it is theirs and a 42% hard counter renders as a 58% free lane. Both
are pure and tested in `matchup-stats.service.spec.ts`; keep them that way.

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
- Shared UI lives in `frontend/src/app/shared/` (e.g. `overflow-menu.component.ts`, `champion-chip.component.ts`, `external-profiles.component.ts`); reuse these rather than re-rolling menus/chips. `champion-grid.component.ts` is the searchable wall of champions used by both the comp board and the live draft — it owns no idea of *where* a pick lands, and only emits a name.
- **Sizing is in `rem`, not `px`.** The root font size is a `clamp()` on `html`, so the whole interface scales with the monitor: unchanged below ~1600px, about 31% larger at 2560px. A `px` width or height silently opts out of that and will look wrong on a large screen. Borders, radii and shadows are the exception and should stay in `px`. Material Symbols carry an explicit `1.5rem` because Google's stylesheet pins them at 24px.
- Champion art: `ui.championIconUrl()` for the square icon, `ui.championArtUrl()` for **splash** art on wide cards. Splash is 1215×717 landscape; the loading art at 308×560 is portrait and crops badly into anything wide.
- Commit messages in this repo are a single imperative summary line describing the user-facing change, often with a short rationale after a semicolon.
