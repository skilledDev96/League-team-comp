# Bom Squad — the design system

Written 12 Sep 2026, from a measured audit rather than taste. Everything here is a count from the
codebase or a contrast ratio read off the running app.

**The one-line summary:** the app has ten themes and nineteen tokens, and **81 different ways to
draw a button** where seven would do.

---

## 1. The theme is nineteen tokens, and there are ten of them

| | |
|---|---|
| Themes | `bomb` (default), `hextech`, `demacia`, `noxus`, `freljord`, `ionia`, `shadow-isles`, `shurima`, `void`, `light` |
| Tokens each redefines | **19** |
| Where | `body[data-theme="…"]` in `styles.css` |

```
--bg-0  --bg-1  --bg-2          the page, a panel, a raised surface
--card  --card-border           a card and its edge
--text-0  --text-1  --text-2    reads · supports · labels
--accent  --accent-2            the brand, and its second
--ok  --warn                    good, bad
--glow-a  --glow-b              the ambient wash
--surface-nav  --surface-hero-a  --surface-hero-b
--surface-controls  --surface-btn
--shadow-elev
```

### The rule that governs all of them

> **A derived token goes on `body`, never on `:root`.**

The theme blocks are `body[data-theme=…]`. `:root` is `body`'s *parent*, so a custom property
declared there resolves against the **default** palette and freezes — every theme gets the default
value. `styles.css` has carried a paragraph warning about this since the bar tokens shipped, and two
tokens still broke the rule until 12 Sep 2026:

- **`--text-2` was used 23 times and defined nowhere.** Twenty-three declarations meaning "quieter
  than the body text" resolved to nothing and inherited the body text instead. Measured under two
  themes before the fix: both rendered at `--text-0`.
- **`--surface-card` sat on `:root` as `var(--bg-2)`** with a comment claiming it followed the
  theme. It did not. Measured: under `noxus`, `--bg-2` is `#2a181c` and `--surface-card` was still
  `rgb(35, 51, 69)` — the default blue, in all ten themes.

Both now sit in the `body { }` block with the bar tokens.

### The text ladder

`--text-0` reads · `--text-1` supports · `--text-2` labels.

`--text-2` is derived, not picked: `color-mix(in oklab, var(--text-1) 85%, var(--bg-1))`, so it
follows every theme for free. Measured against `--bg-1` across all ten: **4.05 (light) to 6.49
(bomb)**. Every one of its twenty-three uses is a label, a count, a chevron or an empty-slot
placeholder. **Never use it for anything a reader has to read.**

### Colour that carries meaning

One scale, everywhere, from `rateBand()` in `core/opponent-view.ts`:

| Win rate | Class | Colour |
|---|---|---|
| ≥ 65% | `is-good` | `--ok` |
| > 50% | `is-ok` | `--ok` mixed toward `--text-1` |
| = 50% | `is-even` | `--text-1` |
| < 50% | `is-poor` | `--warn` |

Until 12 Sep the ban board and the team's picks used 55/45 while the roster table two inches below
used 65/50, so the same champion read green in one block and plain in the other. **Never hand-code
a threshold.**

### No hard-coded colours

Four focus rings carried `rgba(255, 138, 61, 0.22)` — the default theme's orange, wrong in the other
nine — and the avatar role badge was an orange gradient matching **no** theme (not `:root`'s blue,
not `bomb`'s gold). Both now use `--accent` / `--accent-2`.

The one place a literal is still right is where contrast demands it: the light theme is the only
pale theme, so `body[data-theme='light'] .avatar-role` deepens its own background and uses white
text — measured 3.17 → 6.82.

---

## 2. Seven button roles, not eighty-one

The census: **225 distinct class tokens sit on `<button>`/`<a>` elements; 81 of them declare their
own box.** Seven are genuinely different jobs. The rest is drift.

| | Role | Use |
|---|---|---|
| **R1** | `.view-btn` | the house pill — every ordinary action |
| **R2** | `.view-btn.active` | the one emphasised action in a group |
| **R3** | `.view-segment` | one-of-N choice |
| **R4** | icon-only ghost | delete, close, confirm — no text |
| **R5** | `.overflow-item` | a row in a menu |
| **R6** | chromeless surface | a whole row, card or tile that is clickable |
| **R7** | `.info-tip` · `.field-help` · `.tip-term` | help. **Not an action** — `cursor: help` |

**Reach for R1 first.** If you are about to write a new class that declares padding, radius, border
and background on something clickable, you are almost certainly drawing `.view-btn` again.

Known drift to collapse when you are next in the area: three parallel segmented-control systems
(two in the same toolbar), `.film-beat-chip` and `.film-strip-chip` byte-identical, and `.btn-cta`
which has no base rule at all — it only exists as `.edit-toolbar .btn-cta`.

The film room's stock palette (`--film-ink`, `--film-line`, `--film-panel`) is a **legitimate
sub-theme**, not drift. It needs those same seven roles retinted, not twenty more `film-*` classes.

### Every clickable thing owes the reader two states

`:hover` and `:focus-visible`. The shared Starter | Full switch — the control that decides how much
of four pages is drawn — had neither until 12 Sep 2026.

### An action is a pill, never an underlined link

Stated by the lead repeatedly. A link is for navigation; an action is a pill, even a small one.
Prep's `unlink` / `delete replay` / `open on Games` were underlined text four lines above a row of
pills; they are compact pills now. **Compact is the answer to "but it is only metadata" — not a
link.**

---

## 3. A collapsible panel's whole header is the toggle

> The chevron is the affordance, not the hit area.

The lead, 12 Sep 2026: *"I like the panel that is clickable, not only just the button."*

Use `<details class="card fold-card">` with `<summary class="section-head">` and a
`.fold-chevron`. Copy an existing one — do not write a fold button.

A control that must live *inside* a clickable header needs **`$event.preventDefault()` as well as
`$event.stopPropagation()`** — stopping propagation alone is not enough inside a `<summary>`.

**Inside a card**, a section folds the same way without a card of its own:
`<details class="intel-collapse fold-card">` with `<summary class="section-head intel-collapse-head">`
holding the `h3`, an `.intel-collapse-count` pill and a trailing `.fold-chevron`. A player's champion
pool uses it on the profile's Declared pool. Do not make a card's
whole face a link with buttons inside it: a clickable tile is one stretched button (§3½).

---

## 3½. One toolbar on every page

The lead, 12 Sep 2026: *"I like how the games top page looks, with the detail option on the right —
make this consistent across all pages."* Games' anatomy, copied everywhere:

```
<section class="hero"> h1, p, <app-tour-pill /> </section>
<section class="view-controls">            ← bare, straight under the hero, no card around it
  .view-btn pills: the page's views        ← left
  <div class="view-controls-tools">        ← page-wide tools: a count, the champion search, Add
  <app-detail-toggle surface="…" />         ← last, only on a depth surface
</section>
```

Roster's three views, Comps' categories, Prep's Plan | Draft, the profile's links and Admin's tabs are
all pills on the left. Something that belongs to one view goes in a row under the toolbar, not in it.
A control present on one view and not another is **removed**, not hidden: Prep's switch hidden on
Draft pushed the whole draft room 35px down.

**The slim toolbar is the default page header panel** (13 Sep 2026, the lead on Roster's: "I like the look of this
panel… a default for page header panels"). One row: the view pills, a compact search pill (a view pill's size, a short
placeholder, widening while focused or set, no count beside it — `app-champion-filter` `placeholder` and `showCount`),
and Starter | Full with its "Detail" word kept for screen readers only. Roster has it today, scoped under
`.roster .view-controls`; Comps takes it in its redesign, and the rules move to a shared default as each page adopts it.

**Home and Roster are the expressive pages** (13 Sep 2026; Roster joined when the lead asked to "keep the theme
of the home page rolling"). Home is a landing page with its own stage — a splash hero, a welcome band, a
gold-framed spotlight — and no toolbar. Roster keeps the one toolbar and the Starter | Full switch, and draws the
team as a poster of splash panels with a gold-framed player sheet. Both build from the **splash primitives** in
`styles.css` (`.splash-tile`, `.splash-art` + `.splash-shade`, `.role-pill`, `.splash-crown` / `.splash-chip`,
`app-rate-ring` / `.rate-ring`, `.form-pips`, `.gold-frame`), stay on the theme tokens, use `.view-btn` pills, and
animate behind one gate each: motion allowed, `.home` or `.roster` not `.is-still`, the section `.is-seen`
(`shared/in-view.directive.ts`), transform and opacity only. Every splash `<img>` carries `ui.artFallback`. A
clickable splash tile is one stretched button (the Roster panel's name), never a link overlay plus buttons. Do not
put a stage in place of a working page's toolbar.

**A restyle never reaches another page through a shared class.** Roster's old Scouting header shared
`.player-panel-header` with Admin › Players, and its Scout report shares every `.opp-*` class with Prep & Draft,
so the poster's look went in as new markup (`.report-banboard`, `.report-ban.splash-tile`) or as rules scoped under
the view's own root (`.player-intel-card …`, `.roster-report …`). Check the other page before and after.

**Facts on a card** are a two-column `<dl>` — labels in one column, values in the other, every icon the
height of a line — so every row starts at the same x. Secondary attributes, like a player's other roles, are small muted pills under the name on a line of their own, with a
label saying what they are: "Also plays" (13 Sep 2026; unlabelled beside a game count, the lead read them as part of it).

---

## 4. How much to show: act, or check?

> **Does a reader act on it, or check it?** Act → Starter. Check → Full.

`UserPrefs.depth` per surface; **absent means Starter**. Drawn by one shared control,
`shared/detail-toggle.component.ts`, which pushes itself to the right of its row — the flex child is
the `app-detail-toggle` element, so `margin-left: auto` belongs on *that*, not on the `.field`
inside it. (I made that mistake twice.)

Two rules learned the hard way:

- **Collapse, don't hide.** A section that is not there cannot be found. The Games Players card is
  collapsed at Starter, not removed.
- **A hidden control must not keep working in silence.** Patterns' filters persist and keep
  filtering whether or not they are drawn; at Starter that produced "*N left out by the filters*"
  with no filter on screen.

Three more, from Roster and Comps (12 Sep 2026):

- **One switch per page, not per mode.** Roster's three views share `roster`. A page with modes that
  each carried their own Starter | Full had three of them, none remembered, and none on the densest
  view.
- **A table a reader compares stays shut at Full** (13 Sep 2026, Roster's Players): Full adds the columns a reader
  checks, and rows open by click at both depths. Opening every row would push the rows apart, which defeats the
  comparison the extra columns are for, and build every row's pickers.
- **A compact search pill** is a view pill's size until it is used (Roster's toolbar): it widens while focused or set,
  and a count the page already says elsewhere is left off.
- **Build heavy content only while it is shown.** A shut `<details>` still renders its body. A
  panel holding a wall, a board or a long table gates its body on its open state — Comps built
  seven boards and seven 173-champion walls nobody could see.
- **A tool is summoned, not drawn.** A finished comp opens on its five seats; the champion wall
  comes back when a seat or Change picks is pressed. Same clicks, a tenth of the marks.

The **draft room is deliberately not a depth surface**: a switch whose two states differ in height
is the one thing `CLAUDE.md` forbids there. Anything there whose content can change size lives **off
the page** — the comps board is a native `<dialog>` in the top layer with a fixed height — and every
change is proven by measuring the tops of the head, the wall, the advice and the bans, never by eye.

**Still unanswered:** edit mode on Roster and Comps had its act-or-check pass on 12 Sep 2026; Games,
Patterns, Prep's editing controls and Admin have not, and the "too much information" complaint came
from contributors as well as viewers.

---

## 5. Words

- **A tour step is one line.** Twelve words target, fifteen hard cap. Anything a reader might want
  second goes behind the card's ⓘ (`TourStep.more`). Measured before the rewrite: 101 steps
  averaging 25 words, 98 over 12. After: mean 10, longest 14.
- **Explanatory prose stays on the page only when it tells a viewer what would fill an empty
  space.** A definition a reader wants once goes in `<app-info-tip>` or on a `.tip-term`.
- **Every figure says what it is.** A column of `+143` is not data. Nineteen team-table rows carried
  a label and no definition until `METRIC_TIPS`.
- **Say what a number was measured over.** "Series MVP" over one game of three now reads `1 of 3`,
  in the warning tint.

---

## 6. Before you add anything

1. Which of the **seven roles** is it? If none, say why in the comment.
2. Does it use **tokens only** — no literal colour, no hand-coded threshold? A win rate goes
   through `rateBand` (wins over games), or in the draft room its own `winRateBand`, never `>= 50`.
3. Does it have **hover and focus-visible**?
4. Act or check — does it belong at **Starter or Full**?
5. If it collapses, is the **whole header** the toggle?
6. If it is a new class, does it **redraw `.view-btn`**? Use `.view-btn`.
7. Is every size in **rem**, and does it fit a **94 x 47rem** window? Since 13 Sep 2026 the root is a 94th of the window, so every wide screen gets those rems; a px size stays small while its neighbours grow (a native button with no font-size is 13.33px forever), and an auto-fill grid measured against the old 82.5rem column may gain an empty track in the 85rem one.
