# Bom Squad Draft Hub — Session Summary (Aug 21, 2026)

*From the League App project's `claude` folder, committed 5 Sep 2026. Much of
the hardening brief that followed it (`docs/hardening-brief.md`) has since
shipped: the analysis funnel, `CACHE_VERSION`, the build SHA on both sides.*

## New features

### Comps

- Categories + notes per comp, with a category filter dropdown; edited inline in edit mode (`217fd58`). Later split Category and Notes into separate labeled fields so notes don't get buried in the category chip, and capped the chip width (`3def0db`).
- Per-comp game plan (Early / Mid / Late) — replaced the redundant global macro cards; the old `MacroSummary` machinery was retired (`2604199`).
- Per-comp ban recommendations — champions to ban when running each comp, shown as champion-icon chips (`823f049`).
- Role coverage per comp slot — each role shows which roster players can fill it (main vs flex), rendered as a light single sub-line instead of stacked pills (`1ccf765`, `29c03e5`).

### Players

- Secondary / flex roles — a player's main role plus roles they can flex into, shown on Profiles, Player Intel, and per comp slot; edited via toggle chips in admin (`1ccf765`).
- Champion pool expanded to 5, then sourced from the all-time Champion Mastery API (with a DDragon id→name map, cached), falling back to recent most-played (`55b2251`, `503a2d2`).
- "Working On" section is now collapsible (`32bad1b`).
- "Refresh all from Riot" bulk enrichment button on Profiles (`7e1c325`).

### UI

- Bigger champion icons across comp rows, player intel, and game panels (`32bad1b`, `63b9866`).
- Edit mode is now unmistakable — accent viewport frame, glowing toggle, floating "Edit mode on" pill (`e16886a`).
- Practice Board collapsible (`8fb2d6a`).

### Match Analysis

- Analytics depth: side win rate, recent form, toughest/best matchups (`f2c107a`).
- Game Log now merges Riot match-history games (read-only) with manual logs (`fc9113f`).
- Comp-match strictness slider (2–5 champs) — re-buckets games into comps vs off-the-books live on the frontend, no refresh needed (`ecc1485`).
- Overall W–L record for all stacked games + win % on the off-book stat (`05b4f68`, `a9889ce`).
- Stack-size + comp-champion tags on each analysed game, plus per-row "in this comp" indicators (`63b9866`, `3dfa326`).

## Team-game detection rules (final state)

- A game counts as a team game when 4+ of the roster are on the same team (`teamMin = 4`), so a rotating 6-player squad's games register even with a sub. Subbed games carry `rosterCount < 5` and show a "w/ sub" flag (`32bb715`, `64e4fa4`).
- Queues scanned: Flex (440) + Clash (700) only, Flex first (see bug fixes below).
- Comp attribution uses champion overlap (default 3/5, tunable by the slider).

## Bug fixes

- Admin comp editor was wiping category/notes/game-plan/bans on save — now preserves existing fields (`e1a8689`).
- Corrupt match cache (the big one) — older code had cached some matches without player puuids, so the analysis couldn't identify who played them and silently dropped those games (stuck at 3 of ~143). Fix: the cache self-heals — any candidate match whose cached copy contains none of the roster gets re-fetched from Riot (`f9172ee`, `3d29488`). Diagnosed via temporary instrumentation (`62e74aa`, `a28c582`), since removed (`12c0287`).
- Rate-limited match-ID scan dropping recent games — scanning unused normal queues burned the rate limit before reaching Flex; reverted to Flex+Clash (Flex first) and increased match-id retries 3→6 (`ff766b3`, `7eafd36`, `cf37351`).

## Operational notes

- Frontend deploys automatically via GitHub Pages on push to `main`.
- Cloud Functions require a manual `firebase deploy --only functions` to take effect — a browser refresh does NOT update the backend. This tripped us up repeatedly.
- Riot API key lives in Secret Manager; updating the secret requires redeploying functions to bind the new version. Use a Personal key (doesn't expire), not a Development key (24h).
- Local dev: blank `apiKey` in `environment.ts` for offline/local mode — do not commit that change.
