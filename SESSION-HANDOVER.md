# Bom Squad Draft Hub — session handover (30 Aug 2026)

Paste this into a new session for context. Everything below is committed,
pushed and live at https://skilleddev96.github.io/League-team-comp/

**State:** working tree clean, `main` at `d6a923c`, **232 frontend tests + 155 api
tests** passing, both builds clean. Deployed backend reports `c0e1b69` and `api/`
has not changed since — the e2e drift check passes.

---

## What shipped this session (19 commits)

### The live draft room — the bulk of the work

`/tournaments` → **Draft** is now a real draft screen rather than a form.

- **Full-bleed three-column stage**: our picks left, the champion wall centre,
  theirs right; a ten-card ban strip beneath, **five a side**.
- **The competitive sequence**, as data in
  `frontend/src/app/pages/tournaments/draft-sequence.ts` — 3 bans each, 6 picks,
  2 bans each, 4 picks. Choose a side and the board becomes twenty steps with
  one legal move each.
- **Confirm-to-commit**: a champion is *held*, you see which seat it will take,
  then confirm. Confirming advances the step and restarts a **30-second clock**.
- **Seats auto-assign from real lane data** — the pick goes to the lane the
  champion is actually played in, falling back to the first free seat.
- **Lane filter** on the wall (All / Top / Jungle / Mid / ADC / Support),
  replacing Riot's class tags.
- **Splash-art cards** for picks and bans, with a landing animation.
- **Undo** (steps back one) and **Reset** (wipes the game, confirmed first).
- Opens in edit mode and scrolls straight to the stage.

### Champion lane data — new, and load-bearing

Riot's tags are **classes, not lanes**. Data Dragon and CommunityDragon have no
position data at all. So `scripts/gen-champion-lanes.mjs` derives a map from an
Oracle's Elixir export (80,710 pro player-rows → 172 champions) into
`frontend/src/app/data/champion-lanes.ts`, read via `core/champion-lanes.ts`.

The 64 MB CSV is **not** committed — re-download from
oracleselixir.com/tools/downloads and re-run the script to refresh.

### Elsewhere

- **Interface scales with the monitor** — root font `clamp()`; laptops
  unchanged, 31% larger at 2560px. Every `font-size` was already rem.
- **Softened progress-bar fills**, and **Hextech is now the default theme**.
- **Comp view mode reads as blocks**, matching the editor, keeping summoner
  names.
- **Riot attribution notice** on every page — the last compliance item.
- **Fixed: Fiddlesticks lost its comp identity label.** CommunityDragon spells
  it `FiddleSticks`, Data Dragon `Fiddlesticks`; the case-sensitive join dropped
  it, and one missing champion hid the label for the whole comp.
- **Fixed: 63 `Jade_*` variants** were being fetched and stored on every traits
  sync. `syncChampionTraits` now returns **173**, not 236.

---

## The one thing next

**Raise the 12-game enrichment sample.** `enrichPlayer` reads only 12 matches
(`api/src/index.ts`, `matchIds.slice(0, 12)`) because each is a Riot call and six
players × 12 already nears the 100-per-2-minutes ceiling.

The fix is designed but not built: **read the shared `matchCache/{matchId}`
before calling Riot.** It already holds 159 matches for the comp analysis, so a
30–50 game sample is free for anything cached.

It needs:
- two fields the cache does not store yet — `visionScore`,
  `damageDealtToBuildings`
- `CACHE_VERSION` → 4
- therefore a **backfill window** where those two are absent on some matches,
  which the UI must state rather than render as zero
- `npm run deploy:functions`

---

## Open, deliberately

- **"Pick order"** (pick five, assign lanes after) is probably unnecessary now —
  the sequence already picks in draft order, proposes the seat, and the ⇅ on
  each seat reassigns. Draft a real game before deciding.
- **Do not build a champion-suggestion engine.** DraftGap does it from ~5.9M
  matches/30 days; nothing here can match that, and consuming their data is
  prohibited the same way scraping is.
- Longer-standing parked items are unchanged: second Firebase project for write
  coverage, firebase-admin 13→14, `Player.top3` naming, bundle size.

---

## Things worth not rediscovering

- **Nothing on the draft screen may change layout height.** Three separate
  causes of the page jumping were found and fixed — the wall had a `max-height`
  so filtering shrank it, the champion-count line only rendered when filtered,
  and the confirm row appeared conditionally. All now occupy fixed space.
  Verified by measuring one element across every filter and state: **maxShift
  0**.
- **Free-form controls must stand down during a sequence.** The seat ×, ban ×,
  Clear all and the ban typeahead all edit the board without moving
  `draftStep` — that is how a draft reached the second ban phase showing five
  picks instead of six.
- **Splash art, not loading art**, for wide cards. Loading art is 308×560
  portrait; in a 2:1 card it crops three quarters away and upscales the rest.
- **The pick clock is a reminder, not a referee.** The real clock is in the
  client.
- **No tool anywhere handles fearless series burn** — ProComps, DraftGap,
  DraftForge and drafter.lol were all checked. That is why this app keeps its
  draft room.
