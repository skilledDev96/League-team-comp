import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RosterCard } from '../../../core/roster-model';
import { FillIn, LearnEntry, LearnPriority, PainPoint, Player } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { ChampionFilterService } from '../../../services/champion-filter.service';
import { PlayerEditorService } from '../../../services/player-editor.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';

const PRIORITY_RANK: Record<LearnPriority, number> = { high: 0, med: 1, low: 2 };

/**
 * One open row of the Players table (13 Sep 2026, merging Table and Scouting): what they are working on, what they
 * are learning and their pool, each editable in edit mode, then the links out. Created only while the row is open,
 * so a shut row builds no pickers. Full adds strengths, weaknesses, suggested bans, the pool as played for the team
 * and a fill-in's note.
 */
@Component({
  selector: 'app-roster-player-detail',
  imports: [FormsModule, RouterLink, ChampionPickerComponent, NgModelNameDirective, TooltipDirective],
  template: `
    @let c = card();
    <div class="rp-detail-grid">
      @if (player(); as p) {
        <section class="rp-block" [attr.aria-labelledby]="'rp-work-' + c.id">
          <header class="rp-block-head">
            <h3 [id]="'rp-work-' + c.id">Working on</h3>
            @if (auth.editing()) {
              <button type="button" class="view-btn rp-mini" [class.active]="adding()" [attr.aria-expanded]="adding()" (click)="adding.set(!adding())">
                <span class="material-symbols-rounded" aria-hidden="true">{{ adding() ? 'close' : 'add' }}</span>{{ adding() ? 'Done' : 'Add' }}
              </button>
            }
          </header>
          @if (adding() && auth.editing()) {
            <form class="rp-add" (ngSubmit)="addPain(p)">
              <input type="text" [ngModel]="painText()" (ngModelChange)="painText.set($event)" name="rpPainText" placeholder="e.g. Ward river before 3:15" aria-label="What they are working on" />
              <button type="submit" class="view-btn" [disabled]="saving() || !painText().trim()">Add</button>
            </form>
          }
          @if (pains().length) {
            <ul class="practice-list rp-pains">
              @for (pain of pains(); track pain.id) {
                <li class="practice-item" [class.resolved]="pain.resolved">
                  <button type="button" class="practice-check" [class.done]="pain.resolved" [disabled]="!auth.editing()" (click)="toggleResolved(pain)"
                          [attr.aria-label]="pain.resolved ? 'Mark open' : 'Mark resolved'">
                    <span class="material-symbols-rounded" aria-hidden="true">{{ pain.resolved ? 'check_circle' : 'radio_button_unchecked' }}</span>
                  </button>
                  <span class="practice-text">{{ pain.text }}</span>
                  @if (auth.editing()) {
                    <button type="button" class="practice-del" aria-label="Delete" (click)="removePain(pain)">
                      <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="muted rp-empty">Nothing open.</p>
          }
        </section>

        <section class="rp-block" [attr.aria-labelledby]="'rp-learn-' + c.id">
          <header class="rp-block-head"><h3 [id]="'rp-learn-' + c.id">Learning</h3></header>
          @if (learning().length) {
            <ul class="learn-list">
              @for (entry of learning(); track entry.id) {
                <li class="learn-item" [class.ready]="entry.status === 'ready'" [class]="'prio-' + entry.priority">
                  <button type="button" class="learn-check" [class.done]="entry.status === 'ready'" [disabled]="!auth.editing()" (click)="toggleLearn(entry)"
                          [attr.aria-label]="entry.status === 'ready' ? 'Mark learning' : 'Mark ready'">
                    <span class="material-symbols-rounded" aria-hidden="true">{{ entry.status === 'ready' ? 'check_circle' : 'radio_button_unchecked' }}</span>
                  </button>
                  <img class="learn-icon" [src]="ui.championIconUrl(entry.champion)" [alt]="ui.championName(entry.champion)" loading="lazy" />
                  <span class="learn-name">{{ ui.championName(entry.champion) }}</span>
                  @if (auth.editing()) {
                    <select class="learn-prio-select" [ngModel]="entry.priority" (ngModelChange)="setPriority(entry, $event)" [name]="'rp-prio-' + entry.id" aria-label="Priority">
                      @for (pr of priorities; track pr) { <option [value]="pr">{{ priorityLabel(pr) }}</option> }
                    </select>
                    <button type="button" class="learn-del" aria-label="Remove" (click)="removeLearn(entry)">
                      <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                  } @else {
                    <span class="learn-prio" [class]="'prio-' + entry.priority">{{ priorityLabel(entry.priority) }}</span>
                  }
                </li>
              }
            </ul>
          } @else if (!auth.editing()) {
            <p class="muted rp-empty">Nothing on the list.</p>
          }
          @if (auth.editing()) {
            <form class="learn-add" (ngSubmit)="addLearn(p)">
              <app-champion-picker class="learn-champ-picker" [champions]="learnPick()" [max]="1" [role]="p.role" [inputName]="'rp-learn-' + c.id" placeholder="Champion to learn"
                                   (championsChange)="learnChampion.set($event[0] || '')" />
              <select class="learn-prio-select" [ngModel]="learnPriority()" (ngModelChange)="learnPriority.set($event)" [name]="'rp-learnprio-' + c.id" aria-label="Priority">
                @for (pr of priorities; track pr) { <option [value]="pr">{{ priorityLabel(pr) }}</option> }
              </select>
              <button type="submit" class="view-btn" [disabled]="saving() || !learnChampion()">Add</button>
            </form>
          }
        </section>
      }

      <section class="rp-block" [attr.aria-labelledby]="'rp-pool-' + c.id">
        <header class="rp-block-head">
          <h3 [id]="'rp-pool-' + c.id">Pool</h3>
          @if (player() && auth.editing()) {
            <button type="button" class="view-btn rp-mini" [class.active]="editingPool()" [attr.aria-pressed]="editingPool()" (click)="editingPool.set(!editingPool())">
              <span class="material-symbols-rounded" aria-hidden="true">{{ editingPool() ? 'check' : 'edit' }}</span>{{ editingPool() ? 'Done' : 'Edit' }}
            </button>
          }
        </header>
        @if (player(); as p) {
          @if (editingPool() && auth.editing()) {
            <app-champion-picker [champions]="p.top3 || []" [role]="p.role" [inputName]="'rp-pool-' + c.id" placeholder="Add a champion…" (championsChange)="savePool(p, $event)" />
            <p class="muted rp-hint">The first is their main while no team games say otherwise.</p>
          } @else if (declared().length) {
            <ul class="rp-faces">
              @for (champ of declared(); track champ) {
                <li [class.is-match]="filter.matches(champ)" [appTip]="ui.championName(champ)">
                  <img [src]="ui.championIconUrl(champ)" [alt]="ui.championName(champ)" loading="lazy" />
                </li>
              }
            </ul>
          } @else {
            <p class="muted rp-empty">No pool written down.</p>
          }
        } @else if (fill(); as f) {
          @if (f.riot?.top3?.length) {
            <ul class="rp-faces">
              @for (champ of f.riot!.top3; track champ) {
                <li [class.is-match]="filter.matches(champ)" [appTip]="ui.championName(champ) + ' — Riot’s most played'">
                  <img [src]="ui.championIconUrl(champ)" [alt]="ui.championName(champ)" loading="lazy" />
                </li>
              }
            </ul>
          } @else {
            <p class="muted rp-empty">No games read from Riot yet.</p>
          }
        }
        @if (full() && played().length) {
          <p class="rp-label">Played for the team</p>
          <ul class="rp-played">
            @for (e of played(); track e.champion) {
              <li [class.is-match]="filter.matches(e.champion)">
                <img [src]="ui.championIconUrl(e.champion)" [alt]="" loading="lazy" />
                <span>{{ ui.championName(e.champion) }}</span>
                <b [class]="e.band">{{ e.winRate }}%</b><small>{{ e.games }}g</small>
              </li>
            }
          </ul>
        }
      </section>

      @if (full()) {
        <section class="rp-block rp-how" [attr.aria-labelledby]="'rp-how-' + c.id">
          <header class="rp-block-head"><h3 [id]="'rp-how-' + c.id">How they play</h3></header>
          @if (c.playstyle) { <p class="rp-playstyle">{{ c.playstyle }}</p> }
          @if (c.strengths.length) {
            <div class="tag-row">@for (s of c.strengths; track s) { <span class="tag good">{{ s }}</span> }</div>
          }
          @if (c.weaknesses.length) {
            <div class="tag-row">@for (w of c.weaknesses; track w) { <span class="tag bad">{{ w }}</span> }</div>
          }
          @if (c.bans.length) {
            <p class="rp-label">Ban against them</p>
            <ul class="rp-faces">
              @for (b of c.bans; track b) {
                <li [appTip]="ui.championName(b)"><img [src]="ui.championIconUrl(b)" [alt]="ui.championName(b)" loading="lazy" /></li>
              }
            </ul>
          }
          @if (fill(); as f) {
            <p class="rp-label">Fill-in</p>
            <p class="muted">{{ f.status }}@if (f.note) { · {{ f.note }} }</p>
          }
        </section>
      }
    </div>

    <div class="action-row rp-links">
      @if (player(); as p) {
        <a class="view-btn" [routerLink]="['/player', p.id]"><span class="material-symbols-rounded" aria-hidden="true">person</span>Profile</a>
        <a class="view-btn" [href]="ui.summonerSearchUrl(p.name, p.profile)" target="_blank" rel="noopener noreferrer">op.gg <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
        @if (auth.editing()) {
          <button type="button" class="view-btn" (click)="editor.open(p.id)"><span class="material-symbols-rounded" aria-hidden="true">edit</span>Edit player</button>
        }
      } @else if (fill(); as f) {
        <a class="view-btn" [href]="ui.summonerSearchUrl(f.summoner, f.profile)" target="_blank" rel="noopener noreferrer">op.gg <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
        @if (ui.summonerMobalyticsUrl(f.profile); as moba) {
          <a class="view-btn" [href]="moba" target="_blank" rel="noopener noreferrer">Mobalytics <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
        }
        @if (auth.editing()) {
          <a class="view-btn" [routerLink]="['/admin']" [queryParams]="{ tab: 'fillins', fillInId: f.id }">Edit on Admin</a>
        }
      }
    </div>
  `
})
export class RosterPlayerDetailComponent {
  readonly card = input.required<RosterCard>();
  /** The roster player behind the card; absent for a fill-in. */
  readonly player = input<Player | undefined>(undefined);
  readonly fill = input<FillIn | undefined>(undefined);
  readonly full = input(false);

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly editor = inject(PlayerEditorService);
  protected readonly filter = inject(ChampionFilterService);

  protected readonly priorities: LearnPriority[] = ['high', 'med', 'low'];
  protected readonly adding = signal(false);
  protected readonly editingPool = signal(false);
  protected readonly painText = signal('');
  protected readonly learnChampion = signal('');
  protected readonly learnPriority = signal<LearnPriority>('med');
  protected readonly saving = signal(false);

  /** Open first, then resolved at Full only; the board holds the rest. */
  protected readonly pains = computed(() => {
    const id = this.player()?.id;
    return this.data
      .painPoints()
      .filter((p) => p.playerId === id && (this.full() || !p.resolved))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.order - b.order);
  });

  protected readonly learning = computed(() => {
    const id = this.player()?.id;
    return this.data
      .learnEntries()
      .filter((e) => e.playerId === id)
      .sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order);
  });

  protected readonly declared = computed(() => this.player()?.top3 ?? []);
  protected readonly played = computed(() => this.card().pool.filter((e) => e.games > 0));
  protected readonly learnPick = computed(() => (this.learnChampion() ? [this.learnChampion()] : []));

  protected priorityLabel(priority: LearnPriority): string {
    return priority === 'med' ? 'Medium' : priority === 'high' ? 'High' : 'Low';
  }

  protected async addPain(player: Player): Promise<void> {
    const text = this.painText().trim();
    if (this.saving() || !text) return;
    this.saving.set(true);
    try {
      await this.data.createPainPoint({ playerId: player.id, text, resolved: false });
      this.painText.set('');
    } finally {
      this.saving.set(false);
    }
  }

  protected toggleResolved(pain: PainPoint): void {
    void this.data.updatePainPoint({ ...pain, resolved: !pain.resolved });
  }

  protected removePain(pain: PainPoint): void {
    if (!confirm(`Delete this pain point — "${pain.text}"?`)) return;
    void this.data.deletePainPoint(pain.id);
  }

  protected async addLearn(player: Player): Promise<void> {
    const champion = this.learnChampion().trim();
    if (this.saving() || !champion) return;
    this.saving.set(true);
    try {
      await this.data.createLearnEntry({ playerId: player.id, champion, priority: this.learnPriority(), status: 'learning' });
      this.learnChampion.set('');
    } finally {
      this.saving.set(false);
    }
  }

  protected toggleLearn(entry: LearnEntry): void {
    void this.data.updateLearnEntry({ ...entry, status: entry.status === 'ready' ? 'learning' : 'ready' });
  }

  protected setPriority(entry: LearnEntry, priority: LearnPriority): void {
    void this.data.updateLearnEntry({ ...entry, priority });
  }

  protected removeLearn(entry: LearnEntry): void {
    if (!confirm(`Remove ${this.ui.championName(entry.champion) || 'this champion'} from the learn list?`)) return;
    void this.data.deleteLearnEntry(entry.id);
  }

  /**
   * Through the editor, so the player is marked hand-edited (13 Sep 2026): Scouting wrote the pool straight to the
   * store, and the morning refresh then treated the player as untouched and put Riot's champions back.
   */
  protected savePool(player: Player, champions: string[]): void {
    void this.editor.patch(player, { top3: champions });
  }
}
