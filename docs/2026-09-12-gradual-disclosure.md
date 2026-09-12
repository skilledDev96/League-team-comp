# The gradual-disclosure batch — every bug and every decision

12 Sep 2026. The record of one day's work, so the reasoning survives outside the chat.

**The lead's complaint:** *"I've got a lot of complaints from too much information to read. Maybe we
need to look at something to introduce all the information gradually."*

**Scope:** `/games` (Games, Patterns, Reviews), `/tournaments` (Plan and the Draft room).

**Measured before designing.** 181 games over nine months, 11 from the last week, 11 with a review.
Games: 23 controls and ~85 figures before a single row. Patterns: 29 controls and ~70 figures before
anything opened. Prep & Draft: ~300 figures a scouting panel, and 3,246 words of template prose
against 70 in tooltips — 46 : 1.

**Shipped:** 19 commits from `restore-2026-09-12-review-panel`.

---

## Part 1 — bugs fixed

Grouped by how they failed, because that is what makes the next one recognisable.

### Things that silently did nothing

| Bug | Cause |
|---|---|
| Comp `<select>` showed "All comps" while filtering on Pick | Bound `[value]` on the `<select>`; the comps arrive *after* it does, so a value set against an empty list falls back to the first option while the signal keeps the real one. Bind `[selected]` per option. |
| `--text-2` used 23 times, **defined nowhere** | 23 declarations meaning "quieter" resolved to nothing and inherited the body text. Measured under two themes before the fix: both rendered at `--text-0`. |
| `--surface-card` identical in all ten themes | Declared on `:root`, whose `--bg-2` is the default one — the exact mistake a comment 500 lines below it warns about. Measured: under `noxus`, `--bg-2` `#2a181c`, `--surface-card` still `rgb(35,51,69)`. |
| `TournamentSeries.status` is only ever written as `'scheduled'` | Any rule reading it would have done nothing. "What's next" is read from the games instead. |
| Three Patterns tour steps skipped in silence | Their anchors live inside `@if (full())`, and a missing anchor skips a step without a word. |
| Patterns filters kept filtering while invisible | Restored from `bom-patterns-filters` whether or not they are drawn, so Starter could say "7 left out by the filters" with no filter on screen. |
| `noFactorLine`'s ternary returned the same sentence from both branches | — |

### Things that were true once

| Bug | Cause |
|---|---|
| Three surfaces sent people to the **Analysis page**, retired 8 Sep | Prep's games list, the Comps match-history tip, the Diagnostics tab. |
| Five tour steps described an app that had changed | Roster's "three depths" (four since Scout report), quick actions and the user menu naming editor-only controls to viewers, "the menu here" for a menu that does not exist, and the film's seat tiles naming a strip deleted the same day. |
| Three CLAUDE.md descriptions had stopped being true | — |
| `shared/replay-frames.component.ts` was dead code referenced only by its own spec | — |
| Half of `ReviewComponent` was unreachable — including a second path into a Riot spend | — |

### Things that disagreed with each other

| Bug | Cause |
|---|---|
| The same win rate coloured on two scales inches apart on Prep | The ban board and the team's picks used 55/45; the roster table used `rateBand`'s 65/50. |
| Two Patterns rules emitted the headline "Vision drops in losses" | One reads vision score per minute, the other over the whole game. Worded apart, and deduped by topic. |
| Series MVP looked like the last game's | It was not wrong — it was averaging one game, because a tournament game only carries figures once its replay is imported, and nothing said so. |

### Things that said nothing

| Bug | Cause |
|---|---|
| Patterns evidence printed bare — a column of `+143` | The unit had no home in the type. `Advice.evidenceLabel` added. |
| Nineteen team-table rows carried a label and no definition | `METRIC_TIPS`, on a dotted-underlined label rather than nineteen icons. |
| Six column headers drawn over an empty roster | Reads as a broken table rather than an empty one. |
| "Who swung it most" existed since 11 Sep with exactly one reader | The last chapter of the film room, several clicks in. |
| No per-game MVP anywhere in a Prep series | The series mark had nothing to be checked against. |

### Things that were in the wrong place

| Bug | Cause |
|---|---|
| The tab named **Reviews** did not show a review | It drew poster cards. |
| The review sat **fifth** in an open game row | Below a scoreboard, a note and five buttons — the thing the whole app builds toward. |
| `?match=` opened nine months of games to reveal one row | `days.set(0)`. It now pins the row instead. |
| Thirteen Patterns filters reset on every visit | In-memory only. |
| `UserPrefsService.load()` set the signal only after awaiting Firestore | Every reader drew its default and flipped. |
| The Games tab folded away its own list to keep its header | — |
| All three Prep & Draft tours were editor-only, every step behind edit mode | The viewers doing the complaining had never been shown the page. |

---

## Part 2 — decisions, and why

### The rule everything else follows

> **Does a reader act on it, or check it?** Act → Starter. Check → Full.

It produced every table in the plan, and it is the test for anything added later.

### On depth

- **An absent preference means Starter**, so no stored document changed shape, and going back to
  Starter *deletes* the key rather than storing the default a second way.
- **Reading depth is per person** (Firestore); **which games you were looking at is per browser**
  (`bom-*`). A reading preference follows the reader; a place in the page does not.
- **Each surface remembers its own.** The **draft room is deliberately not a depth surface**: a
  switch whose two states differ in height is the one thing `CLAUDE.md:195` forbids.
- **Edit mode always draws the full roster table on Prep** — every scouting control lives in its
  cells, so a compact line in edit mode is a page with the work taken out of it.
- **A hidden control must not keep working in silence.**

### On the card at the top of Games

- **One card, never two.** Next up absorbed Before you play; two cards at the top is the complaint
  restated.
- **At most three lines, and nothing at all when there is nothing.** A team that is up to date gets
  an empty top of page, not a card congratulating them.
- **Fourteen days.** 181 games are all "unwatched" the day someone signs in; without a window the
  card is about February and stays there.
- **An unwatched review is not a rung** (added, then removed the same day on the lead's judgement):
  every review is unwatched until someone watches it, so it fired for nearly everyone nearly always.
  That prompt moved to the game's own row, where the Reviewed chip opens the film.
- **Scrim groups are left out of "the next opponent"** — a standing list of teams, not a schedule.

### On honesty

- **Pin a linked game; do not widen the window.** A pinned game never changes the record — which is
  the whole reason to pin.
- **Stored values fall back one field at a time**, never as a whole selection; a hand-picked five
  with nobody in it drops back to the A team.
- **The stored series order is left alone**, even when finished rounds sit at the top. It is the
  order someone typed the schedule in.
- **An average says what it averaged over.**
- **A figure carries its unit; a colour that means something carries a legend.**

### On the draft room and tours

- **A tour never opens itself over a live draft** — `draft-watch` carries `autoStart: false`.
- **Tour anchors in the draft room are attributes only**, and the layout was measured, not assumed:
  `.draft-head` is 166px at the same offset before and after a tour starts.
- **A tour must be able to show what it describes.** Where a step is about something only Full
  draws, it raises the depth and the tour puts it back — the same thing it already did for edit mode.
- **A version bump is how a tour runs again**; a wording fix is not worth interrupting anyone for.

### Two deliberate non-changes

- **Editor actions were not moved into an overflow menu**, though the plan proposed it: four tour
  steps anchor on those buttons.
- **`killParticipation` is absent from a replay-sourced MVP line and present on a Riot-sourced one.**
  This looks like a scoring bug and is not: `ScrimPlayer` has no such field to map. Six findings
  from the audit came back refuted as deliberate, this among them.

---

## What is still owed

- Walking the live site **as a viewer**. That is the audience that complained.
- Roster, Comps and Player Intel keep their own Starter | Full signals from 8 Sep; one rename commit
  across seven surfaces would point them at the shared, remembered one.
- The type and spacing scales do not exist as tokens — see `docs/design-system.md` §2.
- ~74 of the 81 button recipes are drift that could collapse into the seven roles.
