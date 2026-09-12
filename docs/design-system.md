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

The **draft room is deliberately not a depth surface**: a switch whose two states differ in height
is the one thing `CLAUDE.md` forbids there.

**Still unanswered:** edit mode has had no act-or-check pass at all, and the "too much information"
complaint came from contributors as well as viewers.

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
2. Does it use **tokens only** — no literal colour, no hand-coded threshold?
3. Does it have **hover and focus-visible**?
4. Act or check — does it belong at **Starter or Full**?
5. If it collapses, is the **whole header** the toggle?
6. If it is a new class, does it **redraw `.view-btn`**? Use `.view-btn`.
