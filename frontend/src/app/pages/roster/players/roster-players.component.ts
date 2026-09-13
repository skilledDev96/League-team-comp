import { DecimalPipe } from '@angular/common';
import { afterNextRender, Component, computed, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { fillInAsPlayer } from '../../../core/roster-build';
import { RosterCard, RosterModel } from '../../../core/roster-model';
import { FillIn, Player } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { ChampionFilterService } from '../../../services/champion-filter.service';
import { MotionService } from '../../../services/motion.service';
import { RefreshService } from '../../../services/refresh.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { InfoTipComponent } from '../../../shared/info-tip.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { defaultQueue, PLAYERS_QUEUE_KEY, PLAYERS_QUEUES, PlayerRowFigures, playerRow, PlayersQueue, queueLabel, visionNote } from './player-rows';
import { PracticeBoardComponent } from './practice-board.component';
import { RosterPlayerDetailComponent } from './roster-player-detail.component';

function readQueue(): PlayersQueue | null {
  try {
    const stored = localStorage.getItem(PLAYERS_QUEUE_KEY);
    return (PLAYERS_QUEUES as readonly string[]).includes(stored ?? '') ? (stored as PlayersQueue) : null;
  } catch {
    return null;
  }
}

interface PlayersRow {
  card: RosterCard;
  player?: Player;
  fill?: FillIn;
  figures: PlayerRowFigures;
}

/**
 * Players (13 Sep 2026, the lead: "the table and scouting feel like they can be merged… not sure what they actually
 * show or bring to the table"). One row a player in the Cards order — A team, bench, fill-ins — with the numbers the
 * Table compared (their own games per queue, from Riot) and the count of what they are working on; a row opens onto
 * what Scouting held: working on, learning and the pool, editable in edit mode.
 *
 * Starter is the columns a reader acts on; Full adds the columns they check and opens the practice board. Rows open by
 * click at both depths, several at once, and Full does not open them all: the extra columns are for reading across
 * rows, and every row open would push them apart and build every row's pickers.
 */
@Component({
  selector: 'app-roster-players',
  imports: [DecimalPipe, InfoTipComponent, PracticeBoardComponent, RosterPlayerDetailComponent, TooltipDirective],
  templateUrl: './roster-players.component.html'
})
export class RosterPlayersComponent {
  readonly full = input(false);
  readonly model = input.required<RosterModel>();
  /** A player to open and scroll to, from `?player=` (the Cards sheet's Open in Players). */
  readonly focus = input<string | null>(null);

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly refresh = inject(RefreshService);
  private readonly filter = inject(ChampionFilterService);
  private readonly motion = inject(MotionService);
  private readonly injector = inject(Injector);

  protected readonly queues = PLAYERS_QUEUES;
  protected readonly queueLabel = queueLabel;
  protected readonly visionNote = visionNote;

  protected readonly queue = signal<PlayersQueue>(readQueue() ?? defaultQueue(this.data.players()));

  protected setQueue(queue: PlayersQueue): void {
    this.queue.set(queue);
    try {
      localStorage.setItem(PLAYERS_QUEUE_KEY, queue);
    } catch {
      // Storage can be unavailable; the choice still holds for this visit.
    }
  }

  protected readonly groups = computed(() => {
    const m = this.model();
    const queue = this.queue();
    const players = new Map(this.data.players().map((p) => [p.id, p]));
    const fills = new Map(this.data.fillIns().map((f) => [f.id, f]));
    const row = (card: RosterCard): PlayersRow => {
      const player = card.playerId ? players.get(card.playerId) : undefined;
      const fill = card.fillInId ? fills.get(card.fillInId) : undefined;
      return { card, player, fill, figures: playerRow(player ?? (fill ? fillInAsPlayer(fill) : undefined), queue) };
    };
    return [
      { key: 'starters', label: 'A team', rows: m.starters.map(row) },
      { key: 'bench', label: 'Bench', rows: m.bench.map(row) },
      { key: 'fillIns', label: 'Fill-ins', rows: m.fillIns.map(row) }
    ].filter((g) => g.rows.length);
  });

  /** The A team and the bench, for the practice board's player pickers. */
  protected readonly boardCards = computed(() => [...this.model().starters, ...this.model().bench]);
  protected readonly firstId = computed(() => this.groups()[0]?.rows[0]?.card.id ?? null);

  /** Highlighted when the champion being asked about is in their pool, dimmed when not, neither without a question. */
  protected match(card: RosterCard): boolean | null {
    return this.filter.active() ? this.filter.passes(card.pool.map((e) => e.champion)) : null;
  }

  // ---- Open rows -------------------------------------------------------------------------------------------
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly firstOpen = computed(() => this.groups().flatMap((g) => g.rows).find((r) => this.expanded().has(r.card.id))?.card.id ?? null);

  protected isOpen(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggle(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** A click anywhere on a row that is not a control of its own opens it, the way a panel's face does on Cards. */
  protected rowClick(id: string, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea')) return;
    this.toggle(id);
  }

  protected close(id: string): void {
    if (!this.isOpen(id)) return;
    this.toggle(id);
    afterNextRender(() => document.getElementById(`rp-open-${id}`)?.focus({ preventScroll: true }), { injector: this.injector });
  }

  /** `?player=<id>` opens that row and brings it on screen, once per id. */
  private lastFocused: string | null = null;
  private readonly focusRow = effect(() => {
    const id = this.focus();
    const m = this.model();
    if (!id || id === this.lastFocused) return;
    if (![...m.starters, ...m.bench, ...m.fillIns].some((c) => c.id === id)) return;
    this.lastFocused = id;
    untracked(() => {
      if (!this.isOpen(id)) this.toggle(id);
      afterNextRender(
        () => {
          document.getElementById(`rp-row-${id}`)?.scrollIntoView?.({ block: 'start', behavior: this.motion.reduced() ? 'auto' : 'smooth' });
          document.getElementById(`rp-open-${id}`)?.focus({ preventScroll: true });
        },
        { injector: this.injector }
      );
    });
  });

  // ---- Refresh every player from Riot (owned by RefreshService, so a run outlives the page) ---------------
  protected readonly refreshingAll = this.refresh.playersRunning;
  protected readonly refreshProgress = this.refresh.playersProgress;

  protected refreshAll(): void {
    void this.refresh.refreshPlayers();
  }
}
