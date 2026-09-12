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

## Where the reasoning lives

`docs/2026-08-21-session-summary.md`, `HANDOVER.md` (30 Aug) and `docs/handover-2026-09-05.md` record *why* things are the
way they are — decisions, reversals, open questions — and `docs/global-plan.md` is the
longer-range plan (multi-link import, multi-tenancy, user-supplied datasets) with its
legal reasoning. Read them before proposing something they already settled.

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
npm run record -- <matchId>  # record a custom game off the replay the League
                             # client is playing (docs/replay-recorder.md)
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
- **Local mode**: no backend. `TeamDataService` seeds from `SEED_DATA` into `localStorage` (`bom-team-data`), and one **Enter local preview** click is an admin session (`AuthService.enterLocal`, `sessionStorage` flag `bom-local-auth`). Since 10 Sep 2026 the blob may carry `gameReviews` too (the Firestore listener does not run in local mode), so a film can be previewed locally: put a review and its analysis game in the blob and, in a dev build, the timeline under `bom-dev-timeline:<matchId>`.

`environment.ts` is committed **with real Firebase web config**, so `npm start` runs against real Firebase and requires sign-in. To develop offline in local mode, blank the `apiKey` in `environment.ts` — **do not commit that change**. (Firebase web config is public by design; it is not a secret.)

## Architecture

**`TeamDataService` (`frontend/src/app/services/team-data.service.ts`) is the single source of truth.** Every page reads from its signals (`players`, `comps`, `compResults`, `fillIns`, `accessEntries`, `teamIdentity`, `macroSummary`, `resourceLinks`, `settings`). All writes go through `persistUpsert`/`persistRemove`, which branch on `this.mode`:
- Firebase mode → Firestore `setDoc`/`deleteDoc`, with `stripUndefined()` first (Firestore rejects `undefined` fields).
- Local mode → mutate the signal + `persistLocal()` to `localStorage`.

In Firebase mode the signals are kept live by `onSnapshot` listeners set up in `initFirebase()`. When adding a new persisted entity, wire **all** of: the model in `team.models.ts` + `TeamData`, a signal, an `onSnapshot` listener, `EntityKey`, `pushLocalToSignals`/`persistLocal`, `seedFirestore`, and CRUD methods — mirror how `compResults` is done.

**Firestore layout**: list collections `players`, `fillIns`, `comps`, `compResults`, `scrims` (replays), `tournaments`, `tournamentSeries`, `seriesGames`, `access`; singleton docs under `meta/` (`teamIdentity`, `macro`, `resourceLinks`, `settings`). `SEED_DATA` (`frontend/src/app/data/seed-data.ts`) is the one-time migration source and the local-mode seed; its shape must stay in sync with the `TeamData` interface.

**Auth & roles** (`frontend/src/app/services/auth.service.ts`): roles are `admin` / `contributor` / `viewer`. `canEdit()` is true for local mode, `admin`, or `contributor`; `canManageUsers()` for local mode or `admin`. A bootstrap admin email is hardcoded (`ruanhart7@gmail.com`) in both the service and `firestore.rules`. Content routes are gated by `viewerGuard` (`frontend/src/app/app.routes.ts`); `AuthService.ready`/`waitUntilReady()` prevents guard-redirect races on refresh. **Sign-in is Google only** (9 Sep 2026; the email/password form went, nobody used it). The automated test user's door is `AuthService.loginWithToken`: a Firebase custom token on the login route's fragment (`/#token=…`), minted by the e2e runner from a service account (`FIREBASE_SERVICE_ACCOUNT` secret, `e2e/tests/auth.setup.ts`), then the same `access/{email}` gate — no password provider, no minting endpoint. A Riot reviewer gets a Google account added as a viewer on Admin › Access.

**Firestore security** (`firestore.rules`, at the repo root): public read on everything; writes require `canEdit()` via the catch-all `match /{document=**}`, so a new collection is automatically covered (public read, editor write) — no rules change needed. `access` and `meta/settings` have their own stricter rules.

**Cloud Functions** (`api/src/`): `enrichPlayer`, `getTeamSynergy`, `getCompAnalysis`, `riotKeyHealth` and `draftAdvice` are `onRequest` with `cors: true` (`draftAdvice` asks Claude — `claude-opus-5` through `@anthropic-ai/sdk` — for ranked picks or bans from a candidate list the draft room builds; needs the `ANTHROPIC_API_KEY` secret and refuses clearly without it; the prompt, schema and validation are pure in `draft-advice.ts`); `checkRiotKey` is a scheduled probe, and `refreshTeamData` (06:30 Europe/Amsterdam; `refreshTeamDataOnce` for an editor to run it by hand) re-reads every player and re-runs the analysis each morning, writing what it did to `meta/refreshLog` — the pure parts are in `daily-refresh.ts`. All use the `RIOT_API_KEY` secret and deploy to region `europe-west1` (see `SynergyService.functionUrl()`). `index.ts` holds the handlers and the Riot I/O; the logic they call sits in tested modules beside it (`parse-request`, `riot-errors`, `match-stats`, `insights`, `analysis-cache`, `comp-match`). Deploy **all** of them with `npm run deploy:functions` from the repo root.

**Pages and routes** (`frontend/src/app/app.routes.ts`, nav in `app/app.html`): every
route is lazy via `loadComponent`, and every content route is behind `viewerGuard`
(`/admin` uses `authGuard`). `/` and `/login` are the login page; the rest are
`/home` (where sign-in lands), `/roster`, `/player/:id`, `/comps`, `/games` (with `/analysis` and `/review`
still resolving to it), `/tournaments`,
`/synergy`, `/admin`. Adding a page means touching both files — the route alone
leaves it unreachable.

**`/roster` has a fourth mode, Scout report** (9 Sep 2026): our own five through
`OpponentScoutService.scoutOurselves` (the same scout an opponent gets, seat =
main role, bench flag along), stored once at `meta/selfScout` as
`OpponentPlayer[]` so `pages/roster/scout-report.component` renders the same
table and ban board with the `core/opponent-view` helpers. Read-only there;
seats and the bench are set on the cards.

**`/roster` is one page with three modes**, in `pages/roster/`: Cards
(`OverviewComponent`), Table (`TeamProfilesComponent`) and Scouting
(`PlayerIntelComponent`). They were three nav entries answering the same
question at different depths. The shell hosts the three existing components
rather than replacing them — each keeps its own state and controls, and passes
`embedded` so only the shell renders a heading. `@switch` means only the
selected one is alive.

**One Starter | Full speaks for all four views** (12 Sep 2026, the lead: "one
switch all four"). The shell reads `UserPrefs.depth.roster` and passes `full` to
each mode; there used to be one on Cards only, another unrelated one on
Scouting, neither remembered, and none on the Scout report — measured at ~370
marks in one card on seeded data, the densest thing the app draws. Starter:
the Scout report is its ban board and one line a player (`topPlays`,
`bestRank`, the line Prep draws); the Table is who, rank, recent form and main;
Scouting opens its practice board and a card holds the pool, what they are
working on and learning. Full is everything expanded, and on Cards and Scouting
it opens every card (a click turns one card against the depth, and changing the
depth resets them). Cards' Full used to add Team Identity, a Quick Access card
and the resource links — nothing in the app edits either, both are the original
seed, and the lead: "we are not using those tools" — so they went from the page;
`teamIdentity` and `resourceLinks` are still in the data.

`/players` and `/profiles` **still resolve**, each carrying
`data: { view }` naming the mode it used to be, so old links and the `e2e`
suite land where they always did. Do not turn them into redirects without
checking `e2e/tests/authenticated.spec.ts`, which navigates to `./players`.
`/overview` was the landing page and **redirects to `/home`** since 13 Sep 2026.

**`/home` is the landing page** (13 Sep 2026, the lead: "a welcoming page for our
team with animations, stats with graphs, splash art… highlight a team member who has
been the MVP of the previous series"). `core/home-build.ts` `buildHome` builds the
whole page as one pure `HomeModel` (the `buildFilm` pattern) from the same
`buildGameRows` the Games page lists, and `pages/home/` draws slices of it: the hero
(our five starters' mains rotating, the season's counters, the This split | All time
switch, a Motion pill, the next series with a countdown and **Scout them**, which
opens that series' prep through `TournamentContextService.openPrep` and never the
draft room), the welcome band (the reader is the starter in `UserPrefs.film.seat`),
the MVP of the last series in a gold frame with the page's one ability clip, and the
MVP race with the last series MVP at its foot. **A series is finished** when its
best-of is decided or a later series of its tournament has results
(`core/series-results.ts`; scrim blocks never), and **a crown counts** when it names
a roster player and more than half its games carry figures (`CROWN_MIN_READ_SHARE`).
The season is the running tournament, else the last 90 days (`core/team-season.ts`).
The other side is a team name and nothing else — the spec serialises a model built
from replays carrying their Riot ids and checks none survives. No link on Home may
have a name containing "comps": the e2e sign-in check matches that substring.
**What the games cannot prove is entered by hand**: trophies and placings on Admin ›
Trophies (`trophies` collection, the whole new-entity checklist) stand first in the
cabinet, and `Settings.motto` and `Settings.banner` (a champion and a Riot skin
number, since there is no file storage) put a line under the name and the splash the
hero opens on. `AdminContextService.saveSettings` writes **every** field the document
holds and `updateSettings` strips undefined first — `meta/settings` is written whole,
so a save that forgot a field would wipe it.

**Prep & Draft holds every opponent** (`/tournaments`, renamed in the nav on
9 Sep 2026; `/scrims` redirects there). A **group** is a `Tournament` with
`kind`: a real tournament, or the one `scrims` group every scrim opponent
lives in — not a tournament, just where the scrims are (no dates, no best-of,
`fearless: false`, hidden from Admin › Tournaments). **Every opponent is a
`TournamentSeries`**; a scrim opponent is one with `bestOf: 0` (open-ended:
`TournamentContextService.canAddGame`). **Every replay is a `SeriesGame`**
with `matchId`, filled the way `finishReplay` always did; the `scrims`
collection stays as the replay store the Games page and the analysis read.
`services/replay-import.service.ts` is the one way in: `importAgainst` a
series (the per-series drop zone and the per-game file input) or
`importLoose` with a name from the page drop zone, which finds or makes the
series by `slugOpponent` (`core/opponent-slug.ts`). A file whose side nobody
can tell lands without a side and the game row asks. `usedChampions` and the
burned lists are empty for a non-fearless group. The Games page reads a game
in the scrims group as source `scrim`; Patterns' `tournamentIds` leaves
those out. The one-time move from the old page is `core/scrims-migration.ts`
(pure, tested) behind the banner on the Plan view; `ScrimOpponent` and its
service methods go once it has run everywhere. **Rosters are not capped
at five**: `fromPaste` keeps every name in a multi-link (subs cycle through the
roles), `appendToRoster` adds a single Name#TAG without replacing the rest, and
`reseatOpponent` only swaps seats on a five-player roster — with subs it just
sets the role, since two players sharing one is the truth of the roster. Which
of the two is the bench is `OpponentPlayer.sub`, set by hand through
`setSubstitute` (the Sub toggle in the seat cell). `starters` and `bench` split
the roster: the table and the ban board read only the five, and the bench is
one line under the table with a "to starters" button, because six rows was
too much to take in.

**"As a team" is what their five did together lately**, and it is a separate
question from what each of them plays. `getOpponentHistory` (`api/src/index.ts`,
logic in `api/src/team-history.ts`) takes the five, reads each player's match
ids for the last N days (default 30) in flex, Clash and draft with Riot's
`startTime`, keeps the matches where three or more of them were on one side,
and reads the details through `matchCache`. Their games are rarely in the cache
— it holds ours — so `MAX_HISTORY_FETCHES` (40) caps one run and the rest is
reported as `pending`; Refresh reads the next batch. The result is stored on
the series or scrim opponent as `teamHistory`, so one fetch serves the whole
team, and `OpponentHistoryService` refuses a six-player table until the sub is
marked — the first five by seat would be a guess. Local mode has no Riot
access, so the button there explains that rather than failing. **The roster table's read-side helpers live in
`core/opponent-view.ts`** (`queueRows`, `reseatOpponent`, `recentForSeat`, the
rate bands…) and are shared by the plan page and the scrims page; do not re-add
copies to either component. `banCandidates` there feeds the **ban board** that
sits above the roster table on both pages: solo and flex merged per champion,
most-played first with win rate as the tie-break, at most two per player so one
one-trick cannot fill it, capped at six; a card's button adds it to the target
bans. `core/note-lines.ts` is likewise the one note parser.

**`/tournaments` → Draft is a live draft room**, used while a draft is actually
happening, and that constraint drives its design. `pages/tournaments/draft/`
holds the component; the rules it obeys are pure and tested next door in
`pages/tournaments/draft-sequence.ts`.

- **The sequence is data, not branching.** `DRAFT_SEQUENCE` is the twenty
  competitive steps — 3 bans each, 6 picks, 2 bans each, 4 picks — so "whose
  turn", "ban or pick" and "are we done" are lookups. `SeriesGame.ourSide` and
  `SeriesGame.draftStep` persist where a game is; both are absent on games saved
  before this existed. `positionOf` (8 Sep 2026) reads the position: the stored
  step when there is one, the end when there is none but five picks a side (a
  replay-filled or typed-in game is over, not at Ban 1), the start otherwise.
  The replay importer stamps `draftStep: DRAFT_LENGTH` as well.
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
- **The comps board is a popup, not part of the room** (12 Sep 2026, the
  lead: "remove the comps from the actual draft for now, make it a popup … then
  we can have a fixed view and keep it focused"). A comp finder under the wall
  was tried the same evening and reverted on the lead's word ("exactly as
  before"). The board — Still playable, Broken, Pool left — is unchanged inside
  a native `<dialog class="draft-comps-dialog">`, rendered outside the `.card`
  under `@if (compsShown())` and opened with `showModal` by an
  `afterRenderEffect`, so it sits in the top layer and nothing in the room can
  move. It opens from the **Comps** pill (`.draft-comps-link`,
  `data-tour="draft-board"`) in `.draft-page-head`, always drawn and disabled
  with no game; its height is fixed (`min(44rem, 100vh - 4rem)`) because a
  dialog centred with `margin: auto` re-centres when a comp opens inside it.
  Escape (`cancel`) and a backdrop click close it through `hideComps`, and the
  tour overlay leaves keys alone while any `dialog:modal` is open — or Escape
  skipped the whole tour and never closed the dialog. **While a sequence runs,
  `pickFromComps` holds the champion through `proposeFromSequence` and closes
  the popup onto the confirm row**, after `cancelReplace()`, and aims the wall's
  lane at the comp's seat on our pick; the board used to write a pick straight
  into a seat without moving the step. Rates in it use the room's
  `winRateBand`. The middle stack is wall, advice, lane read, bans (the team
  columns span four rows), and map view between 1101 and 1399px keeps the wall
  to row 1 or it covers the advice. Measured against the room before either
  change, at 1920 in both views: the head, wall, advice and bans sit on the same
  pixel.
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

**Every save of a series game is logged, and every uncaught browser error is
reported.** `TeamDataService.updateSeriesGame` diffs the game it is replacing
against the one it is writing (`core/draft-diff.ts`, pure and tested) and
writes one `draftEvents` document per save — who, when, which game, the step
it moved, and the changes in words ("Ban 2: Ahri", "Undo: removed our ADC
Jinx", "Reset: every ban and pick cleared"). A hold-only change is skipped.
`core/error-reporting.ts` is the app's `ErrorHandler`; it writes uncaught
errors to `clientErrors` (any signed-in user may create one — see
`firestore.rules`), capped at twenty a session and one row per message.
**A tab open across a deploy is the commonest thing in that log**, and
`core/stale-build.ts` is the one rule for it (11 Sep 2026): every lazy chunk
is content-hashed and Pages redeploys on every push touching `frontend/**`
— dozens a day — so an open tab asks for names that are gone.
`isStaleChunkError` knows all three engines' wordings and `reloadForStaleBuild`
reloads **once per target**, because a chunk that is genuinely missing would
otherwise refresh forever. `App.recoverFromStaleBuild` has used it on a
`NavigationError` since 25 Aug 2026; what it could not see is a **`@defer`
block**, whose failure never reaches the router and surfaces only as
Angular's `NG0750` (`DEFER_LOADING_FAILED`, latched on the *TView*, so it
never retries for the life of the page). The review takeover's backdrop
renders for every phase while the stage — and both of its exits — sat inside
such a block with no `@loading` and no `@error`, so a failed chunk left a
teammate behind a full-screen inert scrim with nothing in it and no way out
but F5. That block now has both branches, the backdrop and Escape close the
takeover whenever the stage is not on screen, and a **second Escape within
`ESCAPE_TWICE_MS`** always closes it — the last one covers the other way to
seal the page, a `MotionService.play` whose `finished` never settles (a
hidden tab stalls WAAPI), which `minimise()` awaits before it closes.
That second way is now shut at the source too (11 Sep 2026), because the
Escape only rescued the person who knew to press it twice: **`play` never
waits forever.** It races `finished` against a watchdog set from the
animation's own timing plus `WATCHDOG_SLACK_MS` (a second, floor 1.5 s —
enough to clear every reason a healthy animation is late, since those are
frames), and when the watchdog wins it cancels the animation and writes the
last keyframe itself, exactly as the reduced-motion branch does; an endless
`iterations` arms no watchdog, an unsettled `finished` being the contract
there. The two callers that gate state on it are `minimise()` and the film
room's `go()`. `minimise()` cannot close first — `svc.minimise()` sets the
phase to closed and the stage leaves the DOM in the same tick, so there
would be nothing left to shrink — so its `leaving` latch no longer refuses
on its own either: a second press drops the shrink, which settles the
promise the first is waiting on. `go()` is hardened the same way: a move
arriving during a fade drops it rather than merely stepping around the
latch, and the cleanup that undoes the fill — the cancel and the two
`removeProperty` calls — moved into a `finally`, so a stalled fade can
neither strand a chapter at `opacity: 0` in the deck nor leave `leaving`
standing for the life of the page. Both Escapes stay as defence in depth.
Any new `@defer` needs an `@error` branch for the same reason.
Both are read on Admin → Diagnostics. The point (8 Sep 2026): a teammate who
says "something went wrong in the draft" and cannot say what can now be read
back step by step. Do not add per-action logging in the draft room — the diff
at the write path already sees every page's writes.

**The advisor's auto-ask is a team setting, off by default.**
`Settings.autoAdvisor` (Admin → Settings) gates the `autoAsk` effect in the
draft room; "Ask what to pick" always works.

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
4. `/games` owns the Refresh button and lists every game from every source
   (`pages/games/game-rows.ts`, pure and tested: Riot games, scrims from
   replays, tournament games typed in from the draft room — each row says
   what its source knows). Note that `getCompAnalysis` already folds the
   stored scrims in as queue 0 games labelled `Scrim`, so most scrims reach
   the page through the analysis; the page reads them as source `scrim` by
   that label and drops the duplicate from the `scrims` collection. Review is its **Patterns** tab (`ReviewComponent`,
   `embedded`), read-only over the same payload and answering a different
   question (why the games went the way they did). The comp-first Analysis
   page was retired on 8 Sep 2026 — comps keep their records on Comps, and
   here a comp is a tag on a game. Review
   toggles between losses and wins; `describeLoss` and `describeWin` in
   `api/src/objectives.ts` are deliberate mirrors on shared thresholds, and the
   page counts both through one `summarise` so the two cannot drift.
   `api/src/fights.ts` adds the kill tally on top, which is what separates a
   game lost *in the fights* from one lost *on the map* — two losses that read
   identically without it and need opposite work. It costs no Riot calls: every
   participant is already cached, so it applies to every game, not just the
   freshly fetched ones.
5. **Cache v5 reads each lane and each player** (8 Sep 2026). Riot's
   per-participant `challenges` block was on every match payload and never
   read; `api/src/participant-extras.ts` keeps a typed subset of it as
   `extras` (absent stays absent, never 0), and `api/src/lane-read.ts` pairs
   each of our seats with the enemy in the same seat — gold/min, CS at ten,
   vision/min, Riot's laning-phase flag; two of three terms decide `won`,
   `even` or `lost` — and collects per-player facts (Teleport takedowns only
   for a player who took Teleport, control wards, solo kills, time dead).
   Both ship on the analysis as `AnalysisPlayer.lane` and `.facts`; the raw
   extras stay in `matchCache`, because `meta/compAnalysis` is one document
   with a 1 MiB cap (`payloadBytes` is reported, and past 850 KB the games
   older than the newest 120 lose their enemies' figures first, then their
   lane reads and facts only if the document is still over; when even that
   leaves it over, every game is stripped the same way and `payloadTrimmed`
   counts the games touched — `api/src/analysis-payload.ts`). The Patterns tab
   (`frontend/src/app/pages/review/win-loss-splits.ts`, pure) turns this
   into **Work on / Keep doing** sentences from the biggest wins-versus-losses
   gaps that clear `MIN_FOR_A_CLAIM` on both sides, a lane table, and the
   team and each player split by result. Replays have totals only, so a
   scrim's lanes stay `unknown` and the table counts it as skipped. A bump
   to v5 refills forty entries a run; the tab says how many are waiting. **v6** (13 Sep 2026)
   keeps each participant's multikills (doubles to pentas, the largest) in `extras` and
   `PlayerFacts`, for Home's pentakills; absent below v6 and counted over the games that
   carry them.
   Since 10 Sep 2026 `AnalysisGame.enemies[].stats` carries the other side's
   figures (`enemyStats`), so the post-game graphs draw both sides.
6. **Patterns reads Riot games and replays apart, serious games only by
   default, and opens on an overview.** `sourceOf` (queue `Scrim` → replay)
   drives a source switch; `MetricSplit.needs` marks the per-minute and
   challenge figures Riot-only so a replay's table and rules keep only what
   a replay carries (`laneTotals` stands in for lane verdicts). A game tagged
   on the Games page lands in `practiceGames` (one doc per match, the
   `compOverrides` pattern) and leaves Patterns unless "All" is chosen.
   Lanes, the team split, the objective patterns and the game list sit
   behind chips remembered in `localStorage`. **Checking a number:** every
   game has a "Check the numbers" drawer (`shared/game-check.component.ts`,
   `core/game-figures.ts`, a League of Graphs link from `core/match-link.ts`),
   Admin → Diagnostics has a Data health table (`core/health-checks.ts`,
   `cacheVersion` now travels on each analysis game) and the analysis size,
   and every Work on / Keep doing line folds out the games it was averaged
   over (`Advice.evidence`, twelve newest, from `Split.samples`).
7. **The Patterns filters are the team's own words** (8 Sep 2026): Source
   `Flex | Scrims + Clash | Tournaments` (`gameSource`: a replay whose id is a
   `SeriesGame.matchId` is a tournament game, Clash sits with the scrims),
   Games `All | Prep` (Prep = not tagged practice), Starters `A team | Custom`
   (the A team is every player without `sub`; Custom is any set of players
   who all have to be on our side), Roles `Main | 2nd | Any` (`roleFit`
   against `Player.role` and `Player.secondaryRoles`). The A team and the
   second seats are set on the Roster page (Cards view) in edit mode — the
   same `sub` flag Admin sets, so the five stay one thing everywhere. Whether
   the read is Riot's or a replay's is no longer a switch: `patternSource`
   follows from the games selected. **They persist** (12 Sep 2026,
   `bom-patterns-filters`, read back through `readPatternFilters` in
   `win-loss-splits.ts`): they were in-memory, so every visit reset to
   Flex / Prep / A team / Main. Per browser, like the sections' key beside
   them — which games you were last looking at is a place in the page, not a
   preference about yourself. Each field falls back on its own when a stored
   value is no longer an option, and a hand-picked five with nobody left in it
   drops back to the A team. A `<select>` that renders its stored value must
   set `[selected]` per option, not `[value]` on the select: the comps arrive
   after the select does, and a value set against an empty list silently falls
   back to the first option while the page keeps filtering on the real one.
8. **The post-game review has two tiers** (8 Sep 2026). *Timeline tier*:
   the morning run fetches up to `MAX_TIMELINE_FETCHES` (20) Match-V5
   timelines for prep Flex and Clash games, newest first, after the players
   and the analysis and inside `TIMELINE_BUDGET_SECONDS`; each is reduced by
   `api/src/timeline-features.ts` to `matchTimeline/{matchId}` (its own
   `TIMELINE_VERSION`; a bump rebuilds twenty a run) and **never stored
   raw**. Frames are sixty seconds apart, so "near an objective" and
   "warded" are approximate by construction and say so. Version 2 (9 Sep
   2026) keeps, per death of ours, who was where: their jungler on the
   kill, our jungler's distance and zone at the nearest frame, their
   jungler's distance a frame before, allies near, an objective in the same
   minute; which of our seats were on each of their deaths; and damage
   dealt and taken per five minutes. Version 3 (10 Sep 2026) keeps
   positions once a minute per seat on both sides (Riot units to 100, one
   flat list of x, y pairs per seat with -1, -1 for a frame without one,
   since Firestore refuses an array inside an array; `nestedArrayPath`
   guards it) and our wards at the placer's frame position with the
   type and the earliest matching kill; `scripts/dev-timeline.mjs` makes
   one locally from `api/lib` for the dev override (the film room's Part C
   paragraph). Version 4 (11 Sep 2026, the lead: "the approximate meters
   are a bit off, can we tighten that") keeps the **events' own positions**:
   `x`/`y` on every death of ours and of theirs off the `CHAMPION_KILL`, and
   on every objective off the `ELITE_MONSTER_KILL`, in Riot units rounded to
   `POSITION_GRID` (100) and spread conditionally, so an event Riot sent
   without a position keeps neither key. The film then places a death where
   it happened rather than sampling inside its zone; the pit stays the
   fallback for an objective and counts as a guess. All six fields are
   optional, so an older document reads exactly as it did — and until the
   morning rebuild reaches a game (twenty a run) its film keeps the zone
   pins and says so. The facts read off it
   (`api/src/game-facts.ts`: curve shape, lanes with the minute, fights,
   solo deaths, objectives given up, vision, and the **death ledger** — a
   verdict per death, `how` and what `could` have stopped it: `jungle`
   within `JUNGLE_REACH`, `ward`, `call`, `position`, with a summary line
   and the jungler's presence on kills) ride on the same document as
   `facts`, render as the "How the game went" drawer on a Games row
   (`shared/game-story.component.ts`, read on demand through
   `MatchTimelineService`, not a listener), and are what the model sees.
   The ledger's rules are the only place the tags are argued; the panel
   and the prompt both read the result, never re-derive it.
   *End-of-game tier*: a replay has totals only; `endOfGameFacts` says what
   it can and the review is labelled as such. `AnalysisGame.timelineData`
   marks coverage like `laneData`; Diagnostics counts it.
   *Recorded tier* — the third road, for the games Riot cannot see at all
   (10 Sep 2026). A custom game has no match and no timeline, so it is
   **recorded** off the replay instead: `npm run record -- <matchId>` runs
   `scripts/replay-recorder.mjs` beside the League client while it plays the
   replay, reading the Live Client Data API and driving the Replay API to a
   frame at each death of ours. It writes `replayShots/{matchId}__{sec}`
   (one picture a document) and then `replayRecordings/{matchId}`, and the
   lead presses Re-review afterwards — nothing re-runs on its own.
   `api/src/replay-recording.ts` holds the stored shape, `recordingLines`
   (the prompt's minute-by-minute lines) and `shotsFor` (at most
   `MAX_REVIEW_SHOTS`, 8, every death of ours first, then objectives, then
   the end); `reviewGame` attaches those frames to the team call as image
   blocks, about five cents a review on top. `core/replay-lines.ts` mirrors
   the api file exactly, like `compareCurve` — each carries the other's
   spec, so drift turns a suite red.
   **What all ten were holding when we died** (11 Sep 2026,
   `RECORDER_VERSION` 2, the lead: "follow the jungler, then the adc, to get
   champion-specific data with cooldowns"). At each death of ours the run
   seeks to two seconds before it — the same second that death's picture is
   rendered from, so the board and the frame agree — and reads the Live
   Client's whole player list as a `ReplayDeathState`: the second, the seat
   that fell, and a `ReplayDeathPlayer` for each of the ten with `seat`,
   `ours`, `level`, `cs`, the `items` in slot order (trinket and control
   wards included) and, only for someone already down, `dead` with the
   `respawn` seconds left on them — an absent key is alive, never `false`.
   `MAX_DEATH_STATES` (30) deaths get a board; `deathLines` prints
   `MAX_DEATH_LINES` (20) of them into the prompt, earliest first, and the
   rest are stored and simply not read.
   **The fights are what a coach reads** (12 Sep 2026, the lead: "test until
   we can actually use the data we're getting back… think from the
   perspective of a League coach"). `fightLines` — mirrored in both files
   like `deathLines` — groups the deaths of ours within `FIGHT_WINDOW_SEC`
   (30) of one another into one fight and prints, per fight, the second it
   started, how many fell on each side (the kills the client reported within
   half the window either side, so no kill lands in two fights), who fell in
   what order, **the deepest hole either side was in at any point of it**
   with the respawn seconds on each, and how the first of ours to fall stood
   against the same seat opposite. It is built from the kill events, not the
   boards, so a death past `MAX_DEATH_STATES` still gets a line and a
   version 1 recording still gets its fights; the board is looked up per
   fight and adds the levels, farm and respawns when it is there. Over
   `MAX_FIGHT_LINES` (12) the costliest are kept and put back in time order.
   **A fight says two things about who was down, never one** (12 Sep 2026,
   found by an audit of a real review): **how it opened**, and **how deep the
   hole got, by what second**. Reading only the deepest hole is how "at 33:05
   three of ours were on the floor" reached a work-on, a moment, a lesson
   answer and the one thing at once, when in truth all five were alive at
   33:05 and the three on the floor by 33:11 were that fight's own casualties.
   So `holeLine` excludes every seat that falls in the fight from the opening
   count, whatever its board says, and stamps the deepest hole with the second
   it was read at so it can never be re-anchored to the start; the prompt says
   outright that engaging short and being collapsed on are opposite mistakes
   and that turning the second reading into the first is the worst thing it
   can do with the block. A fight with no board for its first death says
   nothing about how it opened rather than guessing "five up".
   **Ours are named by champion and theirs by seat** in every one of these
   sentences, which is the Riot rule made useful rather than merely obeyed: a
   seat word standing alone means the other side, who have no names here. A
   recording whose seats carry no champion falls back to "our Top". `happenedSection` prints it above the
   minute-by-minute lines, deliberately: those spend their forty on the kill
   list (sixty-three "Fiddlesticks kills Mordekaiser" sentences in the game
   this was measured on) and the fights are the same deaths as a game.
   **Two things the client will not give, both measured 12 Sep 2026 against a
   real recording and both now said out loud.** It emits **no epic-monster
   event at all** for a custom game — a hundred raw events held 63 champion
   kills, 16 towers, multikills, aces, the start and the end, and not one
   dragon, Baron, herald or grub, in a game decided by `barons 0-2` — so the
   objectives live only in each frame's top-bar count and the RULES tell the
   model to bracket one between two frames ("between 12:13 and 15:41 they
   took a second dragon") rather than name a minute; a fight line therefore
   stops at the fight and never claims what followed it. And `creepScore` is
   coarse in a replay: all 660 CS figures in that recording were multiples of
   ten while the ward scores beside them were full floats, so
   `RECORDING_HEAD` says a CS gap under ten is not a gap. The RULES also keep
   **what fell** (a bracket between two frames' top bars) apart from **what
   was coming** (that frame's corner timers, true of that second only), and
   forbid deriving a spawn time from a respawn rule. It is a mirrored function like
   `recordingLines`, so it lives in both files word for word. The summoner
   spells and the keystone ride on `ReplaySeat` instead (`spells`,
   `keystone`), because neither changes during a game. **Not a frame per
   champion**, which is what was asked for and was the expensive way round:
   a picture is `replayShots/{matchId}__{sec}` with nowhere in the id to say
   whose HUD it is, so a second run overwrites the first; a review reads
   eight frames however many are stored; each run costs about six minutes;
   and everything except live ability cooldowns is already in the
   per-player list as JSON for all ten at once. The cooldowns really are
   pixels only — `/liveclientdata/activeplayer` answers 400 in a replay,
   there being no active player to ask. `deaths` and both seat keys are
   optional, so a document written before this reads exactly as it did, and
   a row carries a seat and an `ours` flag and nothing else: no name of
   theirs here either. The app reads both collections on
   demand through `services/replay-recording.service.ts` (`getDoc`, never a
   listener; a picture when its thumbnail is in view or tapped): the Games row
   gets a Recorded chip, and "How the game went" shows the recorder's own
   lines when there is no timeline. **The frames strip on the Games row is
   gone** (12 Sep 2026, the lead: "this strip of frames can be removed") and
   `shared/replay-frames.component.ts` was deleted with it: the film room's
   own Frames chapter shows the same pictures in order, with the board and
   the sentence beside each, and plays the clips, which the strip could not.
   `shared/film/replay-shot-image.component.ts` is the one reader of a
   picture now. **No name of theirs anywhere** — every
   side is read off a seat, so theirs are champions in seats in the seats,
   the checkpoints and the events, and a killer who is not one of the ten
   becomes "a turret" or "the map". A recording carries **no team gold** (the
   client gives gold for the spectated player alone) and **no position**
   except what a frame shows; the review is told so and must not infer
   either. `docs/replay-recorder.md` is the lead's walkthrough — what to do
   in the client first, the options, what it costs and how to read a
   failure. `MAX_SHOT_BYTES` (700 KB) measures the **base64**, in both the
   recorder and the api: measuring the JPEG let a frame through that the
   review then silently skipped.
   **The rule holds of the pixels too** (11 Sep 2026): before the first
   picture the recorder POSTs `/replay/render` and reads the answer back,
   turning off every panel that prints a Riot id (`interfaceScoreboard`,
   `interfaceFrames`, `interfaceTimeline`, `interfaceAnnounce`,
   `interfaceChat`, `interfaceScore`, `selectionName`, and
   `healthBarChampions`, since a spectator health bar carries a summoner
   name) and keeping `interfaceMinimap`, `interfaceAll` and no fog. A flag
   the client will not confirm as off **stops the pictures** — the samples
   and the events are still written, and the summary says why. An exception
   to that would have to be written here beside the rule; a review pass
   cannot grant one. **The camera is pointed through the render, never before
   it** (11 Sep 2026, the lead: "attach the camera to each of our champions
   like Vi, Akali"). Measured against patch 26.17 rather than assumed:
   `/replay/render` accepts `selectionName` and `cameraAttached: true` and
   echoes both back as done whenever they are sent, while a seek clears the
   selection and **starting a render clears it again** — so a camera pointed
   before a render is pointed at nothing, and `cameraPosition` never moved
   through two champions, a second of playback and a nine-second wait. What
   works is holding it *during* the render, the only window in which the
   replay's camera moves at all: `makeCameraHold` is passed to `waitForShot` as
   `onPoll` and re-asserts the champion on every turn of the wait, reading the
   selection back once (`CAMERA_CHECK_POLL`) to learn whether this client holds
   one and to try the id spelling (`championIdOf`: `MissFortune`, not `Miss
   Fortune`) when it does not. A client that holds neither spelling sets
   `cameraHeld` false, is never asked again, and the run prints
   `CAMERA_NOT_HELD` once. `cameraMode` is **never** sent: it is the one key
   that moves the camera on its own and setting it to `fps` killed the client
   mid-test. The frame is also rendered from `SHOT_LEAD_SEC` (8) seconds before
   the moment at `SHOT_FPS` (1) — the run-up is what the camera travels in, the
   client writes at 60fps unless told otherwise (161 PNGs of 2 MB for one
   picture), and `findShotFile` keeps the sequence's **last** frame. Moving the
   mouse flips the client to Manual Camera and beats all of it, which is why
   `docs/replay-recorder.md` step 5 says hands off. **The camera is the client's
   own director, and it has to be woken** (11 Sep 2026, measured after five
   attempts that were not it): a render on its own snaps the camera to a fixed
   spot, which is why every picture of a real run came back as the same rock.
   The director wakes only while the replay is genuinely playing with nothing
   else asked of the client, so the run parks `WARMUP_SEC` (9) before the
   render's start, `warmDirector` plays into it at ordinary speed, and the render
   then begins at the second playback stopped — no seek of its own, so nothing
   resets the countdown. The proof frame: 12:13, Rell mid-ult, "Akali has slain
   Fiddlesticks!", against the same second rendered cold, which was an empty pit.
   Following is therefore **off by default**, because holding a selection
   restarts that countdown: `--follow <seat|champion>` buys one player's HUD at
   the cost of the framing, and `--no-follow` is the default said out loud.
   `pinnedChampion` takes a **seat** first (`SEAT_WORDS`: jungle/jg/top/mid/adc/
   bot/support and the rest), because the champion in the jungle changes weekly
   and the jungle does not — a seat only ever resolves to one of ours — then a
   champion by either spelling, and refuses a word that is neither *before* the
   thirty-six seeks rather than after them.
   `restoreRender` puts the selection back with the panels.
   **Two things are counted once, not as the client offers them** (11 Sep 2026):
   `readEvents` de-duplicates, because the client APPENDS to its event list
   every time the playhead crosses an event and a run crosses the same seconds
   at every picture — a real game came back with 266 events of which 108 were
   distinct, one kill sixteen times over, which a review would have read as
   sixteen kills in a second. The key is what happened (name, killer, victim,
   structure, dragon) and **not** the second, because the client's clock drifts
   a second between crossings and an exact-second key still left 26 duplicate
   pairs in 89 kills: the same actors within `EVENT_SAME_WINDOW_SEC` (3) are one
   event, and every second a pair has been seen at is remembered, not just the
   newest, since a pass covers the whole game before the next begins. `EventID`
   is no use — it is not stable across passes. And **streamer mode is established, not assumed**: `streamerModeOn`
   reads it off the event list (a `ChampionKill` names a champion with it on, a
   Riot id with it off) and a client that is not hiding names gets the panels
   turned off for that run instead of the blanket exception, because the old
   code announced "streamer mode prints champions, not Riot ids" without ever
   checking. Two more things the recorder promises: a frame is taken
   two seconds before the moment it is filed under (the death second is the
   grey recap screen, and the client renders the range it is *given*, not
   wherever playback is parked), and a minute the client never landed on is
   left out of the samples rather than filed with whatever the client was
   showing — which, since the run parks it at the end first, is the final
   scoreboard. A recording is read on **either** tier: the recorder takes any
   dashed id and the Games row lights its Recorded chip either way, so
   gating the read on the replay tier dropped a Clash recording in silence.
   **The review itself** (`api/src/game-review.ts`, handler `gameReview`,
   `REVIEW_VERSION` 8 since 12 Sep 2026: 3 on 9 Sep, 4, 5 and 6 on 10 Sep,
   7 on 11 Sep for `GameReview.recorded` — the one field that says a review
   was written off the recorder's minutes and frames, so the panel stops
   calling a recorded review "Totals only" and drawing dots where its
   minutes are — and **8 for `decidedBy`**, the one thing that decided the
   game as one of the seven themes plus at most twelve words on why, which
   the panel draws first and largest. It is **required in `TEAM_SCHEMA` and
   optional on `TeamReview`**: eleven stored reviews predate it, and a
   malformed answer falls back to `workOn[0].theme` in `parseTeamReview` —
   already one of the seven, and what every earlier review is read with — so
   a bad field costs a field and not a review. Its `why` is the one free-text
   field besides the draft's and the lessons' that goes through
   `optionNamingOurs`, because it is the largest text the panel draws.
   Version 8 also **moved the prompt's word caps and the validators'
   character caps together**, which are separate places and had drifted
   apart — the prompt asked for 40 words where the validator allowed 320
   characters, about 53 — so nothing was enforced; the pairs are now roughly
   six characters a word and the cuts go through `strWords`, on a word
   boundary, since `str` sliced through the middle of one. And the RULES now
   say the evidence separator is load-bearing: figures parted by ` · ` and
   never a comma, because the panel splits on it and draws a chip per figure,
   so a comma made a chip reading "nothing back" on its own) is
   two calls over the facts, both to Opus at medium effort: the team —
   headline, summary, the game in `moments` (three to six, time order),
   `workOn`, `keepDoing`, the comp verdict, and since version 4 and 5 the
   `lessons`, `oneThing` and `draft` the film room reads — and the players —
   `strength`, `workOn`, and `more` (up to
   three further work-ons, each with a `theme`); both JSON-schema output,
   both validated (caps, evidence required, a minute outside the game
   nulled, moments sorted and capped, unknown player names dropped, seats
   re-stamped from the context). The prompts print the ledger (all of it
   for the team, per seat for the players, and the laners' deaths within
   reach plus the presence line for the jungler), damage dealt and taken,
   and every habit the facts compute. Stored at `gameReviews/{matchId}` **by the
   function only**; the app listens (`TeamDataService.gameReviews`,
   `reviewFor`). Trigger: the "Review this game" pill on a row (editors),
   or `Settings.autoReview` (off by default) which reviews at most
   `MAX_AUTO_REVIEWS` (3) new prep games in the morning run and logs the
   cost to `meta/refreshLog.reviews`. The panel (`shared/game-review.component.ts`) reads through
   `core/review-view.ts` (pure): the scoreline chips from the row's
   `AnalysisGame`, evidence split into figure chips, a stat line per
   player, the ledger's words (`COULD_LABELS`, `HOW_LABELS`,
   `ZONE_LABELS`), and `reviewAsText` behind the Copy for Discord pill (one
   subtext line on the deaths when the ledger is there, and the film link,
   the commitment and the notes as extras). **The panel is a dashboard and
   the film room is the story** (12 Sep 2026, the lead: "it feels like too
   much at once to read and obtain… use league jargon… use visuals more than
   words… I want to look at something and instantly know what its about, not
   wonder what am I looking at"). Measured before it was answered: the panel
   rendered ~350-420 words while never rendering a single `evidence` string,
   every `options` pair, `lessons`, `draft.lacked` or a player's `strength`
   and `more[]` — it showed the least scannable third and hid the rest, and
   printed the row's own eight objective figures a second time 150px below
   them. It now opens with **Decided by** (`shared/review/decided-by.component.ts`
   over `decidedByOf`: one of the film's glyphs and one word, from review
   version 8's `decidedBy` and falling back to `workOn[0].theme`, rendering
   **nothing at all** when there is neither), then First thing next game with
   the two `options` the schema has carried since version 4 and nobody ever
   drew, then a **Team | My seat** switch (`bom-review-view` in localStorage).
   Team holds the moment strip, every work-on, every keep-doing and the draft;
   My seat opens on the reader's own — the seat is `UserPrefs.film.seat`, the
   one this app already knows, since `Player` carries no email and
   `AccessEntry` no player id, so a first-run picker asks rather than guessing.
   **Every point is `app-review-point`** (`shared/review/review-point.component.ts`):
   the theme's glyph, `evidenceChips` on the evidence — which had existed in
   `core/review-view.ts` since the panel was written and had no caller — and
   the sentence behind an `app-info-tip`. Two fallbacks a stored review hits:
   evidence that will not split shows `askOf(text, 120)` instead of one chip
   holding a clause, and a point with no theme draws no glyph rather than a
   blank square; the minute pill is dropped when a chip already carries a
   clock. The moments are placed along the game by `momentTrack` (pure, with
   a minimum gap and the tail pinned to the track rather than clamped in
   place, which stacked two pills on one pixel) and fall back to the row for
   one moment or a game with no length, and to dots for a totals-only review.
   The swaps are two faces and their gains as chips with the why in the tip,
   `draft.lacked` beside them. The result, measured on the live site: 350-420
   words to **175 on Team and 140 on My seat**, with the prose down to about
   45 and every figure still on screen. Anything longer is still the film's.
   **Three marks: who carried it, and who swung it** (11 Sep 2026, the lead:
   "add an MVP for a series, and a game, and then also most influential
   player"). `core/game-mvp.ts` holds the line the film's poster always
   picked by — three a kill, one and a half an assist, two off a death,
   twelve times the share of our damage, six times kill participation, ties
   to lane order — as `mvpSeatOf` (which `film-build.ts` now imports, so the
   film's face and the chip can never name two seats), plus `mvpOf` with the
   two or three terms that carried it, `seriesMvpOf` (the best average per
   game **that seat played**, so a sub is judged on the game they played;
   ties to the better average damage share, one line a game) and the two
   adapters `mvpGameFromScrim` / `mvpGameFromRow`. `core/influence.ts`
   answers the other question — not who played best but who swung the game
   most: for every kill a seat was in on and every death of theirs, the gold
   swing over the two minutes after (`goldDiff[m+2] - goldDiff[m]`, the same
   window the map's `cost` uses), with **each minute priced once** however
   many of that seat's events fell in it (the curve moves once; summing per
   event multiplied one ace by five and printed it as gold), ranked by the
   **size** of the swing either way (on a game we lost the signed sort
   crowned whoever lost the least), the biggest single swing named with its
   own figure and sign, and the events the curve does not reach counted as
   `unpriced` rather than folded in as zero; no timeline, no answer, and the
   card says so — `INFLUENCE_NO_TIMELINE` for a game with none and
   `INFLUENCE_NOTHING` for a timeline that carried no fight to price, since
   the two are not the same thing. The card reads the timeline through the
   review's own tier, as the film page does, so the answer never depends on
   whether the Games row was opened first.
   `shared/mvp-chip.component.ts` is the one chip in three kinds — MVP,
   Series MVP, Swung it most — a focusable span and never a button or a
   link, the terms in its tip, no figure on its face and the word "score"
   nowhere on screen. It shows on the game row's summary beside Reviewed
   (compact), on the film's card above the asks — where the terms are
   **printed** under each chip, because a tooltip is unreadable on a phone
   and the disagreement between the two marks is the point — and on the
   series head in Prep & Draft, which names a person only while one of them
   held the seat (a sub's games are never credited to whoever played last).
   A game with no figures (a tournament game typed into the
   draft room) gets no chip rather than an MVP invented from five champion
   names. The honest caveat travels with the swing: Riot keeps the curve a
   minute at a time, so it is approximate, and the tooltip says so.
   **The film room** (`/film/:matchId`, `pages/film/`, 9 Sep 2026) walks a
   review as chapters the reader calls before they are revealed: the title
   card asks what decided the game before the headline lands (only when
   `workOn[0].theme` exists), The one thing splits the coach's "either X or
   Y" into two cards the team commits to (`filmCommitments/{matchId}`,
   editors write, majority wins, ties to A, a changed sentence resets the
   picks), Your seat flips a card per player (the one 3D flip in the film),
   and the fourth chapter is The card: the asks, the commitment and "Ask me
   again before the next game" (`userPrefs.film`, `core/film-progress.ts`:
   +1, +3, +7 days; the tours reset keeps `film`). The title card and Your
   seat play the champion's ability clip from Riot's champion-page CDN
   (`services/ui.service.ts` `championClipUrls`;
   `shared/film/champion-motion.component.ts`; muted, one at a time, the
   splash under it, never on Save-Data or with motion off). The model is `core/film-model.ts`, built
   once by `buildFilm`; chapter components read it and the live services
   (commitment, notes at `filmNotes/{matchId}` keyed `m:<i>`/`d:<minute>:<seat>`/`w:<i>`,
   progress) and nothing else. Motion goes through `MotionService` (OS
   setting or the film's Motion pill; `play` resolves at once when still)
   and CSS keyframes gated on `.is-current`. Words like "drill", "quiz" and
   "score" never appear on screen. **Slice 2** (9 Sep 2026, evening): the
   Review button opens the takeover (`services/review-takeover.service.ts`,
   `shared/review-takeover.component.ts` hosted once in `app.html`; phases
   gate, reel, holding, landed, error, closed): the gate says the cost
   before anything is spent, Roll it grows the stage out of the card and
   plays the game on the Rift off one `core/film-clock.ts` while the coach
   writes, with the gold curve hidden and "Where did it turn? Drag and
   lock" (stored as `calls.turn`); a replay gets the totals reel and the
   board's own call (`calls.board`, the scoreline hidden until it is made).
   The landing guard is `Date.parse(reviewedAt) > t0`, or the very document
   the function answered with; Minimise parks the watch (a second game
   opened meanwhile keeps the first parked) and the landing is a toast
   plus the poster's Open the film room pill pulsing twice (since 10 Sep
   2026 that pill, inside the review panel, is the row's one door to the
   film: the "Watched | Film room" line under the panel went, and the
   collapsed row carries a Reviewed chip, Watched once this person reached
   the card); `?fresh=1` opens the film on the tape. Chapters: the tape (`chapters/film-tape`, the Rift over the
   scrubber `shared/film/film-scrubber.component.ts`, the one horizontal
   drag; since cut 4 the curve stands as soon as the chapter has a clock
   and draws itself to the turn once when the chapter comes up, the hand
   stops on the beats and narrates them (below), Copy link is
   `?c=tape&t=<sec>`, and the takeover's guess, when there is one, is the
   only verdict the sheet shows), the board (replay tier: tallies at the
   pits, "Which count was furthest apart?") and the map
   (`chapters/film-map`: one line over the deaths with the reads' counts,
   a legend that lights one read at a time, the deaths that cost most as a
   strip, and a card per death with its read, its scene and its cost;
   every pin carries its read from the start, nothing is hollow, and Watch
   it seeks the tape to twenty seconds before). **The frames**
   (`chapters/film-strip`, 12 Sep 2026) is the one chapter built from the
   local recorder rather than from Riot, and the first time the film room
   has seen a recording at all: `buildStrip` (`core/film-build.ts`) walks
   the moments the recorder kept pictures of — since recorder version 3 the
   moment and the eight seconds leading into it, one frame every two, on the
   eight a review reads — with the board of all ten beside each death of ours
   and `deathLine`'s own sentence under it, so the prompt and the film cannot
   print one death two ways. It stands after the board on a recorded game and
   after the map on a Clash game that carries both, which is why
   `FILM_CHAPTER_COUNT` is 8. **A
   frame in the model is a document id and never the picture**: the model is
   rebuilt inside a computed on every visit, so
   `shared/film/replay-shot-image.component.ts` reads one picture at a time
   through `ReplayRecordingService` — and nothing at all while the chapter
   is off stage. **The zone rule:** `core/rift-zones.ts` is the one table for the
   Rift image (percent space, blue base bottom-left; `MAP_SPOTS` also feeds
   the draft room and the tactical board): a death is placed by a seeded
   sample inside its zone's region, consequences are badges on the pip and
   never geometry, lanes and the river never mirror, only bases and jungles
   resolve by side, and every surface that shows a placed position says
   "Approximate, by zone" (plates read "by 14 min"; the board hides the
   note since nothing on it is placed). Their deaths carry side only. At
   most 60 tokens on a map. Slice 3: three film stocks, schema v4 lessons
   (Call it back on the card, keys `lesson:<i>`; the validator cuts our own
   Riot tags and drops a lesson naming anyone else) and the Before you play
   reminder (the top of Games; the roster quick actions carried a compact one
   until 10 Sep 2026, when the lead asked for it off the main view. Since
   12 Sep 2026 it is a rung of `app-next-up` rather than a card of its own —
   `shared/before-you-play.component.ts` was deleted, its behaviour moved
   whole. Since 10 Sep 2026 a reminder, never a question:
   `reminderFor` returns a `FilmReminder`, the one thing (the review's, else
   the first work-on as an ask), what the team committed to, the viewer's
   own seat's ask and up to two further asks (the other work-ons, then the
   viewer's own further points, each through `askOf`; until 10 Sep 2026 these
   were the lessons' whys, which explain an answer and read as fragments),
   each one line with a glyph,
   and Got it climbs the ladder; it walks every due film earliest first and
   switches off one with nothing to remind of). Reaching the card arms the
   first reminder only when `reminderFor` has something; `advance` counts
   from the later of `done` and now, so a late Got it never lands on a past
   date. A moment's seats light the map's tokens within 120 s of its minute
   only.
   **Cut 4 (10 Sep 2026): the film tells instead of asking.** The reads
   (`core/death-reads.ts`): every death of ours is read as one of four
   kinds, checked in this order — `bought` when an objective of ours fell
   within 60 s of it either way and the death was where the fight over it
   was (river or a jungle, or the victim on the take or near the pit),
   `avoidable` when the ledger carries a tag, `traded` when at least as
   many of theirs fell within 30 s in the same zone or with the victim on
   the kill and there is no tag, `clean` otherwise — with a line in the
   read's words, up to three glyphs, and the cost as the gold swing over
   the two minutes after (`readDeath`, `readCounts`, `readsLine`);
   `FilmDeathPin` carries all of it and `FilmMap` the counts (`reads`), the
   opening line and the three costliest avoidable keys (only deaths the
   gold fell after; a second death of one seat inside a minute is keyed
   `d:<minute>:<seat>:<sec>`). The beats (`FilmTape.beats`, at most
   forty since Part B on 10 Sep 2026, fourteen before): the tape narrates
   the coach's moments, the objectives, the fights, the firsts, the turn
   and **every death of ours** (a 'death' beat per map pin, titled
   "<name> falls, <read>"; the lead: "break the timeline down on the
   deaths"), folding a first, an objective, a fight or a death within 45 s
   of a moment into it (a folded death's pin key goes into the host's
   `FilmBeat.deaths`, and the card draws it as a tile with the read's
   badge; over the cap the firsts go first, then the latest deaths, never a
   moment, the turn or an objective); each
   card holds for a dwell measured off its words (3.5 to 8 s at the film's
   tempo, a bar running down through `MotionService.play`) and plays on,
   Pause holds it, a rail under the sheet jumps to any beat, and nothing
   on the tape or the map is a question any more. The glyphs
   (`shared/film/film-glyph.component.ts`, `app-film-glyph`): thirty
   hand-drawn 24×24 outline glyphs, one per `FilmGlyph`, in currentColor,
   with `GLYPH_TIPS`; the death scene
   (`shared/film/death-scene.component.ts`, `app-death-scene`) draws what
   was around a death from `FilmDeathScene` — the victim ringed in the
   read's colour, the slashed ward, our jungler a screen away, their
   jungler already close, the midline, the objective, the tower, the
   killers, the allies, the trade — with the parts rising in story order.
   Review version 5 adds `team.draft` (`ReviewDraft`: a verdict and up to
   two swaps, three since version 6, each `seat`, `out`, `in`, `why`,
   `gains` from `DRAFT_GAINS`; `in` is validated against the display names
   in `meta/championTraits`, so it is a Data Dragon spelling while `out` is
   Riot's id; version 6 (10 Sep 2026, the lead: "any other suggestions or
   will it only be one champ swap?") adds `alternatives` on a swap, up to
   two other champions for the seat resolved against the same list and
   never one of ours or the `in`, and `lacked` on the draft, up to three
   `ReviewGap`s of a `gain` from `DRAFT_GAINS` and a `why` citing the fact
   and the minute, independent of the champion list, both keys omitted
   rather than stored empty, so a v6 document with nothing to add is shaped
   like a v5 one), read by
   `buildDraft` into the chapter 'The draft, again'
   (`chapters/film-draft.component.ts`, right after The one thing): the
   seats turn from the champion played to the one to try, and every pill
   leads to a comp (10 Sep 2026): Save with <champion> writes a comp
   variant with `countsUnder` the comp we played and the pill then reads
   Open <name> and opens it (`/comps?comp=<id>`: the Comps page unfolds
   that card, scrolls to it and drops the param;
   `pages/comps/open-comp.util.ts` decides which, and waits for the list);
   a swap whose variant is already saved (five picks equal, compared
   through `championName` with a pick's " - note" dropped) offers Open
   <name> to everyone; the bottom pill is Open <comp> when the review
   names the comp we played or a saved comp carries the five picks as
   played (the review says `compId: null` until the next analysis run, and
   the chapter is rebuilt on every visit, so the picks lookup is what keeps
   a second visit from offering Save again), Save as a comp and open for an
   editor when neither holds (the comp as played, no `countsUnder`; a
   variant saved after counts under it), nothing while the review names a
   comp the list has not delivered, and Open Comps for a viewer. The
   chapter shows the gaps as chips over the swap cards ("What the five
   lacked", in --warn, the why as the tip and one muted line each) and
   "or X, or Y" under each swap's in tile; the card's and the panel's lines
   read "Nautilus, or Braum, or Alistar for Leona", and Copy for Discord
   prints "(or Braum, or Alistar)" plus a `-# Lacked:` line
   (`alternativesPhrase` in `core/review-view.ts`). "The draft held." shows
   only when the review names neither a swap nor a gap.
   **Part B (10 Sep 2026, evening): the film takes the screen.** The shell
   stamps `.page.is-film` on `/film` routes (`App.filmRoute`, NavigationEnd)
   and hides the topbar and the local-mode note; the Riot notice
   (`.site-footer`) stays as one thin line, because it must be visible
   wherever the app shows. **A hidden topbar means no nav link to wait for**,
   which the signed-in e2e loop over the deep links did on every path
   including `./film/none`; since 11 Sep 2026 it waits for `.film-bar` there
   instead, so the one page with no nav is not read as a page that failed to
   boot. The film bar is the only chrome: Back is a pill
   to `/games?match=<id>&tab=games`, and a second Escape within 2 s
   (`ESCAPE_TWICE_MS`) goes Back too, unless the first closed something:
   the tape and the map say so through `escaped` (the drawer, the full
   screen, the table, a note), which disarms the window, so Escape, Escape
   out of full screen stays on the film (second fix pass, 10 Sep 2026). The page measures `--topbar-h` (0rem
   on the route) and `--film-under` (the notice's real box) onto the
   stage, so `--film-h` is the whole screen less the notice; the Rift
   chapters spend `--film-rift-chrome` (8.5rem) and the tape
   `--film-scrub-h` more (13rem, measured: the scrubber's band, range and
   verdict line 9.45rem, the tools row and the gaps; the stage's 9.5rem
   default under-counts the scrubber and never applies to the tape), the
   map's square is `--film-h` less 8.5rem and its caption moved into the
   corner note's tip. The tape's speed is the viewer's
   (`TAPE_SPEEDS` in `core/film-style.ts`: ½×, 1×, 2×, 4× as 6, 3, 1.5 and
   0.75 s per game minute; localStorage `bom-film-speed`; the stock only
   picks the opening step through `defaultSpeedFor`, 1× or ½× for the slow
   stock and never faster on its own; `tapeSpeedFor` reads
   the stored key and `FilmClock.setRate` changes pace without losing the
   second). Six seat tiles (All and our five) stand in the side column of
   both chapters, over the tape's sheet and beside the map's legend (the
   plan had the tape's over the Rift; there they cost the square 3.4rem and
   the tape overflowed its frame at 1920x1080, so the Fix pass moved them):
   a seat filters the Rift (`seatFilter` on
   `app-rift-map`: other seats' deaths and backs hide, plates follow the
   seat's lane, their deaths fade, objectives stay) and the stops the tape
   makes (`beatIsAbout`), and on the map the legend counts, the strip and
   the cards follow it. The rail is one chip a minute (`railGroups`, a
   count badge when the minute holds more than one, a dimmed chip for a
   minute the seat view skips) with a Deaths only pill. Full screen on the
   tape and the map (`.is-full` on the chapter's root): the square grows
   to `--film-h` less 5.5rem (the tape keeps its scrubber under it), the
   side column becomes a 24rem drawer over the right edge with a Close
   pill (`.is-drawer-closed`; a Sheet/Cards pill over the square brings it
   back, and so does any stop landing in it); `closeTick` (the page's
   Escape) closes the drawer first and leaves full screen next; under 48rem
   the drawer is a bottom sheet. The solo-death rule (review version 6, the
   lead: "we had solo deaths so a ward would not have helped"): a death
   with one killer, the lane opponent, is a wave-state or trade choice —
   hold the wave and wait for the jungler — never a ward; `game-facts.ts`
   counts a solo death or an execution as never dark (the ledger's own bar
   for its `ward` tag), words the solo line off who the one killer was
   ("to their jungler alone" when it was, so it agrees with the ledger's
   gank instead of calling it one-on-one; second fix pass, 10 Sep 2026),
   and the prompt's shared RULES say so to both calls.
   The old progress keys `map:*` and `tape:*` are ignored: `tallyLine`
   only counts that calls exist, so an old film still reads "Continue".
   **Part C (10 Sep 2026, shipped locally, waiting for a deploy): positions,
   vision and a place to work on the game.** The lead: "we want to see where
   our vision was placed, to see did we have to place a ward there or not",
   "a visualisation tool from a certain point in this timeline map to see
   where we could have been better positioned", "safe zones and danger
   zones, almost like a heat map". Timeline version 3 keeps `positions`
   (every seat on both sides once a minute, Riot units rounded to 100, null
   without a frame, theirs keyed by seat and never a puuid or a name) and
   `wards` (ours: `sec`, `seat`, `type` trinket/control/other, `x`/`y` at
   the placer's frame position because a ward event carries no position of
   its own, `killedSec` from the earliest matching kill by one of theirs);
   both are the second trim step after `theirDeaths` under `MAX_BYTES`, and
   every surface that draws either says approximate. `core/rift-zones.ts`
   `riotToPercent` maps Riot units onto the image by a two-point fit to the
   table's own Baron and Dragon pits (so the frames agree with the
   zone-placed deaths; re-measure the pits against the PNG and it re-fits
   itself), `framesOf`/`wardsOf` in `core/film-build.ts` build
   `FilmTape.frames`/`wards` (a control ward stands to the end, anything
   else 90 s, a kill wins), and `placeAt` blends the two nearest frames to
   any second. The layers on `app-rift-map` (never tokens, so never against
   the sixty cap): Everyone (`frames` + `showEveryone`, the ten sliding on
   transform alone, ours ringed in the accent, theirs faded, a champion in a
   seat; a seat that died fades for `DEAD_WINDOW_SEC`), Vision (`wards` +
   `showVision`, the film's ward glyph at the placer's spot with its sight
   as a dashed circle) and the heat (`heat` + `showHeat`, `FilmHeatCell`s
   from `core/film-heat.ts` `buildHeat`: a cell per ward at its sight
   weighted by its life over `HEAT_FULL_LIFE_SEC`, a cell per death at
   `HEAT_DEATH_R`, a wash of --ok and --warn under everything). The tape
   wears Everyone (on) and Vision (off) as pills in its tools row when the
   tape has frames, and Work on this second (also on a death beat's card)
   opens the **position lab** (`shared/film/position-lab.component.ts`,
   `core/position-lab.ts` pure) over the frame with the Rift paused: the
   ten where the blended frame put them, drag ours (a ghost stays where the
   minute put them), put a trinket or a control ward down, draw move, path
   and dive arrows (the coach's hand-drawn board), and read the ground —
   their reach over the next thirty seconds off their pace between the two
   frames (dashed --warn), our sight (--ok) and the shading between (safe,
   seen, dark) — with one line under the map reading the difference
   (`readingOf`). Save (editors; a viewer gets the lab without it) writes
   the drawing as a film note keyed `lab:<sec>` (`FilmNote.lab`, a
   `FilmLabDrawing`: the moves, the wards, the arrows, percent space) with
   the reading line as its text, through `saveFilmNote`'s optional `lab`;
   Escape closes the lab before the drawer or the full screen. The map
   chapter offers Vision heat beside the legend when the timeline kept the
   wards (the corner note gains "where our wards stood, approximate") and
   Work on this second on a death's card, which reaches the tape as a seek
   request with `lab` (`FilmSeekRequest.lab`) on the death's own second.
   Until the functions are deployed only the dev road makes a version 3
   document: `scripts/dev-timeline.mjs` (`RIOT_API_KEY=... node
   scripts/dev-timeline.mjs <matchId>` after `cd api && npm run build`)
   builds one from `api/lib` and prints a `localStorage.setItem` line for
   the dev override `bom-dev-timeline:<matchId>`, which
   `MatchTimelineService.load` reads in dev builds only (after its cache,
   before Firestore; a bad paste warns once and falls through).
   **The queue batch (11 Sep 2026), from the lead with screenshots.**
   *A filter on the map means focus*, not a dimming: a read leaves only the
   deaths of ours the film reads that way — no dots of theirs, no fight
   blobs, and the vision heat keeps its ward cells alone — and a seat leaves
   that seat's deaths, backs and lane plates, the dots it was in on
   (`FilmMap.theirs[].seats`, straight off `theirDeaths[].ourInvolved`, and
   `FilmTapeEvent.seats` from the same place so the tape obeys the rule it
   was written for — without them a champion's view cleared every dot on the
   tape and a traded death read as a solo one) and
   the fights it fell in. `staysForRead` and `staysForSeat` in
   `shared/film/rift-map.component.ts` are the one rule for both; nothing
   that survives a filter is faded any more. **Vision heat is a filter too**
   (second fix pass): while it is lit the dots of theirs and the fight blobs
   come off, so the square is our wards against our deaths and nothing else.
   The strip, the table and the
   card walk the filtered set (`walk()`), while the legend's counts stay the
   seat's (`seatPins()`), because a count is what picking that pill would
   show. The corner note reads the marks actually on the square, not the
   whole game, so a filtered view never describes pins that are not there. *Exact positions*: with timeline version 4 a death is placed from
   the kill event (`placeOurDeath`, `placeTheirDeaths`, `placeObjective` in
   `core/film-build.ts`), and `FilmDeathPin.placed` / `FilmMap.theirs[].placed`
   / `FilmTapeEvent.placed` say `'event'` or `'zone'` per mark;
   `placementNote`/`placementOf` turn a screenful of them into one of three
   sentences — "Where the game says they fell", "Mostly where they fell; a
   few by zone", "Approximate, by zone" — which the Rift's corner note and
   the map chapter's own note (with its matching tip, `PLACED_TIP`,
   `MIXED_TIP`, `APPROXIMATE_TIP`) print, and the death card says which for
   the one death it is showing. An event-placed pin may sit outside the
   coarse region `rift-zones.ts` draws for its zone: the regions are the
   film's buckets and the event is the game's own answer. *The legend*:
   `shared/film/mark-legend.component.ts` (`app-mark-legend`) behind a "What
   the marks mean" pill on the map, on the tape and in the lab draws every
   mark with its sentence — the four reads off `READ_LABELS` so the words
   cannot drift, the pin, the dot, the blob, the objective glyphs, the ward
   and its sight, the heat's two washes, and the lab's ghost, reach, three
   shades, rings and plain death marks. **A host declares what its own
   square draws** (`MarkSurface`: reads, theirs, objectives, vision, heat,
   lab) and gets those rows and no others, because a legend naming a mark
   the reader cannot find beside it is worse than none: the map has the
   reads, the dots and the blobs (and the washes where the timeline kept the
   wards), the tape has the objectives and our vision, which are drawn
   nowhere else, and the lab has its own. A panel, not a modal: nothing
   behind it is blocked, and the Escape it handles stops there so the film's
   two-Escapes rule is not armed by it; the map and the tape both fold it
   with their drawer, since it lives in the column full screen hides.
   *The tour*: `film-room` in
   `core/tours.ts`, nineteen steps over the rail, the map, the tape and the
   lab, `autoStart: false` and `onlyHere: true` (a `/film/` prefix path
   cannot be walked to — `TourService.start` would append a player id — so
   Help and tours lists it with the reason and the door is the "Show me
   around" pill in the film bar, shown only when the film has a map or a
   tape). Every step past the first carries a `before` — `openFilmMap`,
   `openFilmTape`, `openFilmLab` — because the deck renders one chapter at a
   time; they press the deck's own `film-dot-<kind>` buttons, and each one
   **reports whether that door exists**, so a film with no map, or a
   timeline that kept no positions, skips those steps at once instead of
   spending `waitFor`'s three seconds of "Finding it…" on each. While a tour
   walks, the film's key handler stands down and the lab opens with
   `dialog.show()` rather than `showModal()`, since nothing painted at any
   z-index reaches over the browser's top layer.
   **Post-game graphs** (`shared/game-graphs.component.ts`) are the scoreboard
   on a Games row, drawn from the row's `RowStats` so replays and Riot games get
   the same view; a figure a row lacks is a dash. Since 12 Sep 2026 they **are**
   Starter's scoreboard — the ten-column table and the Table | Graphs segment
   that used to choose between them are Full only, and the open row runs review,
   objectives, scoreboard, note, actions, story in that order, because the
   review used to sit fifth under a scoreboard and five buttons. The **Reviews
   tab** (`?tab=reviews`) mounts the newest review open in full through
   `app-game-review` rather than drawing posters; the posters and the comp
   filter are Full only. Other surfaces: Coaching notes on the player profile,
   and "Played out as drafted in n of m" on each Comps panel.
   **Comp expectation**: `Comp.expect` (early, scaling, objectives,
   teamfight; low/mid/high) is derived from champion traits in
   `core/comp-expectation.ts`, editable on the Comps panel
   (`expectSource: 'edited'`), and written on every comp save through
   `CompExpectationService.stamped` so the function always finds one.
   `compareCurve` is mirrored in `api/src/game-facts.ts` on purpose; keep
   the two identical. The Riot policy lines (own players only, choices not
   orders, post-game only) are in the prompt and the validators;
   `docs/ai-provider-note.md` records what leaves the system. Anything on
   Comps that decides which games count as a comp goes through
   `effectiveComp` — `retro()` and "Played out" both do.
   **Quick actions** (`shared/quick-actions.component.ts`, on the Roster
   page under the hero) are links into page states: `/games?refresh=1`
   runs the refresh and marks what came in (`justPracticed`, the param is
   dropped afterwards), `/admin?tab=comps&add=comp` opens a blank comp,
   `/tournaments?view=draft` the draft room, `/games?tab=reviews` the
   Reviews tab. The profile's Coaching notes open on a rule-based digest
   (`core/coaching-digest.ts`: which themes the notes keep touching) with
   the game-by-game notes behind a fold.

**Tours are data** (8 Sep 2026). `core/tours.ts` holds `Tour { id, version,
match, role, needs, steps }`; a step names a `data-tour` anchor and, when it
needs them, the route, the query, edit mode and a `before` action. Adding a
tour is appending to `TOURS` and putting `data-tour="…"` on the anchors;
re-showing one to everyone is bumping its `version`; `whats-new` is the
empty hook for that. `services/tour.service.ts` walks the page (navigates,
turns edit mode on and restores it, opens every `<details>` above the anchor,
waits three seconds for it, and **skips a missing anchor rather than throw** —
the e2e console sweep runs on every page). The overlay
(`shared/tour-overlay.component.ts`) is fixed at the app root, never inside a
`.card` (cards carry a transform), and lets clicks through everywhere but the
card; the last button is "Got it" and the escape is "Skip tour", the two names
`e2e/tests/auth.setup.ts` and the `authenticated.spec.ts` beforeEach click,
scoped to `.tour-card` since 10 Sep 2026 because the Next up card (the Before
you play reminder until 12 Sep 2026) and the Games banner carry a "Got it" of
their own.
A tour whose `match.path` is a prefix (ending in `/`) is opened from elsewhere by
appending the first player's id — right for `/player/`, wrong for anything else —
so such a tour carries `onlyHere: true` (the film room's does, 11 Sep 2026) and
`blocker` then tells the help list to say where it starts instead of walking there.
Never name a tour button with "edit mode": a viewer test asserts none exists.
Nothing a tour adds to the draft room may change its height.
**Prep & Draft has two tours with no role and no `editMode` step** (12 Sep 2026):
`prep-read` walks a series card as it stands and starts by itself; `draft-watch`
walks the room and carries `autoStart: false`, because a tour opening over a
draft in progress is the worst moment this app has. The other three tours on
that page are all `role: 'editor'` with every step behind edit mode, which is
why nobody who only reads the page had ever been shown it. Note the correction of
12 Sep 2026: the "too much information" complaint came from **contributors as well as viewers**, so
edit-mode surfaces are in scope for the same act-or-check pass and have not had one yet.

Seen state is `userPrefs/{email}.toursSeen` (`services/user-prefs.service.ts`, localStorage
fallback; the old `tourSeen` flag is still written for the welcome tour). The
welcome modal in `app.html` is gone; the welcome tour replaced it, and since 13 Sep 2026
(version 2) it starts on `/home`, where sign-in lands — on `/roster` it only ever met people who went
looking; Roster's own tour took its two Roster steps, and `auth.setup.ts` waits for the tour card
rather than looking once. Help and
tours in the user menu lists every tour the role can run; the hero pill
(`shared/tour-pill.component.ts`) offers the page's tour and, for an editor
with it off, a reminder that the controls live behind Edit mode.

**Explanatory prose has one rule** (8 Sep 2026): it stays on the page only when
it tells a viewer what would fill an empty space. A caveat or a definition a
reader wants once goes behind `<app-info-tip>`; anything about seeds, keys or
costs is admin-only; the rest was deleted. The player editor is one form
(`shared/player-editor.component.ts` over `services/player-editor.service.ts`)
used by Admin and by the drawer opened from a profile or a roster card; the
bench flag is labelled **A team / Bench** everywhere; every Riot refresh is
"Refresh … from Riot" with its scope.

**How much of a page to draw is a preference, not a layout** (12 Sep 2026).
`UserPrefs.depth?: Partial<Record<DepthSurface, 'full'>>` where `DepthSurface`
is `'games' | 'reviews' | 'patterns' | 'prep' | 'roster' | 'comps'` (`roster` is
one switch for all four Roster views); **absent means Starter**, so no
stored document changed shape and going back to Starter deletes the key rather
than storing the default a second way. It is per person (Firestore, through
`UserPrefsService.commit()`), not per browser like `bom-split-view` — a reading
preference should follow whoever is reading. One shared control draws it
everywhere: `shared/detail-toggle.component.ts`, a `.view-segment` taking
`surface`. The rule for what sits at which level, applied on every surface:
**does a reader act on it, or check it?** Act is Starter, check is Full.
Every Starter | Full in the app reads it since 12 Sep 2026; do not give a page a
signal of its own, and do not invent a second vocabulary for the same idea.
`UserPrefsService.load()` puts the local copy into the signal **before**
awaiting Firestore, or a stored Full renders Starter and flips.

**A comp panel builds only while it is open** (12 Sep 2026). A shut `<details>`
still renders everything inside it, so edit mode built every comp's board and a
173-champion wall nobody could see. `CompsComponent.isOpen` is
`full() !== flipped.has(id)`: Starter opens nothing, Full opens every comp, a
click turns one against the depth, and a change of depth resets them — only a
change, or the first run would undo a `?comp=` reveal. Starter keeps the five,
the notes, the plan, the expectation, the bans and the record's headline; Full
adds how it played out, each result, the notes from its games and Counts as
part of. `app-comp-board` draws its wall only while a seat is empty or after a
seat or **Change picks** is pressed, and closes it once all five are in — the
same clicks a swap always took. The tours walk one comp, `tourCompId` (a
finished comp with a record, else a finished comp, else the first), because the
anchors used to repeat on every card and each step landed on whichever came
first; `openTourComp` opens it and `comps-read` is the tour a viewer gets.

**A deep link pins a game, it does not widen the list** (12 Sep 2026).
`?match=` on `/games` sets `pinnedMatch` and `listRows` prepends that row only
when the window does not already hold it; `days()` stays where it was. The
record tiles, the player lines and the form strip keep reading `rows()`, so **a
pinned game never changes the record** — which is the whole reason to pin rather
than widen. `?comp=` still widens: it is a visible, deliberate filter with a
chip that says so.

**One card at the top of Games says what to do next** (12 Sep 2026).
`core/next-up.ts` is a pure ladder — an unwatched review, then a due film
reminder, then a game with no review (editors), then the next opponent, then
**nothing, which renders nothing**. `shared/next-up.component.ts` draws it, at
most three lines and two pills. It **replaced** `app-before-you-play`, which was
deleted: two cards at the top of Games is the complaint this answers, restated.
Everything that card did is still there — Got it walks the reminder up the
ladder, Open the card goes to the film's card, a due film with nothing to remind
of is switched off, and that rung still needs Firebase. The ladder only looks
back `NEXT_UP_DAYS` (14): 181 games over nine months are all "unwatched" the day
somebody signs in.

**Prep opens on the series you have to play** (12 Sep 2026). `nextSeriesId`
(`pages/tournaments/series-order.ts`) is the first series with no result
recorded, and the last one when the tournament is over. Read from the games, not
from `TournamentSeries.status` — that field is only ever written as
`'scheduled'`, so a rule asking it would quietly do nothing. The stored order is
left alone. At Starter the roster is one line a player (`topPlays` and
`bestRank` in `core/opponent-view.ts`); **edit mode always draws the six-column
table**, because every scouting control lives in its cells. One win-rate scale
everywhere on the page: `rateBand` (65 / above 50 / 50 / below), never a
hand-coded 55/45.

**The design system is written down** (12 Sep 2026, `docs/design-system.md`). Read it before
adding a control or a colour. The three rules that cost the most time before it existed:

- **A derived token goes on `body`, never `:root`.** The theme blocks are `body[data-theme=…]`, so
  a custom property on `:root` resolves against the default palette and freezes in all ten themes.
  `--text-2` (used 23 times, defined nowhere) and `--surface-card` both broke this and nobody could
  see it. Ten themes, nineteen tokens each.
- **Seven button roles; the codebase currently declares 81.** Reach for `.view-btn` first. If you
  are about to declare padding, radius, border and background on something clickable, you are
  drawing it again. Every clickable thing owes a `:hover` and a `:focus-visible`. An action is a
  pill, never an underlined link — compact is the answer to "it is only metadata".
- **A collapsible panel's whole header is the toggle**: `<details class="card fold-card">` +
  `<summary class="section-head">` + `.fold-chevron`. Copy an existing one; do not write a fold
  button. A control inside a clickable header needs `preventDefault()` **as well as**
  `stopPropagation()` — inside a `<summary>`, stopping propagation alone is not enough.
- **One toolbar on every page, the Games one** (12 Sep 2026): a bare `.view-controls` straight under
  the hero, the page's views as `.view-btn` pills on the left, page-wide tools in
  `.view-controls-tools` packed right, `app-detail-toggle` last and only on a depth surface. A control
  one view lacks is removed there, never hidden — Prep's switch hidden on Draft pushed the draft room
  35px down. See `docs/design-system.md` §3½.

**The deployed site says which commit it is** (12 Sep 2026). `scripts/gen-build-info.mjs` writes
`frontend/public/build.json` alongside the two `build-info.ts` files, and a public e2e check waits
up to 90 s for its SHA to match `GITHUB_SHA`. Without it `verify` could pass while testing the
PREVIOUS build — it starts the moment `deploy` returns and Pages propagates on its own clock, which
is how a broken check reached main twice. `build.json` is gitignored: nothing imports it, so its
absence cannot break a build.

**Both checkout steps need `fetch-depth: 0`.** `API_SHA` comes from `git log -1 -- api`, the last
commit that touched the functions, so a frontend-only deploy never reads as a backend behind. In a
shallow clone the root commit has no parent and git treats every path as changed in it, so that
command returns HEAD — every build stamped its own SHA as the api one and the Admin page's drift
warning fired after every frontend-only deploy.

**The authenticated e2e tests run locally.** `auth.setup.ts` takes `FIREBASE_SERVICE_ACCOUNT` as
inline JSON (how CI holds it) or as a path to the key file (how a developer's machine holds it).
Run `npx playwright test --project=authenticated` from `e2e/` against the live site before pushing
a change to a surface they touch — they only ever ran in CI before, which is how a broken check
shipped twice.

**Native checkboxes and selects are styled once, globally** (`styles.css`, the
"Native checkboxes and selects" block): `appearance: none` with the app's
tokens and a neutral chevron forced with `!important`, because older
per-page rules paint `background` shorthand over it. Do not restyle them
per page. Other 8 Sep 2026 decisions from the same batch: the Games list
starts folded (a `?match=` link, a refresh with new games and the tour's
`openGameList` action open it); an editor can **remove a review**
(`TeamDataService.deleteGameReview`, the function still writes them); the
roster card sets the **main seat** as well as the second (the same
`Player.role` the editor sets, so Patterns' Main has something to count);
the coaching pills on a profile are buttons that open the notes behind
them (`touches` in `core/coaching-digest.ts`); and the **Draft** pill on every
series head opens the room on its next open game or a new one
(`TournamentContextService.draftSeries`; `createTournament`, `createSeries`
and `createSeriesGame` return the id they made, and `openDraft` selects the
series' group).

Adding a field to a cached match means **bumping `CACHE_VERSION`** in
`analysis-cache.ts`. Old entries then re-fetch once, inside `MAX_NEW_FETCHES` per
run — so the field is *absent* on some matches for several refreshes, and any UI
over it has to say so rather than render a zero. Riot rate limits hard; that
budget is the reason the cache exists at all.

**`matchCache` is shared, and player enrichment reads it before Riot.**
`enrichPlayer` used to read a fixed twelve matches per queue because each was a
Riot call. It now pages `ENRICH_SAMPLE_PAGES` (5, three until 9 Sep 2026) lists of `ENRICH_SAMPLE_SIZE`
(100, Riot's per-request ceiling) match ids — one call per hundred — reads
them from `matchCache` in a single `getAll`, and spends Riot calls only on the
ids that miss, capped at `MAX_ENRICH_FETCHES` (40 per queue per run; solo and
flex together fit one player inside the key's hundred calls per two minutes).
Everything fetched is written back through `getCachedMatch`, so scouting the
same player again reads the *next* forty for the same price. Each queue's
record carries `sample` (read / available / unread), which the roster table
shows under the rank as `40/500+` — the plus is the invitation to scout again.

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

**There are three floors and they are deliberately different.**
`INDEX_MIN_GAMES` (50, `api/src/matchup-index.ts`) is only a document-size
guard. `MIN_MATCHUP_GAMES` (50, `matchup-stats.service.ts`) is the quote floor:
equal to the backend's so nothing the index holds is hidden, and it must never
drop below it or the UI would ask for pairings the index has already
discarded. `SOLID_MATCHUP_GAMES` (200) is the honesty threshold, where the
±0.98/√n interval is tight enough that a lopsided matchup separates from even;
between 50 and 200 a rate is shown *thin* — dimmed, with its games and its
margin in the tip — because the team asked (5 Sep 2026) to see the matchup
they are actually in rather than a dash. On patch 16.17 that was the
difference between 49 and 353 Support pairings being quoted.

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
`core/comp-alias.ts`, because the Games page derives comp membership from
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
- Styling is one global `frontend/src/styles.css` (no per-component styles) built on CSS custom properties. Theme is switched via `body[data-theme="..."]` (`bomb` — the default, built on the team mark in `public/assets/brand/` — then League regions `hextech`, `demacia`, `noxus`, `freljord`, `ionia`, `shadow-isles`, `shurima`, `void`, and `light`; the list and labels live in `ThemeService`, and retired names are mapped there so a stored choice never goes blank); **always style through tokens** (`--accent`, `--text-0/1`, `--ok` for wins/positive, `--warn` for losses/negative, `--card-border`, `--surface-*`) so every theme works.
- **One champion filter, followed across pages.** `ChampionFilterService` holds
  the name (a root signal, kept in `sessionStorage`), `<app-champion-filter>`
  is the box, and each page passes its own count and noun so the line reads
  "2 comps with Tristana" there and "5 scrims with Tristana" here. Analysis and
  Review narrow the games (and every record over them), Comps the comps it is
  drafted in, Roster answers who on our side lists it, Prep & Draft who on
  the scouted opponents' side plays it. Compare through `filter.matches()`/`filter.passes()`, never by name:
  games carry Riot ids (`MonkeyKing`), people type Wukong.
- Shared UI lives in `frontend/src/app/shared/` (e.g. `overflow-menu.component.ts`, `champion-chip.component.ts`, `external-profiles.component.ts`); reuse these rather than re-rolling menus/chips. `champion-grid.component.ts` is the searchable wall of champions used by both the comp board and the live draft — it owns no idea of *where* a pick lands, and only emits a name.
- **Sizing is in `rem`, not `px`.** The root font size is a `clamp()` on `html`, so the whole interface scales with the monitor: unchanged below ~1600px, about 31% larger at 2560px. A `px` width or height silently opts out of that and will look wrong on a large screen. Borders, radii and shadows are the exception and should stay in `px`. Material Symbols carry an explicit `1.5rem` because Google's stylesheet pins them at 24px.
- Champion art: `ui.championIconUrl()` for the square icon, `ui.championArtUrl()` for **splash** art on wide cards. Splash is 1215×717 landscape; the loading art at 308×560 is portrait and crops badly into anything wide.
- Commit messages in this repo are a single imperative summary line describing the user-facing change, often with a short rationale after a semicolon.
