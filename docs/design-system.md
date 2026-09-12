# Bom Squad design system

Written 12 Sep 2026, from a measurement of the app rather than from taste. Every number here was
counted in `frontend/src/styles.css` (16,788 lines, 3,875 rules) or read in the running browser.

This is the spec to build against. When something new is added to the app, it picks a role from
this document; it does not invent an eighty-second one.

---

## 1. The theme is ten palettes, not one

`body[data-theme="…"]`: **bomb, hextech, demacia, noxus, freljord, ionia, shadow-isles, shurima,
void, light.** Nine are dark; **light is the only pale one** and is where every contrast assumption
breaks.

Each theme redeclares the same **20 tokens**. That is the whole palette — there is nothing else.

| Token | What it is for | Uses |
|---|---|---|
| `--bg-0` `--bg-1` `--bg-2` | the page's three gradient stops; `--bg-1` is what colours mix *toward* | 85 |
| `--card` `--card-border` | card fill, and the universal 1px border | **371** |
| `--text-0` `--text-1` `--text-2` | reads · supports · labels — a three-rung ladder | **584** |
| `--accent` `--accent-2` | interactive: focus rings, active states, badges | **493** |
| `--ok` `--warn` | won / lost, good / bad | **574** |
| `--surface-nav` `--surface-hero-a/b` `--surface-controls` `--surface-btn` | the grounds things sit on | 169 |
| `--glow-a` `--glow-b` `--shadow-elev` | the body glow and the one shadow colour | 15 |

### The rule that matters most

> **A derived token goes on `body`, never on `:root`.**

The theme blocks are `body[data-theme=…]`. `:root` is `body`'s **parent**, so a custom property
declared there resolves against the *default* palette and is then frozen for all ten themes.

This is not theoretical. On 12 Sep 2026 `--surface-card: var(--bg-2)` sat on `:root` under a comment
claiming it "follows the active theme". Measured in the browser: under `noxus`, `--bg-2` was
`#2a181c` and `--surface-card` was still `rgb(35, 51, 69)` — the default blue, in every theme, for
every popover. It now sits in the `body { … }` block with `--bar-ok`, `--bar-warn`, `--bar-accent`
and `--text-2`, which is where derived tokens belong.

### The second rule

> **Never write a colour literal.** There were 80 of them on 74 lines. Four were the same orange
> focus ring (`rgba(255, 138, 61, 0.22)`) — the *default* theme's accent, wrong in the other nine —
> and one was an avatar badge gradient that matched no theme at all, not even bomb's gold.

### `--text-2` is a label colour and nothing else

It was used 23 times and **defined nowhere**, so 23 declarations meaning "quieter" rendered at full
body colour. It is now `color-mix(in oklab, var(--text-1) 85%, var(--bg-1))`.

Measured against `--bg-1` on all ten themes: **4.05 (light) to 6.49 (bomb)**. Every one of its
usages is a label, a count, a chevron or an empty-slot placeholder. **Do not reach for it for
anything a reader has to read.**

### Checking a colour decision

Do it in the browser, across themes, with a canvas — `getComputedStyle` returns `oklab(…)` strings
that a naive RGB parser will happily mis-measure (this cost a wrong answer on 12 Sep):

```js
const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const toRgb = (css) => { ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0,0,1,1);
  return [...ctx.getImageData(0,0,1,1).data].slice(0,3); };
```

---

## 2. Type and space: there is no scale, and that is the finding

- **908 `font-size` declarations, none in `px`** — 46 distinct static `rem` values plus 13
  `clamp()` expressions. There is no ramp; sizes were chosen one at a time.
- There is **no token** for spacing, radius, shadow, duration or z-index.

Until that is worth fixing, the de-facto ladder to copy from a neighbour rather than invent:

| Use | Value |
|---|---|
| body | `0.95rem` |
| secondary / meta | `0.88rem` |
| small print, chips | `0.78–0.82rem` |
| labels, counts | `0.68–0.74rem` |
| a headline that must carry | `clamp(1.05rem, 2.2vw, 1.3rem)`, `"Chakra Petch"` 700 |

Radius: `999px` for anything pill-shaped, `8–12px` for a box, `18px` for a card.
Fonts: `"Sora"` for controls, `"Chakra Petch"` for headlines, system for body.

---

## 3. Buttons: seven roles, eighty-one recipes

A census of every `<button>` and `<a>` found **81 declared visual recipes** across 225 class tokens.
**Seven of them are genuinely different roles. The rest is drift.**

Build with these seven. If a new control does not fit one, that is a reason to talk about it, not a
reason to write the eighty-second rule.

| # | Role | Class | Looks like |
|---|---|---|---|
| **R1** | Secondary action — the house pill | `.view-btn` | 999px, 1px accent-40% border, `--surface-btn`, `--text-0` |
| **R2** | Primary / emphasis | `.view-btn.active` | R1 plus the accent→accent-2 gradient |
| **R3** | One of N | `.view-segment` (and `.segment` inside a `.segmented`) | joined pills in a rounded group |
| **R4** | Icon-only ghost — delete, close, confirm | `.log-del` and friends | no border, colour on hover |
| **R5** | Menu item | `.overflow-item` | full-width row inside `app-overflow-menu` |
| **R6** | A surface that is a button — a row, a card, a tile | the surface's own class | no button chrome at all |
| **R7** | Help affordance — **not an action** | `.info-tip`, `.field-help`, `.tip-term` | `cursor: help`, never a pill |

### Standing rules

- **An action is a pill, never an underlined text link.** The lead has asked for this repeatedly.
  On 12 Sep, Prep's three replay actions (*unlink*, *delete replay*, *open on Games*) were underlined
  text four lines above a row of pills; they are now compact pills.
- **Every clickable thing owes a `:hover` and a `:focus-visible`.** The shared Starter | Full switch
  had neither until 12 Sep — the control that decides how much of four pages is drawn.
- **`.view-btn.active` carries two meanings** (this is *the* button emphasis, and this is *selected*).
  Prefer `.view-segment` when you mean "selected".
- One legitimate sub-theme: the **film room's** stock palette (`--film-ink`, `--film-line`,
  `--film-panel`). It needs these same seven roles retinted, not twenty extra `film-*` classes.

---

## 4. A panel is opened by its whole header

> **The whole header is the toggle. The chevron is the affordance, not the hit area.**

The lead, 12 Sep 2026: *"I like the panel that is clickable, not only just the button."*

Use `<details class="card fold-card">` + `<summary class="section-head">` + a `.fold-chevron`. The
shared recipe gives the pointer cursor, kills the native marker, rotates the chevron on `[open]`
and draws a real focus ring. Measured after the conversion: the Games Players header is a
**606 × 36px** target where it was a 90px pill.

Two details that are easy to get wrong:

- A control that must live **inside** the header needs `$event.preventDefault()` **and**
  `$event.stopPropagation()` — stopping propagation alone is not enough inside a `<summary>`.
- A `<details>` keeps its body in the DOM when shut. If the body is expensive, keep an `@if` guard
  inside it: the header does the toggling, the guard does the rendering.

A whole-header `<button>` wrapping the row is equally fine — Player Intel and Admin › Players do
that and always complied.

---

## 5. How much to draw: Starter and Full

> **Does a reader act on it, or check it?** Act → Starter. Check → Full.

- One shared control, `shared/detail-toggle.component.ts`, on `games`, `reviews`, `patterns`, `prep`.
- Stored per **person** in `UserPrefs.depth`; **absent means Starter**, and going back to Starter
  deletes the key rather than storing the default a second way.
- Which games you were last *looking at* is per **browser** (`bom-patterns-filters`, `bom-*`) —
  that is a place in the page, not a preference about yourself.
- **A hidden control must not keep working in silence.** The Patterns filters are restored whether
  or not they are drawn, so at Starter a reader could be told *"7 left out by the filters"* with no
  filter on screen. The sentence that reports it is now the way to them.
- Roster, Comps and Player Intel still have their own Starter | Full signals from 8 Sep. Point them
  here when convenient. **Do not invent a second vocabulary for the same idea.**

---

## 6. Words, tips and meaning

- Explanatory prose stays on the page only when it tells a reader what would fill an empty space.
  A definition someone wants once goes in an `app-info-tip` or a `.tip-term`.
- **A figure carries its unit.** A column of `+143` says nothing; `+143 gold/min` does.
- **A colour that carries meaning owes a legend.** One scale per quantity, everywhere: a win rate is
  `rateBand` (≥65 / >50 / =50 / <50) on every surface, never a second hand-coded 55/45.
- **An average says what it averaged.** "Series MVP" over one game of three now reads `2 of 3`.
- A tour step must be able to *show* what it describes. If the thing lives in Full, the step raises
  the depth and the tour puts it back (`before: 'showFullPatterns'`, `depthBefore` in
  `tour.service.ts`). Bump a tour's `version` to show it once more to everyone.

---

## 7. Before you add anything

1. Which of the **seven button roles** is it? If none, stop and ask.
2. Does it collapse? Then its **whole header** toggles.
3. **Act or check** — Starter or Full?
4. Does it carry a number? Give it a **unit**. A colour? Give it a **legend**.
5. Does it hide something that keeps working? Then **say so on the page**.
6. Any colour must be a **token**, and any derived token goes on **`body`**.
7. Check it in the browser, in the **light** theme as well as a dark one.
