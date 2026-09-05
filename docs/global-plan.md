# Generic team app: multi-link import, opponent scouting, multi-tenancy

*The "Global plan" from the League App project, written 30 Aug 2026 and
committed here on 5 Sep so every session reads it. Phase 1's opponent roster
has since shipped as `OpponentPlayer[]` on a series and on a scrim opponent
(see CLAUDE.md); the multi-link parser is `core/riot-id.ts`. Phases 2–4 and
multi-tenancy are still open.*

## Context

Bom Squad Draft Hub is hardcoded to one team. The goal is to make it work for **any**
team: paste a multi-link, and the app populates itself — roster, scouting, and as much
of the comp layer as is honestly derivable. On top of that, absorb the useful parts of
the six tools currently used side by side (drafter.lol, DraftGap, Mobalytics, u.gg,
OP.GG, Lolalytics).

The blocking question was legal, and it has a clean answer.

### Is the multi-link legal? Yes — because we never call OP.GG

**A multi-link is a transport for Riot IDs, not a data source.** The IDs are already in
the URL string. Parsing the string the user pastes involves **no request to OP.GG**, so
no scraping happens. We then resolve each ID through Riot's own
`account/v1/accounts/by-riot-id/{gameName}/{tagLine}` — already used in four places in
`api/src/index.ts`.

So "multi-link **or** Riot IDs" is a false choice: the link *is* Riot IDs with better
UX. One code path serves both, and pasting `Name#TAG, Name#TAG` works identically.

What is **not** allowed, and stays out: fetching or scraping OP.GG. Riot's General
Policies forbid taking data from "any other sources outside of the provided Riot API
Endpoints," penalty "indefinite revocation of your access to the Riot Games API."
Independently, OP.GG's own help centre states their data is not provided to third
parties, and they publish no documented data API. Both walls, same conclusion.

### What the Riot API can and cannot populate

| Populates | How |
|---|---|
| Rosters — names, tags, icons | `account-v1` → `summoner-v4` |
| Ranks (solo/flex) | `league-v4/entries/by-puuid` |
| Champion pools, role detection, playstyle, strengths/weaknesses, ban candidates | `match-v5` → `summarizeMatches` / `classifyArchetype` — **all already built** in `enrichPlayer` |

**Comps cannot be imported from a link.** A comp is your drafting *intent*; no external
source holds it. Two honest substitutes are in scope (below): comps *derived* from games
you actually played, and comps *imported* from a file you supply. Custom/scrim games stay
invisible regardless — queueId 0, 404 on match-v5, tournament codes only.

### The six tools, honestly

| Tool | Its job | Verdict |
|---|---|---|
| **drafter.lol** | draft room | Already being built here. Their API is completed-drafts-only (no turn, phase or timer, so no live view) and read access is $19.99/mo. Keep building our own. |
| **OP.GG** | scouting | **Fully replicable** via the Riot API. This is the import feature. |
| **Mobalytics** | coach | Partly built already — `classifyArchetype` + `describePlayer`, and `/review`'s `describeLoss`/`describeWin`. Extend, don't integrate. |
| **DraftGap** | draft suggestions | Needs aggregate win rates. No compliant free source — their own datasets come from public buckets outside Riot's endpoints. → user-supplied file. |
| **u.gg** | benchmark | Same wall. → user-supplied file. |
| **Lolalytics** | data analyst | Same wall. → user-supplied file. |

## Approach

### Multi-tenancy without moving live data

The critical constraint: Oryx Fearless League runs to **5 Oct** and this app is used on
match day. So tenancy is introduced *additively*.

A `TeamScope` service returns a path prefix. The default team resolves to the **existing
flat paths** (`players`); any new team resolves to `teams/{teamId}/players`. Bom Squad's
data never moves, there is no migration, and a bug in the new path cannot reach it.

`persistUpsert`/`persistRemove` in `frontend/src/app/services/team-data.service.ts`
funnel **every** write through `doc(db, key, id)` — so one `path(key)` helper plus the
13 `collection()` and 6 `doc(db, 'meta', …)` calls in `initFirebase()` is the entire
change surface. `EntityKey` stays the vocabulary.

Supporting changes:
- `firestore.rules` — add a `match /teams/{teamId}/{document=**}` block reading
  `teams/{teamId}/access/{email}`. Leave the existing root rules **untouched**.
- `core/access.ts` — `BOOTSTRAP_ADMIN_EMAILS` becomes per-team (a team's creator is its
  admin); the hardcoded email stays as the default team's bootstrap. Mirror in
  `api/src/index.ts`.
- A `teams/{teamId}` root doc (name, region, createdBy); `Settings.teamName` folds in.
- Team switcher + "create team" in Admin.

### Opponent rosters — the biggest gap

`TournamentSeries.opponent` was a **bare string**. There was no opponent roster in the
model at all, which is exactly what scouting needs.

Add an `OpponentTeam` entity (id, name, region, players with pools + ranks), wiring **all**
of the CLAUDE.md checklist: model + `TeamData` + signal + `onSnapshot` + `EntityKey` +
`pushLocalToSignals`/`persistLocal` + `seedFirestore` + CRUD, mirroring `compResults`.
`TournamentSeries.opponentTeamId?` links to it; `opponent` stays for back-compat.

*(Shipped differently: the roster lives on the series and on the scrim opponent as
`opponentPlayers`, not as its own entity.)*

### The importer

**`frontend/src/app/core/multi-link.ts`** — pure and tested, no network:
`parseMultiLink(input) → { region, riotIds: { gameName, tagLine }[] }`. Format-tolerant
by design: OP.GG (`/lol/multisearch/{region}?summoners=`), the older
`/summoners/{region}/multisearch`, u.gg, and a bare comma/newline list of `Name#TAG`.
This function is what keeps the feature legal, so it gets its own spec file.
*(Shipped as `core/riot-id.ts` `parseRiotIds`.)*

**`ImportService`** — a queue over the parsed IDs calling the **existing**
`PlayerEnrichmentService.enrichPlayer()` one player at a time, with per-player progress
signals. *(Shipped as `OpponentScoutService`.)*

> **Rate limits shape the UX.** `enrichPlayer` costs ~18 Riot calls per player, and a
> Personal key's budget is ~100 per 2 minutes. A 5-player import takes roughly two
> minutes; ten players, four. `riotFetch` already retries 429 on `Retry-After`, so this
> degrades to *slow*, not *broken* — but it must be a visible, resumable queue with
> per-player status, never a single spinner.

Entry points: a paste box in Admin → Players (own roster), and on the series panel
(opponent). Both reuse `autoFillPlayerSlugs`, which already builds the `Name-TAG` slug.

### Comps — two honest paths

1. **Derived** — `getCompAnalysis` already attributes cached games to comps. Add a
   "create comp from this draft" action in the Analysis game panel: turns a game you
   actually played into a saved comp. Small addition over data that already exists.
2. **Imported** — paste/upload a comp list (JSON/CSV).

### User-supplied datasets

The app ships **no scraper and no bundled dataset**. An admin uploads a CSV; it is parsed
to champion/comp win rates and shown *beside* own-team numbers, always labelled with its
source and date so an external number is never mistaken for yours. Oracle's Elixir is
documented in-app as the known-good source (deliberately released for public use).

One caveat to state plainly in the UI copy: the app being neutral does not launder a
file's provenance. A scraped dataset is still the uploader's exposure.

### Key type

Personal key stays. It covers "a small private community" — fine while access is invited.
Going public needs a **Production** key applied for *before* launch (weeks, refusable), so
keep region/key handling in config and the tenancy model public-ready. Riot attribution is
already shipped.

## Sequencing

| Phase | Work | Risk |
|---|---|---|
| **0** | `core/multi-link.ts` + specs | None — pure function, no UI, no schema |
| **1** | `OpponentTeam` entity + import into a series | Additive; touches no existing page |
| **2** | Own-roster bulk import in Admin | Reuses 0 + 1 |
| **3** | Multi-tenancy (`TeamScope`, rules, switcher) | Rules + auth — **recommend after 5 Oct** |
| **4** | Dataset upload + comp derivation | Additive |

Phase 3 is sequenced last on purpose: it is the only phase that touches auth and
`firestore.rules` on a live app mid-split. The default-tenant design means even then no
data moves.

## Verification

1. **`multi-link.ts` unit tests** — real pasted links from OP.GG and u.gg, a bare
   `Name#TAG` list, names containing spaces and non-ASCII, and a malformed link. Assert
   **no `fetch` is called** (the test that proves the compliance claim).
   `npm test -- --no-watch` from `frontend/`.
2. **Import in the running app**, not just green tests — local mode: blank `apiKey`,
   `npm --prefix frontend start -- --port 4201`, clear `bom-team-data`, dismiss the tour
   with **Got it** first, then paste a real multi-link. Read state at the source via
   `ng.getComponent(...)` rather than the DOM.
3. **Rate-limit behaviour** — import 5 players against the live key and confirm the queue
   shows per-player progress and survives a 429 rather than failing the batch.
4. **Tenancy isolation** (phase 3) — create a second team, confirm its writes land under
   `teams/{id}/…` and that Bom Squad's root collections are **untouched**; verify a
   non-member is denied by rules, not just by hidden UI.
5. `npm --prefix api test` for any backend change; `e2e` only after a Pages deploy.

## Restore before any commit

Local mode blanks `apiKey` in `environment.ts`. Restore the key before committing:

```bash
git checkout -- frontend/src/environments/environment.ts
```
