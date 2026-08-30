# Bom Squad Draft Hub — handover

Written 30 Aug 2026. Paste into a new session for context.

Covers **51 commits, 27–30 Aug 2026**, which is one continuous stretch of work
that added the Review page, the analysis truth-layer, the Roster merge, the comp
board and identity, and the live draft room.

**State:** `main` at `c33867c`, working tree clean, **232 frontend + 155 api
tests** passing, both builds clean. Live at
https://skilleddev96.github.io/League-team-comp/ — deployed backend reports
`c0e1b69`, `api/` unchanged since, so the e2e drift check passes.

---

## What was built

### 1. The Review page — why games went the way they did

New page (`pages/review/`) reading the same analysis payload as `/analysis` but
answering a different question, which is why it is separate rather than a panel.

- **Wins and losses are mirrors.** `api/src/objectives.ts` holds `describeWin`
  and `describeLoss` on shared thresholds, and the page counts both through one
  `summarise` so they cannot drift.
- **`api/src/fights.ts`** adds a kill tally, which is what separates a game lost
  *in the fights* from one lost *on the map* — two losses that read identically
  without it and need opposite work. Costs no Riot calls: every participant is
  already cached.
- Losses group under their comp rather than listing every game.

### 2. The analysis truth-layer

The bugs here were the expensive kind — things that looked like they worked.

- **`CACHE_VERSION` bumps were silently doing nothing.** `isCacheUsable` trusted
  any structurally-complete entry, so unversioned matches were never re-fetched.
  Split into two questions: **`isCacheCurrent`** (has today's fields — only the
  current stamp counts) and **`isCacheUsable`** (sound enough to serve when the
  fetch budget is spent). The existing test had passed for the wrong reason.
- **Comp attribution is applied twice, and both are needed.**
  `api/src/comp-attribution.ts` resolves `Comp.countsUnder` and
  `compOverrides/{matchId}`; `core/comp-alias.ts` repeats it in the browser,
  because the Analysis page re-derives comp membership on every render and
  ignores `game.compId`. Wiring only the backend left overrides visibly doing
  nothing — which is exactly what shipped once. **Anything deciding which comp a
  game belongs to must go through `effectiveComp`.**
- **Champion pools were built from all-time mastery**, so a support showed an
  ADC list — and it poisoned Suggested Bans. Now built from recent play.
- **`enrichPlayer` and `getTeamSynergy` had no `timeoutSeconds`**, so ~40
  sequential Riot calls hit the 60s default. The CORS error was a symptom.
  Both now 300s.

### 3. Roster — three pages merged into one

`/roster` hosts Cards, Table and Scouting as modes of one page; they were three
nav entries answering the same question at different depths. `/overview`,
`/players` and `/profiles` still resolve — the e2e suite navigates to
`./players`.

### 4. The comp board and comp identity

- **`shared/comp-board.component.ts`** — build a comp by clicking: five role
  slots over a searchable champion grid, replacing five typeahead fields.
- **`core/comp-identity.ts`** — a comp reads itself back: damage split, and a
  poke/dive/teamfight/pick/split/protect label once all five are in.
- **`api/src/champion-traits.ts`** — damage type, attack range, CC, mobility and
  durability from CommunityDragon, synced weekly (`refreshChampionTraits`) or on
  demand (`syncChampionTraits`).
- Comp view mode reads as the same five blocks as the editor, keeping the
  summoner names the editor has no room for.

### 5. The live draft room — the largest single piece

`/tournaments` → **Draft** is a real draft screen. See CLAUDE.md for the rules;
in brief:

- Full-bleed three columns — our picks, the champion wall, theirs — with a
  ten-card ban strip beneath, five a side.
- **The competitive sequence as data** (`pages/tournaments/draft-sequence.ts`):
  3 bans each, 6 picks, 2 bans each, 4 picks. Twenty steps, one legal move each.
- **Held-then-confirmed picks**, a 30-second clock, Undo and Reset.
- **Seats move two ways** — click the role badge to lift then click a target, or
  drag one seat onto another. Both swap rather than overwrite.
- **Seats auto-assign from real lane data**, shown before you confirm.
- Splash-art cards, lane filter, opens in edit mode, scrolls straight to itself.

### 6. Champion lane data — the thing Riot cannot tell you

Riot's champion tags are **classes, not lanes**: Gragas is a Fighter in all three
of his, and "Support" is both a tag and a lane. Data Dragon and CommunityDragon
carry no position data at all.

`scripts/gen-champion-lanes.mjs` derives the map from an Oracle's Elixir export —
80,710 pro player-rows → 172 of 173 champions — into
`frontend/src/app/data/champion-lanes.ts`. The 64 MB CSV is deliberately not
committed.

### 7. Interface and compliance

- **The whole interface scales with the monitor.** Root font is a `clamp()`;
  laptops unchanged, ~31% larger at 2560px. Every `font-size` was already rem.
- **Hextech is the default theme**; progress-bar fills softened via
  `--bar-ok`/`--bar-warn`/`--bar-accent`, declared on `body` so they resolve per
  theme.
- **Riot attribution notice** on every page, including the public login page —
  required by Legal Jibber Jabber to use their art.
- Registered a **Personal API key**, ending the 24-hour expiry treadmill.

---

## The one thing next

**Raise the 12-game enrichment sample.** `enrichPlayer` reads only 12 matches
(`api/src/index.ts`, `matchIds.slice(0, 12)`) because each is a Riot call and six
players × 12 already nears the 100-per-2-minutes ceiling.

Designed, not built: **read the shared `matchCache/{matchId}` before calling
Riot.** It already holds 159 matches for the comp analysis, so a 30–50 game
sample is free for anything cached. Needs two fields the cache lacks
(`visionScore`, `damageDealtToBuildings`), `CACHE_VERSION` → 4, a **backfill
window** where those are absent on some matches — which the UI must say rather
than render as zero — and `npm run deploy:functions`.

---

## Open, deliberately

- **"Pick order"** (pick five, assign lanes after) is probably unnecessary: the
  sequence already picks in draft order, proposes the seat, and the ⇅ on each
  seat reassigns. Draft a real game before deciding.
- **Do not build a champion-suggestion engine.** DraftGap does it from ~5.9M
  matches per 30 days; nothing here can match that, and consuming their data is
  prohibited exactly as scraping is.
- **Fight statistics beyond the kill tally** ("good deaths / bad deaths") —
  scoped and parked.
- Longer-standing: second Firebase project for write coverage, firebase-admin
  13→14, `Player.top3` naming (it holds an uncapped pool now), bundle size.

---

## Things worth not rediscovering

**Riot API policy.** On a **Personal** key. Scraping "any other sources outside
the provided Riot API Endpoints" is prohibited with *indefinite revocation* —
that covers stat sites and DraftGap's public dataset buckets alike. Oracle's
Elixir is the exception: published deliberately for analysts. Custom games are
invisible to the API; tournament codes are the only route and Personal keys
cannot use them, so **scrims will never appear automatically**.

**The tool landscape.** ProComps, DraftGap, DraftForge, LoLDraftAI and
drafter.lol were all evaluated. **None handles fearless series burn** except
Draft Vision, which is a drafting board with no analysis. That is why this app
keeps its draft room. drafter.lol's API is completed-only with no turn, phase or
timer, so watching a draft live through it is impossible.

**Nothing on the draft screen may change layout height when its state changes.**
Three separate causes of the page jumping were found: the wall had a
`max-height` so filtering shrank it, the champion-count line only rendered when
filtered, and the confirm row appeared conditionally. Verify by measuring an
element's `top` across every filter and state — the target is maxShift 0.

**Free-form controls must stand down during a sequence.** The seat ×, ban ×,
Clear all and the ban typeahead all edit the board without moving `draftStep` —
that is how a draft reached the second ban phase showing five picks instead of
six.

**Two champion-name namespaces.** CommunityDragon aliases and Data Dragon ids
agree on 172 of 173 and disagree on Fiddlesticks (`FiddleSticks` vs
`Fiddlesticks`). Join them case-insensitively; a case-sensitive read dropped that
one champion and hid the identity label for its whole comp. CommunityDragon also
lists 63 `Jade_*` variants that are not Summoner's Rift champions —
`syncChampionTraits` should return **173**, not 236.

**Splash art, not loading art**, for wide cards: loading art is 308×560 portrait
and crops three quarters away in a 2:1 card.

**Never animate an element up from `opacity: 0` on this screen.** A
running-but-frozen animation holds its current value whatever the fill-mode
says, so a throttled tab shows an empty card. Animate transform only, so the
resting state is always the correct one.

**Verify UI in the running app.** A clean build is not evidence. Several bugs
this stretch — the inert cache version, the override that did nothing, the
silent duplicate bans, the page shift — all built and tested green.
