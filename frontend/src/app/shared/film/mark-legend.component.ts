import { Component, computed, effect, ElementRef, input, model, untracked, viewChild } from '@angular/core';
import { DEATH_READS, READ_LABELS } from '../../core/death-reads';
import { FilmGlyph } from '../../core/film-model';
import { REACH_SECONDS, SIGHT_UNITS } from '../../core/position-lab';
import { FilmGlyphComponent } from './film-glyph.component';

/**
 * What the surface beside the panel actually draws (11 Sep 2026, second fix
 * pass). The panel used to list every mark the film owns wherever it hung, so
 * the map chapter's panel named a ward, a dashed sight circle and six pit
 * glyphs that square never draws, and the lab's listed the pins, the dots, the
 * blobs and both heat washes it has none of. The lead asked for a legend "to
 * describe the icons used"; a host says which layers it has and gets those.
 */
export interface MarkSurface {
  /** Deaths of ours as pins, in the read's colour. */
  reads?: boolean;
  /** Deaths of theirs as dots, and the fight blobs. */
  theirs?: boolean;
  /** The objective glyphs at the pits and the towers. */
  objectives?: boolean;
  /** Our wards, each with its sight. */
  vision?: boolean;
  /** The vision heat's two washes. */
  heat?: boolean;
  /** The lab's own: the ghost, their reach, the three shades, the rings, and the plain death marks. */
  lab?: boolean;
}

/** One mark and the sentence that says what it means. */
export interface MarkRow {
  key: string;
  /** The classes on the row's mark cell; the film room block draws the pip, the dot, the blob, the wash. */
  mark: string;
  /** The film's own glyph inside the cell, where the mark is one. */
  glyph?: FilmGlyph;
  /** A family of glyphs in one cell (the objectives), so six pits do not become six rows saying the same thing. */
  glyphs?: FilmGlyph[];
  name: string;
  text: string;
}

export interface MarkSection {
  key: string;
  title: string;
  rows: MarkRow[];
}

/**
 * The four reads, straight off `READ_LABELS`, so the legend can never drift
 * from the words the map's own pills and badges use; the cell wears the
 * read's colour, which is the pin's colour on the Rift.
 */
export const READ_SECTION: MarkSection = {
  key: 'reads',
  title: 'How the film reads a death of ours',
  rows: DEATH_READS.map((r) => ({
    key: `read:${r}`,
    mark: `is-pip is-read-${r}`,
    glyph: READ_LABELS[r].icon,
    name: READ_LABELS[r].label,
    text: `${READ_LABELS[r].tip}.`
  }))
};

/** The pin of ours, listed wherever the reads are drawn. */
export const PIN_ROW: MarkRow = {
  key: 'pin',
  mark: 'is-pip is-ours',
  glyph: 'skull',
  name: 'A death of ours',
  text: "The champion who fell, where the timeline put it. On the map each is ringed in the read's colour, and tapping one reads that death out on the card beside the square."
};

/** Their dots and the fight blobs: one question, so they travel together. */
export const THEIRS_ROWS: MarkRow[] = [
  {
    key: 'dot',
    mark: 'is-dot',
    name: 'A death of theirs',
    text: 'A small grey dot: one of them fell here. Which of them, the timeline does not say, so the map never guesses. Under a seat filter the dots that stay are the kills that seat was in on.'
  },
  {
    key: 'blob',
    mark: 'is-blob',
    name: 'A fight',
    text: 'Where two or more fell inside the same minute, with the count either way in its tip. A blob is a fight and not a read, so a read filter takes it off.'
  }
];

/** The pits and the towers, drawn on the surfaces that carry the tape's events. */
export const OBJECTIVE_ROW: MarkRow = {
  key: 'objective',
  mark: 'is-obj',
  glyphs: ['dragon', 'baron', 'herald', 'grubs', 'atakhan', 'tower'],
  name: 'An objective',
  text: "The pit or the tower that fell, in the film's own glyph; ours draw in the win colour and theirs in the loss colour."
};

/** The ward and what it sees, on the surfaces that draw our vision. */
export const VISION_ROWS: MarkRow[] = [
  {
    key: 'ward',
    mark: 'is-ward',
    glyph: 'ward',
    name: 'A ward of ours',
    text: 'A trinket in the win colour, a control ward in the second accent, standing where the placer stood at the nearest minute, because a ward event carries no position of its own.'
  },
  {
    key: 'sight',
    mark: 'is-sight',
    name: 'What a ward sees',
    text: `The dashed circle around a ward is its sight, about ${SIGHT_UNITS} units, and it is as approximate as the spot it stands on.`
  }
];

/** The vision heat's two washes, listed only where that layer can be turned on. */
export const HEAT_ROWS: MarkRow[] = [
  {
    key: 'heat-ward',
    mark: 'is-heat is-ward-cell',
    name: 'Where our wards stood',
    text: "Vision heat's green wash: every ward of ours over the whole game, heavier the longer it stood."
  },
  {
    key: 'heat-death',
    mark: 'is-heat is-death-cell',
    name: 'Where we died',
    text: 'The red wash beside it, a patch at each death the map is showing; with the layer lit the dots of theirs and the fights come off, so the square is wards against deaths.'
  }
];

/**
 * The lab's own marks (Part C), asked for by a host with `lab: true`: its
 * plain death marks, the ghost, the reach, the shading and the rings. The
 * shade swatches are the lab's own `.lab-legend-swatch` classes, so the three
 * colours here are the three colours under the lab's map and cannot drift
 * from them.
 */
export const LAB_SECTION: MarkSection = {
  key: 'lab',
  title: 'In the lab',
  rows: [
    {
      key: 'lab-death',
      mark: 'is-pip is-ours',
      glyph: 'skull',
      name: 'A death of ours',
      text: 'The deaths the film has around this second, whose and when in the tip. They carry no read here: a read is the map\'s word on a death, and the lab is about the seconds before one.'
    },
    {
      key: 'ghost',
      mark: 'is-ghost',
      name: 'Where the minute put them',
      text: 'Drag one of ours and a faint ghost stays on the spot the frame put them, with a dotted line to where you moved them, so the difference stays visible.'
    },
    {
      key: 'reach',
      mark: 'is-reach',
      name: 'Their reach',
      text: `The dashed ring around each of theirs is what they could cover in ${REACH_SECONDS} seconds on foot, wider where their last minute says they moved faster. Nothing here knows cooldowns.`
    },
    { key: 'safe', mark: 'is-shade is-shade-safe', name: 'Safe', text: 'Inside our sight and outside their reach.' },
    { key: 'seen', mark: 'is-shade is-shade-seen', name: 'Seen', text: 'Inside our sight, but inside their reach too.' },
    { key: 'dark', mark: 'is-shade is-shade-dark', name: 'Dark', text: 'Inside their reach with nothing of ours watching it.' },
    {
      key: 'rings',
      mark: 'is-rings',
      name: 'The ten tokens',
      text: 'Ours ring in the accent and drag; theirs ring in the loss colour and stand where the minute put them, a champion in a seat and never a name.'
    }
  ]
};

/**
 * The sections this surface's own marks make. A section with no row on this
 * surface is not drawn at all, so the panel is always a description of the
 * square beside it and never of the film in general.
 */
export function marksFor(surface: MarkSurface): MarkSection[] {
  const out: MarkSection[] = [];
  if (surface.reads) out.push(READ_SECTION);
  const rift = [...(surface.reads ? [PIN_ROW] : []), ...(surface.theirs ? THEIRS_ROWS : []), ...(surface.objectives ? [OBJECTIVE_ROW] : [])];
  if (rift.length) out.push({ key: 'rift', title: 'On the Rift', rows: rift });
  const vision = [...(surface.vision ? VISION_ROWS : []), ...(surface.heat ? HEAT_ROWS : [])];
  if (vision.length) out.push({ key: 'vision', title: 'Vision', rows: vision });
  if (surface.lab) out.push(LAB_SECTION);
  return out;
}

/** Focus without caring where the page is scrolled, and without falling over in an environment that has none. */
function focus(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* no focus in this environment */
  }
}

/**
 * What the marks mean (11 Sep 2026; the lead, with the screenshots: "add a
 * legend to describe the icons used"). A pill beside the map's own legend
 * opens a panel over the side column — a panel and not a modal: nothing
 * behind it is blocked, nothing traps the focus, and the reader can leave
 * it open while they work the map. Every mark gets its own drawing and one
 * sentence — the four reads in their colours, a pin of ours against a dot of
 * theirs, the fight blob, the objective glyphs, the ward and its sight, the
 * heat's two washes, the lab's ghost, reach, shades and rings — and the host
 * says through `surface` which of them its own square draws, so the panel
 * never names a mark the reader cannot find beside it (second fix pass,
 * 11 Sep 2026).
 *
 * The marks are drawn, never described in words alone, and they are drawn
 * out of the same tokens the map paints with, so a theme change moves both
 * together. Escape closes it: the panel takes the focus when it opens, so
 * the press lands here and stops there rather than reaching the film page's
 * own Escape, which counts two in a row as "leave the film". A host that
 * closes it another way (the map chapter folds it on the page's Escape when
 * the focus is elsewhere) writes `open` back through the two-way binding.
 */
@Component({
  selector: 'app-mark-legend',
  imports: [FilmGlyphComponent],
  host: { class: 'mark-legend', '(keydown)': 'onKey($event)' },
  template: `
    <button
      #pill
      type="button"
      class="view-btn mark-legend-btn"
      [class.active]="open()"
      [attr.aria-pressed]="open()"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <span class="material-symbols-rounded" aria-hidden="true">help</span> What the marks mean
    </button>
    @if (open()) {
      <div #panel class="mark-legend-panel" tabindex="-1" role="group" aria-label="What the marks mean">
        <header class="mark-legend-head">
          <b>What the marks mean</b>
          <button type="button" class="view-btn" (click)="close()"><span class="material-symbols-rounded" aria-hidden="true">close</span> Close</button>
        </header>
        @for (s of sections(); track s.key) {
          <section class="mark-legend-section">
            <h4 class="mark-legend-title">{{ s.title }}</h4>
            @for (r of s.rows; track r.key) {
              <p class="mark-legend-row">
                <span [class]="'mark-legend-mark ' + r.mark" aria-hidden="true">
                  @if (r.glyph) {
                    <app-film-glyph [name]="r.glyph" />
                  }
                  @for (g of r.glyphs ?? []; track g) {
                    <app-film-glyph [name]="g" />
                  }
                </span>
                <span class="mark-legend-words"><b>{{ r.name }}</b> {{ r.text }}</span>
              </p>
            }
          </section>
        }
        <!-- Since timeline version 4 (11 Sep 2026) a death can be the game's own answer rather than the film's guess, so the closing line says both and the corner note under the square says which this film is. -->
        <p class="mark-legend-foot">Every place on the film is approximate: the timeline puts everyone somewhere once a minute. A death of ours or theirs stands where the kill event says it happened when the timeline kept that position, and inside its zone when it did not; the note under the square says which this game is.</p>
      </div>
    }
  `
})
export class MarkLegendComponent {
  /** Which layers the surface beside the panel draws; nothing is listed that this surface cannot show. */
  readonly surface = input<MarkSurface>({ reads: true, theirs: true });
  /** Two-way, so a host can fold the panel on its own Escape without reaching inside. */
  readonly open = model<boolean>(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly pill = viewChild.required<ElementRef<HTMLElement>>('pill');

  protected readonly sections = computed(() => marksFor(this.surface()));

  constructor() {
    // The panel takes the focus as it opens, so Escape lands on it and the reader tabs straight into its rows.
    effect(() => {
      const el = this.panel()?.nativeElement;
      if (!el) return;
      untracked(() => focus(el));
    });
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.open.set(true);
  }

  /** The pill takes the focus back as the panel goes, so the reader is never left standing on an element that has just left the page. */
  protected close(): void {
    this.open.set(false);
    focus(this.pill().nativeElement);
  }

  /** Escape closes the panel and stops there: the film page counts two Escapes in a row as "go back", and closing this is what this press was for. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.open()) return;
    event.stopPropagation();
    this.close();
  }
}
