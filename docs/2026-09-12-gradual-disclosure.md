# The gradual-disclosure batch — every bug and every decision

12 Sep 2026. The record of one day's work, so the reasoning survives outside the chat.

**The lead's complaint:** *"I've got a lot of complaints from too much information to read. Maybe we
need to look at something to introduce all the information gradually."*

**Who complained — corrected 12 Sep 2026.** This was written up as though it came from viewers, and
the lead put that right: *"it was the contributors as well."* That is not a wording fix. It means the
editing surfaces are in scope for the same treatment, and the three tours that were editor-only were
not the whole of the problem — the contributors could see those tours and still found the pages too
much. **Edit mode has had no depth pass at all**, and on Prep it deliberately draws the full roster
table. That is the next thing to look at, not a settled decision.

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
| All three Prep & Draft tours were editor-only, every step behind edit mode | Nobody who only reads the page had ever been shown it. |

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

## Part 3 — the afternoon: what the lead found by using it

Everything above was designed. This half came from the lead walking the built thing, and it is the
more useful half.

| Reported | What it actually was |
|---|---|
| "the starter view looks a bit odd at the prep" | The compact roster's name column was `minmax(8rem, 1fr)`, which on a wide desktop swallowed every spare pixel and stranded the rank and champions at the far edge. Fine at my pane width, which is why I missed it. |
| "this looks odd… just to the right side?" | `margin-left: auto` sat on `.detail-toggle`, the div INSIDE the component. The flex child is the `app-detail-toggle` element. The same mistake I had already made once on the section divider. |
| "it looks clumped" | The roster's control row was six things at the left with the row empty to the right, and the filter's answer sat against the card's outside edge. |
| "keep it short… add info button if more info is needed" | 101 tour steps averaging **25 words**, 98 of them over 12. Now **mean 10, longest 14**, with the rest behind an ⓘ on the card. |
| "remove the watch this first… redundant unless looking for it" | Every review is unwatched until somebody watches it, so that rung of Next up fired for nearly everyone nearly always. The card stopped carrying news. |
| "make the players section collapsed rather than hidden" | A section that is not there cannot be found. Collapse, don't hide — now a rule in the design system. |
| "the series MVP relates to the last game" | `seriesMvpOf` was correct. It was averaging **one** game, because a tournament game only carries figures once its replay is imported, and nothing on screen said so. The chip now reads `1 of 3`. |
| "I don't see a which side we were on" | My diagnosis was wrong — the side WAS set. Four different causes for a game carrying no figures all looked identical, which is to say they looked like nothing. Each game now carries a "no figures" mark that names which. |
| "the open games link does not take me to the specific game" | Mine, from that morning. Pinning a linked game instead of widening the window left the reveal effect asking `rows()` — the window — whether the row existed. A pinned game is the one row in the list and not in the window. |
| "it was the contributors as well" | Not a wording fix. The editing surfaces are in scope for the same act-or-check pass and have not had one. |

### Two corrections I had to make to myself

- **A regression test that passed against the bug.** My first spec for the pinned-row fix asserted
  that `focus()` resolved, not that the row opened — so it passed either way. Rewritten to assert
  the `<details>` is open, then the fix was reverted to watch it fail.
- **A spec substitution that silently stopped testing.** Replacing `dueReminder(x)` with
  `dueReminders(x)` left assertions reading `?.matchId` off an **array** — undefined, and
  `toBeUndefined()` passing for the wrong reason. It needed `[0]`.

---

## Part 4 — maintenance, and three bugs in the pipeline itself

Six finders over the repo, every removal candidate then handed to an adversarial verifier. 15 of 24
survived. **1,207 lines of CSS** (191 rules, ~7% of the stylesheet) and one orphaned util with five
dead functions went.

**The near-miss:** the first CSS pass would have deleted **25 live styles**. `is-minion`,
`prio-high`, `stock-blueprint` and the rest are never written literally — they are assembled as
`'is-' + kind`. Enumerating all 67 construction sites fixed it, and the check that caught it now
runs as an assertion.

Then three bugs that had nothing to do with dead code:

1. **The e2e check I broke that morning.** Moving the Game list fold onto the `<summary>` meant the
   suite's `fold.click()` shut the list its next assertion required to be visible. Proven by running
   the old test against the live site.
2. **`verify` could be testing the previous build.** It starts the moment `deploy` returns; Pages
   propagates on its own clock. Two deploys went green while checking the old site — which is how (1)
   reached main twice. The site now publishes `build.json` and a check waits for it to match the
   commit.
3. **`API_SHA` was lying in every deployed build**, found by reading that new stamp: it said
   `api: ac9e0c4` for a CSS-only commit. In a shallow clone the root commit has no parent, so git
   treats every path as changed in it and `git log -1 -- api` returns HEAD. The Admin page's
   backend-drift warning had therefore been firing after **every frontend-only deploy** — the exact
   false alarm its own comment says the design avoids.

**And one that made all of this findable:** `auth.setup.ts` accepted the service account only as
inline JSON, the way CI holds it, not as a path, the way a developer's machine holds it. So the
authenticated half of the suite — the half most likely to be broken by a change to the app — could
only ever be run by CI. It runs locally now, which is how (1) was caught at all.

---

## Part 5 — Roster, Comps and the draft room's comp finder (evening)

The lead: *"take the same designer approach … and apply it to the Roster and Comps pages … same clean
up."* Then, asked what Full should mean and what was wrong in the draft room: *"one switch all four
mode"*, *"we are not using those tools"*, *"defer stats, fix depth now"*, and three complaints about
the board — *"can't see which comps have a champion"*, *"the board is too far down the page"*, *"too
many comps to scan"*.

### The two pages failed in opposite directions

Roster was front-loaded: four views, two unrelated Starter | Full switches (Cards and Scouting, neither
remembered) and none at all on the Scout report. Comps opened calm — three controls, no figures — and
the weight was inside one panel. Copying the Games fix onto both would have been wrong for one of them.

Measured on the same seeded data, before → after:

| | before | after |
|---|---|---|
| Scout report | 370 marks, 190 figures | **111, 45** at Starter |
| Scouting, first screen | its own switch, fill-ins, a shut practice board | 35 marks, the board open |
| Table | 7 columns | **4** at Starter |
| Comps, a reader's open panel (8 results) | 80 marks, 16 figures | **52, 5** |
| Comps, an editor with every panel shut | 7 boards and 7 walls built, hidden | **0** |
| Comps, an editor's open finished comp | ~414 marks (173 champions) | **56**, and Change picks |
| Comps, editor at Full | 7 walls, ~1,200 tiles | **0** |
| Draft board, editor at 1920 | sixth row, lists stacked | **11px under the wall** |

### Decisions

- **One preference, `UserPrefs.depth.roster`, for all four views**, and `comps` for Comps. Every
  Starter | Full in the app now reads `UserPrefs.depth`.
- **Full on Cards opens every Quick look.** It used to draw Team Identity, a static Quick Access card
  and the resource links. Nothing in the app edits either; both are the seed. They left the page, not
  the data — the overview page the lead wants is where team identity can come back, as stats.
- **A comp panel builds only while open**, and **the board's wall is summoned** by pressing a seat.
- **The finder goes straight under the wall, and the advice moves down one fixed box.** The advice was
  moved under the wall on purpose once; the lead's complaint outranks that, and a fixed-height box
  means it now sits a known 458px lower at 1920 and never moves while somebody searches.
- **The editor `draft` tour keeps version 1** even though it gained a step: it auto-starts, and a tour
  opening over a live draft is the worst moment this app has. `draft-watch` never auto-starts, so its
  version means nothing either way — a spec pins both.

### Bugs found on the way

1. **A green run that exited 1.** `games.component.ts` called `scrollIntoView` in a timer; jsdom has
   none, and the pinned-row spec added this morning let the timer fire after its test ended. 1150 of
   1150 passed and the suite failed. Now an optional call, as Comps already did.
2. **Cards' switch said Full added fill-ins** in its tooltip, its doc comment and its tour step. The
   fill-ins were always drawn.
3. **The profile's champion overflow `<select>` bound `[value]` ahead of its options** — the same bug
   the Patterns comp filter had this morning.
4. **Every Comps tour step could land on a different comp**, because each card carried the same
   anchors and the tour took the first in the page. One comp now carries them.
5. **Two tour actions pointed at nothing**: `openCompMore` looked for a `details.comp-more` that no
   longer existed. Removed.
6. **The draft stage placed the old board by descendant selectors.** Moving the board inside a new
   section would have dragged those rules in with it and opened empty rows inside the finder. Found
   by reading the cascade before measuring, then confirmed by the overlap check.
7. **Four hand-coded win-rate scales** (the Scout report ban board at 55/45, Comps' badge and match
   history at 50, the Table's recent form at 50, the draft board at 50) now go through `rateBand` or
   the new `bandOf`.

### Corrections to my own plan

The measuring agents misread three things, and building on them would have produced the wrong page:
Cards' Full held no "per-queue sample lines", Scouting had no "matchup tables", and the Comps tour's
first step does not create a blank comp. The audit's "no visible focus on roster cards" was also
overstated — a real Tab showed the browser's default ring; what was missing was the theme's ring and
the card's lift. Each was checked in the code or the running app before anything was built on it.

---

## Part 6 — the lead's look at the evening pass (late)

The lead: *"I do not see a lot of changes to the comps and roster pages?"* Fair: most of Part 5 lived
in Full, inside opened panels, on the Scout report and in edit mode, and the Starter views a person
lands on looked nearly the same. What the lead asked for next, and what shipped:

- **The draft room back as it was, the comps in a popup.** *"I would like the advisor back … return
  the view back as it was … remove the comps from the actual draft, make it a popup."* Part 5's finder
  (042cb0c) was reverted exactly, so the table row, the decision and bugs 6 and 7 above describing it no
  longer hold. The board sits unchanged in a native `<dialog>` from a Comps pill. Measured against the
  room before either change, the head, wall, advice and bans are on the same pixel at 1920.
- **One toolbar on every page**, copied from Games: views as pills on the left, Detail on the right.
- **Roster cards** on one left edge with the 2nd seat as quiet pills; **every champion pool folds**.
- **The Scout report's lines**, which spread three columns hundreds of pixels apart: rows 95 → 48px
  apart, columns sized to their content, op.gg as a pill instead of an underlined name. Prep shares it.

### Found by an adversarial review of those commits (12 confirmed, 6 refuted)

1. Escape in the popup during a tour skipped the whole tour, marked it seen, and cancelled the key so
   the dialog never closed. The tour overlay now leaves keys to an open modal.
2. A chip clicked with a seat still aimed replaced a confirmed pick at once, behind a hint saying
   "hold". The popup now always holds, says whose ban or pick, and aims the wall at the comp's seat.
3. **Mid-sequence the old board wrote picks into seats without moving the step** — the free-form edit
   the room forbids. It was always there; the popup made it one click. It holds now.
4. Map view between 1101 and 1399px drew the wall over the advice. Part 5's finder had hidden it; the
   revert brought it back. Fixed, measured at 1280.
5. Prep's Detail switch, hidden rather than removed on Draft, pushed the whole room 35px down.
6. The popup's rates were back on a hand-coded 50; they use the room's own bands beside the advice.
7. Smaller: the Sub badge's tip sat under the card's link; a name could shrink to nothing on a narrow
   line; a visited op.gg pill turned link-blue (a redundant `a:visited` rule outranked the pill).

---

## What is still owed

- Walking the live site **as a viewer and as a contributor**. Both complained.
- **The team-stats overview page** — what we do well and badly — deferred by the lead to its own plan.
- Edit mode on Games, Patterns, Prep and Admin has had no act-or-check pass.
- The type and spacing scales do not exist as tokens — see `docs/design-system.md` §2.
- ~74 of the 81 button recipes are drift that could collapse into the seven roles.
- "What we expect" on the Comps editor tour could not be walked locally: Data Dragon is blocked in the
  sandbox, so no comp has traits. It should land on the live site; check it there.
- Three of the five pill-only collapse panels are converted; Player Intel and Admin › Players still
  use a chevron button.
- Synergy (`/synergy`, linked from nowhere) still uses its own toolbar and segmented control.
- Picking a comp's champion from the draft popup in a live draft: check the hold lands in the comp's
  seat, on the live site, in edit mode.
