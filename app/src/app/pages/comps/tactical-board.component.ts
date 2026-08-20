import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ArrowKind,
  Comp,
  MarkerKind,
  Play,
  PlayArrow,
  PlayMarker,
  PlayPhase,
  PlayToken,
  Role,
  ROLES,
  TokenSide
} from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';

const PHASES: PlayPhase[] = ['Early', 'Mid', 'Late'];

// Default lane-ish spots (percent of board) so a fresh play starts readable.
// Blue side is bottom-left, red side top-right, matching the rift SVG below.
const ALLY_SPOTS: Record<Role, { x: number; y: number }> = {
  Top: { x: 16, y: 26 },
  Jungle: { x: 32, y: 52 },
  Mid: { x: 46, y: 54 },
  // ADC + Support start in the blue-side bot-lane brushes (tri-brush pair).
  ADC: { x: 74, y: 76 },
  Support: { x: 80, y: 70 }
};
// Enemy tokens start as a tidy staging column down the left edge, ready to be
// dragged onto the map (they have no champion until you assign one).
const ENEMY_SPOTS = [
  { x: 5, y: 16 },
  { x: 5, y: 33 },
  { x: 5, y: 50 },
  { x: 5, y: 67 },
  { x: 5, y: 84 }
];

// Objectives spawn at fixed spots; blue base is bottom-left, so the river runs
// top-left (Baron/grubs/herald) to bottom-right (Dragon).
const MARKER_DEFAULTS: Record<MarkerKind, { x: number; y: number }> = {
  minion: { x: 50, y: 50 },
  dragon: { x: 70, y: 66 },
  grubs: { x: 32, y: 30 },
  herald: { x: 34, y: 34 },
  baron: { x: 30, y: 28 },
  ward: { x: 50, y: 45 }
};

const MARKER_META: Record<MarkerKind, { label: string; short: string; icon?: string }> = {
  minion: { label: 'Minion wave', short: 'M' },
  dragon: { label: 'Dragon', short: 'DRK' },
  grubs: { label: 'Void grubs', short: 'GRB' },
  herald: { label: 'Rift Herald', short: 'HLD' },
  baron: { label: 'Baron', short: 'BRN' },
  ward: { label: 'Ward', short: 'WRD', icon: 'visibility' }
};

const MARKER_KINDS: MarkerKind[] = ['ward', 'minion', 'dragon', 'grubs', 'herald', 'baron'];

@Component({
  selector: 'app-tactical-board',
  imports: [FormsModule],
  templateUrl: './tactical-board.component.html'
})
export class TacticalBoardComponent {
  private readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly comp = input.required<Comp>();
  readonly play = input<Play | null>(null);
  readonly canEdit = input<boolean>(false);
  readonly close = output<void>();

  protected readonly phases = PHASES;
  protected readonly saving = signal(false);

  // Optional real-map background; falls back to the stylized SVG rift when empty.
  protected readonly mapImage = 'assets/maps/summoners-rift.png';

  // Working copy the board edits; committed to the service on Save.
  protected readonly title = signal('');
  protected readonly phase = signal<PlayPhase>('Early');
  protected readonly noteItems = signal<string[]>([]);
  protected readonly newNote = signal('');
  protected readonly tokens = signal<PlayToken[]>([]);
  protected readonly arrows = signal<PlayArrow[]>([]);
  protected readonly markers = signal<PlayMarker[]>([]);

  // 'move' drags tokens/markers; 'arrow' draws arrows; 'objectives' places markers.
  protected readonly mode = signal<'move' | 'arrow' | 'objectives'>('move');
  protected readonly arrowKind = signal<ArrowKind>('dive');
  protected readonly markerKinds = MARKER_KINDS;

  private boardEl: HTMLElement | null = null;
  // What the current pointer gesture is manipulating. arrow-move tracks the last
  // pointer position so the whole arrow can be translated by the delta each frame.
  private drag:
    | { type: 'token'; id: string }
    | { type: 'marker'; id: string }
    | { type: 'arrow-end'; id: string; end: 1 | 2 }
    | { type: 'arrow-move'; id: string; lastX: number; lastY: number }
    | { type: 'new-arrow'; id: string }
    | null = null;

  constructor() {
    // input() values aren't ready in the field initializers above, so seed here.
    queueMicrotask(() => this.seed());
  }

  private seed(): void {
    const existing = this.play();
    if (existing) {
      this.title.set(existing.title);
      this.phase.set(existing.phase);
      // Prefer the new list; fall back to migrating a legacy single note.
      const items = existing.noteItems ?? (existing.notes ? [existing.notes] : []);
      this.noteItems.set([...items]);
      this.tokens.set(existing.tokens.map((t) => ({ ...t })));
      this.arrows.set((existing.arrows ?? []).map((a) => ({ ...a })));
      this.markers.set((existing.markers ?? []).map((m) => ({ ...m })));
      return;
    }
    // New play: ally tokens from the comp's picks, plus five enemy slots.
    const comp = this.comp();
    const ally: PlayToken[] = ROLES.map((role) => ({
      id: `ally-${role}`,
      side: 'ally' as TokenSide,
      role,
      champion: this.ui.parseCompLine(comp.picks[role] ?? '').champion,
      x: ALLY_SPOTS[role].x,
      y: ALLY_SPOTS[role].y
    }));
    const enemy: PlayToken[] = ENEMY_SPOTS.map((spot, i) => ({
      id: `enemy-${i}`,
      side: 'enemy' as TokenSide,
      champion: '',
      x: spot.x,
      y: spot.y
    }));
    this.title.set('New play');
    this.phase.set('Early');
    this.noteItems.set([]);
    this.tokens.set([...ally, ...enemy]);
  }

  protected addNote(): void {
    const text = this.newNote().trim();
    if (!text) return;
    this.noteItems.update((list) => [...list, text]);
    this.newNote.set('');
  }

  protected deleteNote(index: number): void {
    this.noteItems.update((list) => list.filter((_, i) => i !== index));
  }

  protected readonly enemyTokens = computed(() => this.tokens().filter((t) => t.side === 'enemy'));

  protected iconFor(token: PlayToken): string | null {
    return token.champion ? this.ui.championIconUrl(token.champion) : null;
  }

  protected tokenLabel(token: PlayToken): string {
    if (token.champion) return token.champion;
    if (token.role) return token.role;
    return 'Enemy';
  }

  protected arrowClass(arrow: PlayArrow): string {
    return `is-${arrow.kind}`;
  }

  protected arrowMarker(arrow: PlayArrow): string {
    return `url(#tbArrowHead-${arrow.kind})`;
  }

  // ---- Board interaction (tokens + arrows) ------------------------------

  private board(): HTMLElement | null {
    if (!this.boardEl) {
      this.boardEl = this.host.nativeElement.querySelector('.tb-board');
    }
    return this.boardEl;
  }

  private posFromEvent(event: PointerEvent): { x: number; y: number } | null {
    const rect = this.board()?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100)
    };
  }

  // Token drag — only in move mode.
  protected startDrag(token: PlayToken, event: PointerEvent): void {
    if (!this.canEdit() || this.mode() !== 'move') return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = { type: 'token', id: token.id };
  }

  // Pointer down on empty board in arrow mode starts a new arrow.
  protected onBoardPointerDown(event: PointerEvent): void {
    if (!this.canEdit() || this.mode() !== 'arrow') return;
    const pos = this.posFromEvent(event);
    if (!pos) return;
    event.preventDefault();
    const arrow: PlayArrow = {
      id: `arrow-${Date.now().toString(36)}`,
      kind: this.arrowKind(),
      x1: pos.x,
      y1: pos.y,
      x2: pos.x,
      y2: pos.y
    };
    this.arrows.update((list) => [...list, arrow]);
    this.drag = { type: 'new-arrow', id: arrow.id };
  }

  // Drag an existing arrow endpoint handle.
  protected startArrowEnd(arrow: PlayArrow, end: 1 | 2, event: PointerEvent): void {
    if (!this.canEdit()) return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = { type: 'arrow-end', id: arrow.id, end };
  }

  // Grab the arrow body to slide the whole arrow, both ends together.
  protected startArrowMove(arrow: PlayArrow, event: PointerEvent): void {
    if (!this.canEdit()) return;
    const pos = this.posFromEvent(event);
    if (!pos) return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = { type: 'arrow-move', id: arrow.id, lastX: pos.x, lastY: pos.y };
  }

  // Drag a marker — allowed in move or objectives mode.
  protected startMarkerDrag(marker: PlayMarker, event: PointerEvent): void {
    if (!this.canEdit() || this.mode() === 'arrow') return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = { type: 'marker', id: marker.id };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    const pos = this.posFromEvent(event);
    if (!pos) return;
    const active = this.drag;
    if (active.type === 'token') {
      this.tokens.update((list) =>
        list.map((t) => (t.id === active.id ? { ...t, x: pos.x, y: pos.y } : t))
      );
    } else if (active.type === 'marker') {
      this.markers.update((list) =>
        list.map((m) => (m.id === active.id ? { ...m, x: pos.x, y: pos.y } : m))
      );
    } else if (active.type === 'arrow-move') {
      const dx = pos.x - active.lastX;
      const dy = pos.y - active.lastY;
      active.lastX = pos.x;
      active.lastY = pos.y;
      this.arrows.update((list) =>
        list.map((a) =>
          a.id === active.id
            ? {
                ...a,
                x1: clamp(a.x1 + dx),
                y1: clamp(a.y1 + dy),
                x2: clamp(a.x2 + dx),
                y2: clamp(a.y2 + dy)
              }
            : a
        )
      );
    } else {
      this.arrows.update((list) =>
        list.map((a) => {
          if (a.id !== active.id) return a;
          if (active.type === 'arrow-end' && active.end === 1) return { ...a, x1: pos.x, y1: pos.y };
          return { ...a, x2: pos.x, y2: pos.y };
        })
      );
    }
  }

  protected endDrag(): void {
    // Discard a new arrow that was just a click (too short to be meaningful).
    if (this.drag?.type === 'new-arrow') {
      const id = this.drag.id;
      const a = this.arrows().find((x) => x.id === id);
      if (a && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 3) {
        this.arrows.update((list) => list.filter((x) => x.id !== id));
      }
    }
    this.drag = null;
  }

  protected deleteArrow(id: string): void {
    this.arrows.update((list) => list.filter((a) => a.id !== id));
  }

  protected midX(a: PlayArrow): number {
    return (a.x1 + a.x2) / 2;
  }

  protected midY(a: PlayArrow): number {
    return (a.y1 + a.y2) / 2;
  }

  // ---- Objective / wave markers -----------------------------------------

  protected addMarker(kind: MarkerKind): void {
    const spot = MARKER_DEFAULTS[kind];
    const marker: PlayMarker = { id: `mk-${Date.now().toString(36)}`, kind, x: spot.x, y: spot.y };
    this.markers.update((list) => [...list, marker]);
  }

  protected setMarkerTime(id: string, time: string): void {
    this.markers.update((list) =>
      list.map((m) => (m.id === id ? { ...m, time: time.trim() } : m))
    );
  }

  protected deleteMarker(id: string): void {
    this.markers.update((list) => list.filter((m) => m.id !== id));
  }

  protected markerLabel(kind: MarkerKind): string {
    return MARKER_META[kind].label;
  }

  protected markerShort(kind: MarkerKind): string {
    return MARKER_META[kind].short;
  }

  // A Material Symbol for markers that read better as an icon (e.g. the ward eye).
  protected markerIcon(kind: MarkerKind): string {
    return MARKER_META[kind].icon ?? '';
  }

  // ---- Enemy champion assignment ----------------------------------------

  protected setEnemyChampion(id: string, champion: string): void {
    this.tokens.update((list) =>
      list.map((t) => (t.id === id ? { ...t, champion: champion.trim() } : t))
    );
  }

  // ---- Persistence ------------------------------------------------------

  protected async save(): Promise<void> {
    if (this.saving() || !this.canEdit()) return;
    this.saving.set(true);
    try {
      const existing = this.play();
      const payload = {
        compId: this.comp().id,
        title: this.title().trim() || 'Untitled play',
        phase: this.phase(),
        notes: undefined,
        noteItems: this.noteItems(),
        tokens: this.tokens(),
        arrows: this.arrows(),
        markers: this.markers()
      };
      if (existing) {
        await this.data.updatePlay({ ...existing, ...payload });
      } else {
        await this.data.createPlay(payload);
      }
      this.close.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const existing = this.play();
    if (!existing || !this.canEdit()) return;
    await this.data.deletePlay(existing.id);
    this.close.emit();
  }

  protected dismiss(): void {
    this.close.emit();
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
