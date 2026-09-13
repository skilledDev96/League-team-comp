import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RosterCard } from '../../../core/roster-model';
import { PainPoint } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';

interface PainRow extends PainPoint {
  playerName: string;
}

/**
 * The team's practice board (moved out of Scouting on 13 Sep 2026): every pain point on the roster, filtered by
 * player and status, added and resolved in edit mode. Shut at Starter and open at Full (the lead: "this panel should
 * be collapsed on starter view"); a click turns it either way, a change of depth resets it, and its list is only built
 * while it is open.
 */
@Component({
  selector: 'app-practice-board',
  imports: [FormsModule, NgModelNameDirective],
  template: `
    <details data-tour="players-practice-board" class="card fold-card practice-board" [open]="open()" (toggle)="open.set($any($event.target).open)" aria-label="Team practice board">
      <summary class="practice-head">
        <h2 class="title-with-icon"><span class="section-icon material-symbols-rounded">fitness_center</span>Practice Board</h2>
        <span class="practice-counts">
          <span class="practice-count open">{{ summary().open }} open</span>
          <span class="practice-count done">{{ summary().resolved }} resolved</span>
        </span>
        <span class="fold-chevron material-symbols-rounded" aria-hidden="true">expand_more</span>
      </summary>

      @if (open()) {
        <div class="practice-filters">
          <label class="practice-filter">
            <span>Player</span>
            <select [ngModel]="playerFilter()" (ngModelChange)="playerFilter.set($event)" name="ppPlayer">
              <option value="all">All players</option>
              @for (c of players(); track c.id) {
                <option [value]="c.playerId">{{ c.name }}</option>
              }
            </select>
          </label>
          <div class="view-segment practice-status" role="group" aria-label="Status filter">
            <button type="button" [class.active]="statusFilter() === 'open'" (click)="statusFilter.set('open')">Open</button>
            <button type="button" [class.active]="statusFilter() === 'resolved'" (click)="statusFilter.set('resolved')">Resolved</button>
            <button type="button" [class.active]="statusFilter() === 'all'" (click)="statusFilter.set('all')">All</button>
          </div>
        </div>

        @if (auth.editing()) {
          <form class="practice-add" (ngSubmit)="add()">
            <select [ngModel]="newPlayer()" (ngModelChange)="newPlayer.set($event)" name="ppNewPlayer" aria-label="Player">
              <option value="" disabled>Pick player…</option>
              @for (c of players(); track c.id) {
                <option [value]="c.playerId">{{ c.name }}</option>
              }
            </select>
            <input type="text" [ngModel]="newText()" (ngModelChange)="newText.set($event)" name="ppNewText" placeholder="e.g. Overextends without vision" />
            <button type="submit" class="view-btn" [disabled]="saving()">Add</button>
          </form>
        }

        @if (rows().length) {
          <ul class="practice-list">
            @for (row of rows(); track row.id) {
              <li class="practice-item" [class.resolved]="row.resolved">
                <button type="button" class="practice-check" [class.done]="row.resolved" [disabled]="!auth.editing()" (click)="toggleResolved(row)"
                        [attr.aria-label]="row.resolved ? 'Mark open' : 'Mark resolved'">
                  <span class="material-symbols-rounded" aria-hidden="true">{{ row.resolved ? 'check_circle' : 'radio_button_unchecked' }}</span>
                </button>
                <span class="practice-player">{{ row.playerName }}</span>
                <span class="practice-text">{{ row.text }}</span>
                @if (auth.editing()) {
                  <button type="button" class="practice-del" aria-label="Delete" (click)="remove(row.id)">
                    <span class="material-symbols-rounded" aria-hidden="true">close</span>
                  </button>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">No pain points{{ statusFilter() !== 'all' ? ' (' + statusFilter() + ')' : '' }}{{ playerFilter() !== 'all' ? ' for this player' : '' }}.</p>
        }
      }
    </details>
  `
})
export class PracticeBoardComponent {
  readonly full = input(false);
  /** The A team and the bench in seat order, for the player pickers. */
  readonly cards = input<readonly RosterCard[]>([]);

  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);

  /** Follows the depth, and a click turns it until the depth changes again. */
  protected readonly open = linkedSignal(() => this.full());

  protected readonly playerFilter = signal('all');
  protected readonly statusFilter = signal<'all' | 'open' | 'resolved'>('open');
  protected readonly newPlayer = signal('');
  protected readonly newText = signal('');
  protected readonly saving = signal(false);

  protected readonly players = computed(() => this.cards().filter((c) => !!c.playerId));

  protected readonly summary = computed(() => {
    const all = this.data.painPoints();
    const open = all.filter((p) => !p.resolved).length;
    return { open, resolved: all.length - open };
  });

  protected readonly rows = computed<PainRow[]>(() => {
    const player = this.playerFilter();
    const status = this.statusFilter();
    const names = new Map(this.data.players().map((p) => [p.id, p.name]));
    return this.data
      .painPoints()
      .filter((p) => player === 'all' || p.playerId === player)
      .filter((p) => status === 'all' || (status === 'resolved' ? p.resolved : !p.resolved))
      .map((p) => ({ ...p, playerName: names.get(p.playerId) ?? 'Unknown' }))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.order - b.order);
  });

  protected async add(): Promise<void> {
    const playerId = this.newPlayer();
    const text = this.newText().trim();
    if (this.saving() || !playerId || !text) return;
    this.saving.set(true);
    try {
      await this.data.createPainPoint({ playerId, text, resolved: false });
      this.newText.set('');
    } finally {
      this.saving.set(false);
    }
  }

  protected toggleResolved(pain: PainPoint): void {
    void this.data.updatePainPoint({ ...pain, resolved: !pain.resolved });
  }

  protected remove(id: string): void {
    const pain = this.data.painPoints().find((p) => p.id === id);
    if (!confirm(`Delete this pain point${pain?.text ? ` — "${pain.text}"` : ''}?`)) return;
    void this.data.deletePainPoint(id);
  }
}
