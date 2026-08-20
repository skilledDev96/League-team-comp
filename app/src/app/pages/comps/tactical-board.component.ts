import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Comp, Play, PlayPhase, PlayToken, Role, ROLES, TokenSide } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';

const PHASES: PlayPhase[] = ['Early', 'Mid', 'Late'];

// Default lane-ish spots (percent of board) so a fresh play starts readable.
// Blue side is bottom-left, red side top-right, matching the rift SVG below.
const ALLY_SPOTS: Record<Role, { x: number; y: number }> = {
  Top: { x: 16, y: 26 },
  Jungle: { x: 32, y: 52 },
  Mid: { x: 46, y: 54 },
  ADC: { x: 66, y: 82 },
  Support: { x: 56, y: 82 }
};
const ENEMY_SPOTS = [
  { x: 74, y: 18 },
  { x: 60, y: 34 },
  { x: 54, y: 46 },
  { x: 82, y: 50 },
  { x: 72, y: 44 }
];

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
  protected readonly notes = signal('');
  protected readonly tokens = signal<PlayToken[]>([]);

  private boardEl: HTMLElement | null = null;
  private draggingId: string | null = null;

  constructor() {
    // input() values aren't ready in the field initializers above, so seed here.
    queueMicrotask(() => this.seed());
  }

  private seed(): void {
    const existing = this.play();
    if (existing) {
      this.title.set(existing.title);
      this.phase.set(existing.phase);
      this.notes.set(existing.notes ?? '');
      this.tokens.set(existing.tokens.map((t) => ({ ...t })));
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
    this.notes.set('');
    this.tokens.set([...ally, ...enemy]);
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

  // ---- Dragging ---------------------------------------------------------

  protected startDrag(token: PlayToken, event: PointerEvent): void {
    if (!this.canEdit()) return;
    event.preventDefault();
    this.boardEl = this.host.nativeElement.querySelector('.tb-board');
    this.draggingId = token.id;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.draggingId || !this.boardEl) return;
    const rect = this.boardEl.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
    this.tokens.update((list) =>
      list.map((t) => (t.id === this.draggingId ? { ...t, x, y } : t))
    );
  }

  protected endDrag(): void {
    this.draggingId = null;
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
        notes: this.notes().trim() || undefined,
        tokens: this.tokens()
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
