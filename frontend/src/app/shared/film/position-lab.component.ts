import { afterNextRender, Component, computed, ElementRef, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { FilmDeathPin, FilmFrame, FilmWard } from '../../core/film-model';
import { FRAME_GAP_SEC, gridShade, LabCircle, LabReach, MIN_ARROW_PCT, placedWard, reachOf, readingOf, REACH_SECONDS, sightOf } from '../../core/position-lab';
import { FilmLabDrawing, Role, TimelineWardType } from '../../models/team.models';
import { MotionService } from '../../services/motion.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../tooltip.directive';
import { FilmGlyphComponent } from './film-glyph.component';
import { clockText } from './film-scrubber.component';

/** What the pointer does on the square: drag ours, put a trinket down, put a control ward down, or draw an arrow. */
export type LabMode = 'move' | 'ward' | 'control' | 'path';
export type LabArrowKind = FilmLabDrawing['arrows'][number]['kind'];

export interface LabArrow {
  id: string;
  kind: LabArrowKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A seat of ours as the host knows it; `FilmSeat` fits. The name is never printed: the tokens carry the champion and the seat. */
export interface LabOurSeat {
  seat: Role;
  champion: string;
  name?: string;
}

/** What Undo steps back through: one entry per gesture (a whole drag is one step). */
interface LabState {
  moved: FilmLabDrawing['moved'];
  placed: FilmLabDrawing['wards'];
  arrows: LabArrow[];
}

interface LabToken {
  seat: Role;
  champion?: string;
  x: number;
  y: number;
  /** Where the frame put them, for the ghost and its line when the token was moved. */
  fx: number;
  fy: number;
  moved: boolean;
  label: string;
}

/** The most death marks the lab draws; with ten champions and five ghosts that stays well under the map's sixty tokens. */
export const MAX_LAB_DEATHS = 10;
/** Undo remembers this many gestures. */
const MAX_HISTORY = 50;

export const LAB_NOTE_TIP =
  "Every position is where the minute's frame put them: Riot's timeline places everyone once a minute, and a ward at the spot its placer stood. Nothing here knows cooldowns or pace: a reach is eight seconds on foot.";

/** The board as a comparable string, the second aside and the fields in a fixed order (Firestore hands maps back with their keys sorted): what Save compares the drawing with. */
const boardKey = (d: FilmLabDrawing | null): string =>
  JSON.stringify(d ? { m: d.moved.map((m) => [m.seat, m.x, m.y]), w: d.wards.map((w) => [w.type, w.x, w.y]), a: d.arrows.map((a) => [a.kind, a.x1, a.y1, a.x2, a.y2]) } : { m: [], w: [], a: [] });

const MODE_HINTS: Record<LabMode, string> = {
  move: 'Drag one of ours to try a spot',
  ward: 'Tap the map to put a trinket down; tap a ward to take it away',
  control: 'Tap the map to put a control ward down; tap a ward to take it away',
  path: 'Drag to draw an arrow; tap one and press Delete to take it away'
};

const KIND_WORDS: Record<LabArrowKind, string> = { move: 'Move', path: 'Path', dive: 'Dive' };
const SEAT_SHORT: Record<Role, string> = { Top: 'Top', Jungle: 'Jg', Mid: 'Mid', ADC: 'Bot', Support: 'Sup' };

const round1 = (v: number): number => Math.round(v * 10) / 10;
const clampPct = (v: number): number => Math.min(100, Math.max(0, v));

function capture(el: Element | null, pointerId: number): void {
  // jsdom and old browsers have no pointer capture; a drag still works, it just stops at the square's edge.
  try {
    if (el && typeof (el as HTMLElement).setPointerCapture === 'function') (el as HTMLElement).setPointerCapture(pointerId);
  } catch {
    /* an already-released pointer: nothing to hold */
  }
}

/**
 * The position lab (Part C, 10 Sep 2026): from one second on the tape, the
 * ten stand where the frame put them; drag ours to try a spot, put a trinket
 * or a control ward down and see its sight, and read the ground: their reach
 * over the next eight seconds (dashed: eight seconds on foot, further where
 * their last minute says they moved faster), our sight (solid), and the
 * shading between them: safe where a
 * ward sees and nobody reaches, dark where they reach and nothing sees, seen
 * where both hold. A moved token keeps a faint ghost where the minute put it,
 * with a dotted line to where it went, so the difference stays visible. The
 * coach's board from the screenshot lives in the arrows: move, path and dive
 * on top of the lot. One line under the map reads what changed
 * (`readingOf`), and Save hands the host the drawing (`FilmLabDrawing`) with
 * `readingLine()` as the note's text; the host writes it under "lab:<sec>".
 * A board the film already keeps on the second comes in as `saved` (10 Sep
 * 2026, second fix pass): the lab opens on it, Save wakes only when the board
 * differs from it, and a board cleared to nothing is handed back empty so the
 * host can take the note off the film.
 *
 * The lab draws its own SVG over the Rift image rather than embedding
 * `app-rift-map`: that component places events by zone and caps tokens, and
 * the lab's layers (shading, circles, ghosts) are not events. Like the
 * Rift's live layer, a token is a full-size box slid by its place in
 * percent of itself (its box is the square, so translate(x%, y%) is x% of
 * the map): the one way a drag moves on transform alone. The corner note
 * says approximate, because everything on it is: positions by the minute,
 * wards at the placer's spot. Theirs are a champion in a seat, never a name.
 * The marks are the film's own glyphs (a ward, a skull), never a Material
 * icon. Every action is a pill; Escape closes and Delete removes the
 * selected arrow while the focus is inside the lab (the square takes it on
 * open).
 */
@Component({
  selector: 'app-position-lab',
  imports: [TooltipDirective, FilmGlyphComponent],
  host: { class: 'lab', '[class.is-still]': 'motion.reduced()', '(keydown)': 'onKey($event)' },
  template: `
    <div
      #square
      class="lab-square"
      [class]="'lab-square is-mode-' + mode()"
      tabindex="-1"
      role="application"
      [attr.aria-label]="'Position lab at ' + clock()"
      (pointerdown)="onSquareDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="onUp($event)"
      (click)="onSquareClick($event)"
    >
      <img class="lab-img" src="assets/maps/summoners-rift.png" alt="" draggable="false" />
      <svg class="lab-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          @for (k of kinds; track k) {
            <marker [attr.id]="headId(k)" [class]="'lab-arrow-head is-' + k" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          }
        </defs>
        <g class="lab-shade">
          @for (c of cells(); track c.x + ':' + c.y) {
            <rect [class]="'lab-cell is-' + c.tag" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" [attr.height]="c.h" />
          }
        </g>
        <g class="lab-reaches">
          @for (r of reaches(); track r.seat) {
            <circle class="lab-reach" [attr.data-seat]="r.seat" [attr.cx]="r.x" [attr.cy]="r.y" [attr.r]="r.r" />
          }
        </g>
        <g class="lab-sights">
          @for (s of gameSights(); track $index) {
            <circle class="lab-sight is-game" [attr.cx]="s.x" [attr.cy]="s.y" [attr.r]="s.r" />
          }
          @for (s of placedSights(); track $index) {
            <circle class="lab-sight is-placed" [class.is-control]="s.type === 'control'" [attr.cx]="s.x" [attr.cy]="s.y" [attr.r]="s.r" />
          }
        </g>
        <g class="lab-ghost-lines">
          @for (t of movedTokens(); track t.seat) {
            <line class="lab-ghost-line" [attr.x1]="t.fx" [attr.y1]="t.fy" [attr.x2]="t.x" [attr.y2]="t.y" />
          }
        </g>
        <g class="lab-arrows">
          @for (a of arrows(); track a.id) {
            <line
              [class]="'lab-arrow is-' + a.kind"
              [class.is-selected]="a.id === selectedArrow()"
              [attr.x1]="a.x1"
              [attr.y1]="a.y1"
              [attr.x2]="a.x2"
              [attr.y2]="a.y2"
              [attr.marker-end]="'url(#' + headId(a.kind) + ')'"
            />
            <line class="lab-arrow-hit" [attr.x1]="a.x1" [attr.y1]="a.y1" [attr.x2]="a.x2" [attr.y2]="a.y2" (pointerdown)="selectArrow(a.id, $event)" (click)="$event.stopPropagation()" />
          }
        </g>
      </svg>
      <div class="lab-layer">
        @for (t of movedTokens(); track t.seat) {
          <span class="lab-ghost" [style.left.%]="t.fx" [style.top.%]="t.fy" aria-hidden="true">
            @if (t.champion) {
              <img [src]="ui.championIconUrl(t.champion)" alt="" draggable="false" />
            }
          </span>
        }
        @for (d of deathMarks(); track d.key) {
          <span class="lab-death" role="img" [style.left.%]="d.x" [style.top.%]="d.y" [appTip]="d.line" [attr.aria-label]="d.line">
            <app-film-glyph name="skull" [size]="0.9" />
          </span>
        }
        @for (w of liveGameWards(); track $index) {
          <span class="lab-ward is-game" role="img" [class.is-control]="w.type === 'control'" [style.left.%]="w.x" [style.top.%]="w.y" [appTip]="gameWardTip(w)" [attr.aria-label]="gameWardTip(w)">
            <app-film-glyph name="ward" [size]="0.8" />
          </span>
        }
        @for (w of placed(); track $index; let i = $index) {
          <button
            type="button"
            class="lab-ward is-placed"
            [class.is-control]="w.type === 'control'"
            [style.left.%]="w.x"
            [style.top.%]="w.y"
            [attr.aria-label]="placedWardTip(w)"
            [appTip]="placedWardTip(w)"
            (pointerdown)="$event.stopPropagation()"
            (click)="removeWard(i, $event)"
          >
            <app-film-glyph name="ward" [size]="0.8" />
          </button>
        }
        @for (t of theirTokens(); track t.seat) {
          <div class="lab-token is-them" [style.transform]="slide(t)" [attr.data-seat]="t.seat">
            <button type="button" class="lab-tile" [attr.aria-label]="t.label" [appTip]="t.label">
              @if (t.champion) {
                <img [src]="ui.championIconUrl(t.champion)" alt="" draggable="false" />
              } @else {
                <span>{{ short(t.seat) }}</span>
              }
            </button>
          </div>
        }
        @for (t of ourTokens(); track t.seat) {
          <div class="lab-token is-us" [class.is-moved]="t.moved" [class.is-dragging]="dragging() === t.seat" [style.transform]="slide(t)" [attr.data-seat]="t.seat">
            <button type="button" class="lab-tile" [attr.aria-label]="t.label" [appTip]="t.label" (pointerdown)="startDrag(t.seat, $event)">
              @if (t.champion) {
                <img [src]="ui.championIconUrl(t.champion)" alt="" draggable="false" />
              } @else {
                <span>{{ short(t.seat) }}</span>
              }
            </button>
          </div>
        }
      </div>
      <span class="lab-hint" aria-live="polite">{{ hint() }}</span>
      <span class="lab-note" [appTip]="noteTip" tabindex="0">Approximate, by the minute</span>
    </div>
    <div class="lab-tools" role="toolbar" aria-label="Position lab tools">
      <button type="button" class="view-btn" [class.active]="mode() === 'move'" [attr.aria-pressed]="mode() === 'move'" (click)="setMode('move')">Move</button>
      <button type="button" class="view-btn" [class.active]="mode() === 'ward'" [attr.aria-pressed]="mode() === 'ward'" (click)="setMode('ward')">Ward</button>
      <button type="button" class="view-btn" [class.active]="mode() === 'control'" [attr.aria-pressed]="mode() === 'control'" (click)="setMode('control')">Control ward</button>
      <button type="button" class="view-btn" [class.active]="mode() === 'path'" [attr.aria-pressed]="mode() === 'path'" (click)="setMode('path')">Path</button>
      @if (mode() === 'path') {
        <span class="lab-kinds" role="group" aria-label="Arrow kind">
          @for (k of kinds; track k) {
            <button type="button" [class]="'view-btn is-' + k" [class.active]="arrowKind() === k" [attr.aria-pressed]="arrowKind() === k" (click)="arrowKind.set(k)">{{ kindWord(k) }}</button>
          }
        </span>
      }
      <span class="lab-tools-gap"></span>
      <button type="button" class="view-btn" [disabled]="!history().length" (click)="undo()">Undo</button>
      <button type="button" class="view-btn" [disabled]="!hasMarks()" (click)="reset()">Reset</button>
      @if (canSave()) {
        <button type="button" class="view-btn" [disabled]="!dirty()" (click)="onSave()">Save</button>
      }
      <button type="button" class="view-btn" (click)="close.emit()">Close</button>
    </div>
    <p class="lab-reading" aria-live="polite">{{ reading() }}</p>
    <div class="lab-legend">
      <span><i class="lab-legend-swatch is-safe" aria-hidden="true"></i>Safe: in sight, out of their reach</span>
      <span><i class="lab-legend-swatch is-sight" aria-hidden="true"></i>Seen: in sight, inside their reach</span>
      <span><i class="lab-legend-swatch is-danger" aria-hidden="true"></i>Dark: in their reach, unseen</span>
      <span><i class="lab-legend-swatch is-reach" aria-hidden="true"></i>Reach: what each of theirs could cover in {{ reachSeconds }} s on foot, further where their last minute says they moved faster</span>
    </div>
  `
})
export class PositionLabComponent {
  /** The second on the tape the lab was opened from. */
  readonly sec = input.required<number>();
  readonly ourSide = input.required<'blue' | 'red'>();
  /** The frame at the second (`placeAt` blends one when the second is between frames). */
  readonly frame = input.required<FilmFrame>();
  /** The frame before it, for their pace; null on the first. The pace is read off the real gap between the two frames' minutes. */
  readonly previous = input<FilmFrame | null>(null);
  /** Our wards live at the second, as the film carries them (already at the placer's spot with their sight). */
  readonly wards = input<FilmWard[]>([]);
  /** Deaths of ours within a minute of the second, for the skull marks. */
  readonly deaths = input<FilmDeathPin[]>([]);
  /** Our five seats with their champions, for the tokens' faces. */
  readonly ours = input<LabOurSeat[]>([]);
  /** The game, for the host's note key; the lab itself prints nothing of it. */
  readonly matchId = input<string>('');
  /** Whether Save is offered (10 Sep 2026): the host says no for a viewer, who gets the lab and its reading without a pill that would write to the team's notes. */
  readonly canSave = input<boolean>(true);
  /** The board the film keeps on this second, when its notes carry one (10 Sep 2026, second fix pass): the lab opens on it and Save is an edit of it. */
  readonly saved = input<FilmLabDrawing | null>(null);
  readonly close = output<void>();
  /** The drawing to keep as a note on the second; the host writes it, with `readingLine()` as the note's text. Empty when the board was cleared, so the host takes the note off. */
  readonly save = output<FilmLabDrawing>();

  protected readonly ui = inject(UiService);
  protected readonly motion = inject(MotionService);
  private readonly square = viewChild.required<ElementRef<HTMLElement>>('square');

  protected readonly kinds: LabArrowKind[] = ['move', 'path', 'dive'];
  protected readonly reachSeconds = REACH_SECONDS;
  protected readonly noteTip = LAB_NOTE_TIP;

  protected readonly mode = signal<LabMode>('move');
  protected readonly arrowKind = signal<LabArrowKind>('path');
  /** The board, seeded from the saved one on the second so a reopened lab shows it again; another board (another second) starts the lab over, Undo included. Seeded arrows carry their own ids, so a drawn one never shares. */
  protected readonly moved = linkedSignal<FilmLabDrawing['moved']>(() => (this.saved()?.moved ?? []).map((m) => ({ ...m })));
  protected readonly placed = linkedSignal<FilmLabDrawing['wards']>(() => (this.saved()?.wards ?? []).map((w) => ({ ...w })));
  protected readonly arrows = linkedSignal<LabArrow[]>(() => (this.saved()?.arrows ?? []).map((a, i) => ({ ...a, id: `s${i}` })));
  protected readonly selectedArrow = signal<string | null>(null);
  protected readonly dragging = signal<Role | null>(null);
  protected readonly history = linkedSignal<LabState[]>(() => {
    this.saved();
    return [];
  });

  /** The gesture under way; an arrow remembers what was selected before it, so a tap that draws nothing leaves the selection as it was. */
  private drag: { type: 'token'; seat: Role } | { type: 'arrow'; id: string; before: string | null } | null = null;
  private nextId = 0;
  /** Marker ids carry a random tail, so two labs on one page never share an arrowhead. */
  private readonly uid = Math.random().toString(36).slice(2, 8);

  constructor() {
    // The square takes the focus on open so Escape and Delete reach the lab at once.
    afterNextRender(() => {
      try {
        this.square().nativeElement.focus({ preventScroll: true });
      } catch {
        /* no focus in this environment */
      }
    });
  }

  protected readonly clock = computed(() => clockText(this.sec()));

  protected readonly hint = computed(() => MODE_HINTS[this.mode()]);
  /** Something is on the board: Reset has work to do. */
  protected readonly hasMarks = computed(() => this.moved().length > 0 || this.placed().length > 0 || this.arrows().length > 0);
  /** The drawing as the note keeps it: the second, the moves, the wards and the arrows, all in percent to one decimal. */
  private readonly drawn = computed<FilmLabDrawing>(() => ({
    sec: this.sec(),
    moved: this.moved().map((m) => ({ seat: m.seat, x: round1(m.x), y: round1(m.y) })),
    wards: this.placed().map((w) => ({ type: w.type, x: round1(w.x), y: round1(w.y) })),
    arrows: this.arrows().map((a) => ({ x1: round1(a.x1), y1: round1(a.y1), x2: round1(a.x2), y2: round1(a.y2), kind: a.kind }))
  }));
  /** The board differs from what the film keeps for this second (nothing, without a saved board): Save wakes on this alone, so a save is never rewritten unchanged (10 Sep 2026, second fix pass). */
  protected readonly dirty = computed(() => boardKey(this.drawn()) !== boardKey(this.saved()));

  /** Their reach off the two frames the host passed: the gap is the real one between their minutes (a blended frame sits at a fraction), the frame gap when it is nothing. */
  protected readonly reaches = computed<LabReach[]>(() => {
    const prev = this.previous();
    const gap = prev ? (this.frame().minute - prev.minute) * 60 : FRAME_GAP_SEC;
    return reachOf(this.frame().theirs, prev?.theirs ?? null, REACH_SECONDS, gap > 0 ? gap : FRAME_GAP_SEC);
  });
  protected readonly liveGameWards = computed(() => {
    const sec = this.sec();
    return this.wards().filter((w) => w.sec <= sec && sec < w.untilSec);
  });
  protected readonly gameSights = computed<LabCircle[]>(() => sightOf(this.wards(), this.sec()));
  protected readonly placedSights = computed<LabCircle[]>(() => {
    const sec = this.sec();
    return sightOf(
      this.placed().map((w) => placedWard(w.type, w.x, w.y, sec)),
      sec
    );
  });
  protected readonly sights = computed<LabCircle[]>(() => [...this.gameSights(), ...this.placedSights()]);
  protected readonly cells = computed(() => gridShade(this.sights(), this.reaches()).filter((c) => c.tag !== 'none'));

  private readonly ourChampion = computed(() => new Map(this.ours().map((o) => [o.seat, o.champion])));

  protected readonly ourTokens = computed<LabToken[]>(() => {
    const moved = new Map(this.moved().map((m) => [m.seat, m]));
    return this.frame().ours.map((p) => {
      const champion = this.ourChampion().get(p.seat) || p.champion;
      const m = moved.get(p.seat);
      const who = champion ? `${champion} (${p.seat})` : `Our ${p.seat}`;
      return {
        seat: p.seat,
        champion,
        x: m?.x ?? p.x,
        y: m?.y ?? p.y,
        fx: p.x,
        fy: p.y,
        moved: !!m,
        label: m ? `${who}, moved from where the minute put them` : `${who}, where the minute put them (approximate)`
      };
    });
  });

  protected readonly movedTokens = computed(() => this.ourTokens().filter((t) => t.moved));

  /** A champion in a seat, never a name: theirs stand where the frame put them and never move. */
  protected readonly theirTokens = computed<LabToken[]>(() =>
    this.frame().theirs.map((p) => ({
      seat: p.seat,
      champion: p.champion,
      x: p.x,
      y: p.y,
      fx: p.x,
      fy: p.y,
      moved: false,
      label: `Their ${p.seat}${p.champion ? ` (${p.champion})` : ''}, where the minute put them (approximate)`
    }))
  );

  protected readonly deathMarks = computed(() => this.deaths().slice(0, MAX_LAB_DEATHS));

  protected readonly reading = computed(() =>
    readingOf({
      ourSide: this.ourSide(),
      theirs: this.frame().theirs,
      previous: this.previous()?.theirs ?? null,
      sights: this.sights(),
      placed: this.placedSights(),
      reaches: this.reaches(),
      moved: this.moved()
    })
  );

  /** A token's box is the square, so a translate in percent of itself is the same percent of the map: transform only, nothing else moves. */
  protected slide(t: { x: number; y: number }): string {
    return `translate(${t.x}%, ${t.y}%)`;
  }

  protected headId(kind: LabArrowKind): string {
    return `lab-head-${kind}-${this.uid}`;
  }

  protected short(seat: Role): string {
    return SEAT_SHORT[seat];
  }

  protected kindWord(kind: LabArrowKind): string {
    return KIND_WORDS[kind];
  }

  protected gameWardTip(w: FilmWard): string {
    const kind = w.type === 'control' ? 'Control ward' : w.type === 'trinket' ? 'Trinket' : 'Ward';
    return `${kind}, where ${w.seat} stood at the nearest minute (approximate)`;
  }

  protected placedWardTip(w: { type: TimelineWardType }): string {
    return `${w.type === 'control' ? 'Control ward' : 'Trinket'} you put down; tap to take it away`;
  }

  protected setMode(mode: LabMode): void {
    this.mode.set(mode);
    if (mode !== 'path') this.selectedArrow.set(null);
  }

  // ---- The pointer ------------------------------------------------------

  private posFromEvent(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = this.square().nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: round1(clampPct(((ev.clientX - rect.left) / rect.width) * 100)),
      y: round1(clampPct(((ev.clientY - rect.top) / rect.height) * 100))
    };
  }

  /** One of ours was grabbed: the whole drag is one Undo step. */
  protected startDrag(seat: Role, ev: PointerEvent): void {
    if (this.mode() !== 'move') return;
    ev.preventDefault();
    ev.stopPropagation();
    this.pushHistory();
    capture(ev.currentTarget as Element | null, ev.pointerId);
    this.drag = { type: 'token', seat };
    this.dragging.set(seat);
  }

  /** In Path mode a press on the ground starts an arrow; the other modes place on click, or drag a token. */
  protected onSquareDown(ev: PointerEvent): void {
    if (this.mode() !== 'path') return;
    if ((ev.target as Element | null)?.closest?.('button')) return;
    const p = this.posFromEvent(ev);
    if (!p) return;
    ev.preventDefault();
    this.pushHistory();
    const id = `a${++this.nextId}`;
    const before = this.selectedArrow();
    this.arrows.update((list) => [...list, { id, kind: this.arrowKind(), x1: p.x, y1: p.y, x2: p.x, y2: p.y }]);
    this.selectedArrow.set(id);
    capture(ev.currentTarget as Element | null, ev.pointerId);
    this.drag = { type: 'arrow', id, before };
  }

  protected onMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = this.posFromEvent(ev);
    if (!p) return;
    if (d.type === 'token') {
      this.moved.update((list) => {
        const rest = list.filter((m) => m.seat !== d.seat);
        return [...rest, { seat: d.seat, x: p.x, y: p.y }];
      });
    } else {
      this.arrows.update((list) => list.map((a) => (a.id === d.id ? { ...a, x2: p.x, y2: p.y } : a)));
    }
  }

  protected onUp(_ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dragging.set(null);
    if (d.type === 'arrow') {
      const a = this.arrows().find((x) => x.id === d.id);
      // A tap in Path mode draws nothing: the arrow goes, the Undo step it opened goes, and what was selected stays selected.
      if (a && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < MIN_ARROW_PCT) {
        this.arrows.update((list) => list.filter((x) => x.id !== d.id));
        this.selectedArrow.set(d.before);
        this.history.update((h) => h.slice(0, -1));
      }
    }
  }

  /** In a ward mode a tap on the ground puts one down; a tap on a placed ward (its own handler) takes it away. */
  protected onSquareClick(ev: MouseEvent): void {
    const mode = this.mode();
    if (mode !== 'ward' && mode !== 'control') return;
    if ((ev.target as Element | null)?.closest?.('button')) return;
    const p = this.posFromEvent(ev);
    if (!p) return;
    this.pushHistory();
    this.placed.update((list) => [...list, { type: mode === 'control' ? 'control' : 'trinket', x: p.x, y: p.y }]);
  }

  protected removeWard(index: number, ev: Event): void {
    ev.stopPropagation();
    this.pushHistory();
    this.placed.update((list) => list.filter((_, i) => i !== index));
  }

  protected selectArrow(id: string, ev: PointerEvent): void {
    ev.stopPropagation();
    this.selectedArrow.set(id);
    if (this.mode() !== 'path') this.mode.set('path');
  }

  // ---- The tools --------------------------------------------------------

  private snapshot(): LabState {
    return { moved: this.moved(), placed: this.placed(), arrows: this.arrows() };
  }

  private pushHistory(): void {
    this.history.update((h) => [...h.slice(-(MAX_HISTORY - 1)), this.snapshot()]);
  }

  protected undo(): void {
    const h = this.history();
    const last = h[h.length - 1];
    if (!last) return;
    this.history.set(h.slice(0, -1));
    this.moved.set(last.moved);
    this.placed.set(last.placed);
    this.arrows.set(last.arrows);
    if (this.selectedArrow() && !last.arrows.some((a) => a.id === this.selectedArrow())) this.selectedArrow.set(null);
  }

  /** Back to the frame; Undo brings the drawing back, since a Reset by mistake should not cost the coach the board. On a saved board, Save then takes the note off the film. */
  protected reset(): void {
    if (!this.hasMarks()) return;
    this.pushHistory();
    this.moved.set([]);
    this.placed.set([]);
    this.arrows.set([]);
    this.selectedArrow.set(null);
  }

  protected deleteSelected(): void {
    const id = this.selectedArrow();
    if (!id) return;
    this.pushHistory();
    this.arrows.update((list) => list.filter((a) => a.id !== id));
    this.selectedArrow.set(null);
  }

  /** The drawing as the note keeps it (`drawn`), a fresh copy. */
  protected drawing(): FilmLabDrawing {
    const d = this.drawn();
    return { sec: d.sec, moved: d.moved.map((m) => ({ ...m })), wards: d.wards.map((w) => ({ ...w })), arrows: d.arrows.map((a) => ({ ...a })) };
  }

  protected onSave(): void {
    if (!this.dirty()) return;
    this.save.emit(this.drawing());
  }

  /** The reading line, for the host to keep as the note's text beside the drawing. */
  readingLine(): string {
    return this.reading();
  }

  protected onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.close.emit();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selectedArrow()) {
      ev.preventDefault();
      ev.stopPropagation();
      this.deleteSelected();
    }
  }
}
