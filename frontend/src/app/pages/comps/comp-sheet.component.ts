import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { MvpBannerComponent } from '../../shared/mvp-banner.component';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EXPECT_AXES, EXPECT_LABEL, ExpectAxis, LEVEL_LABEL, LEVELS } from '../../core/comp-expectation';
import { CompCard } from '../../core/comps-build';
import { playedAgo } from '../../core/team-season';
import { Comp, ExpectLevel, Play } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { ToastService } from '../../services/toast.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { CompBoardComponent } from '../../shared/comp-board.component';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { RateRingComponent } from '../../shared/rate-ring.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { CompRecordComponent } from './comp-record.component';
import { CompWritesService } from './comp-writes.service';

type Phase = 'early' | 'mid' | 'late';
const PHASES: { key: Phase; label: string; hint: string }[] = [
  { key: 'early', label: 'Early', hint: 'Lanes, jungle path, first objectives…' },
  { key: 'mid', label: 'Mid', hint: 'Grouping, tempo, objective priority…' },
  { key: 'late', label: 'Late', hint: 'Win condition, teamfight shape…' }
];

/**
 * A comp's sheet, under the row holding its tile (13 Sep 2026): the five as faces, the game plan, what the comp
 * is built to do, the bans, the notes, the record and the plays — six blocks, not nine identical label heads.
 * One sheet at a time; the tile that opened it closes it, as do Escape and the close button.
 *
 * Edit mode edits in place (the lead: "overwhelming complaints to just add and edit comps"): the name is a field
 * where the title stands, the category above it, the board where the faces were, every block its own fields, and
 * the ⋯ menu holds Delete comp and the text fallback on Admin. Every write goes through `CompWritesService`.
 */
@Component({
  selector: 'app-comp-sheet',
  imports: [MvpBannerComponent, ChampionChipComponent, ChampionPickerComponent, CompBoardComponent, CompRecordComponent, FormsModule, NgModelNameDirective, OverflowMenuComponent, RateRingComponent, RouterLink, TooltipDirective],
  template: `
    @for (c of [card()]; track c.id) {
      <section class="gold-frame comps-sheet" id="comps-sheet" data-tour="comp-sheet" role="region" aria-labelledby="comps-sheet-title" (keydown.escape)="onEscape($event)">
        <div class="comps-sheet-art">
          @if (c.face) {
            <img class="splash-art" [src]="ui.championArtUrl(c.face)" (error)="ui.artFallback($event, c.face)" alt="" />
          }
          <span class="splash-shade" aria-hidden="true"></span>
          <div class="comps-sheet-art-top">
            <span class="role-pill comps-tile-identity"><span class="material-symbols-rounded" aria-hidden="true">{{ c.icon }}</span>{{ c.identityLabel }}</span>
            <app-rate-ring class="is-big" [rate]="c.headline?.winRate ?? null" [games]="c.headline?.games ?? 0" [wins]="c.headline?.wins ?? 0" label="win rate"
                           [scope]="c.headline?.source === 'logged' ? 'logged by hand' : 'from match history'" [countUp]="true" />
          </div>
          <div class="comps-sheet-art-foot">
            @if (c.played?.form?.length) {
              <ol class="form-pips is-big" aria-label="Last results, newest first">
                @for (r of c.played!.form; track $index) {
                  <li class="form-pip" [class.is-win]="r === 'W'" [class.is-loss]="r === 'L'"><span class="visually-hidden">{{ r === 'W' ? 'Win' : 'Loss' }}</span></li>
                }
              </ol>
            }
            <small>
              @if (c.headline; as h) { {{ h.games }} {{ h.games === 1 ? 'game' : 'games' }}{{ h.source === 'logged' ? ' logged' : '' }} } @else { No games yet }@if (ago(); as a) { · last played {{ a }} }
            </small>
          </div>
        </div>

        <div class="comps-sheet-main">
          <header class="comps-sheet-head">
            <div class="comps-sheet-id">
              @if (auth.editing()) {
                <input class="comps-sheet-category" list="compcatlist" [ngModel]="categoryDraft() ?? c.category ?? ''" (ngModelChange)="categoryDraft.set($event)"
                       (blur)="saveWords()" (keydown.escape)="revertField($event, categoryDraft)" name="comp-category" placeholder="Category — Meta, Comfort, For fun"
                       aria-label="Category" data-tour="comp-category" />
              } @else {
                <p class="home-kicker">{{ c.category ? c.category + ' · ' : '' }}{{ c.identityLabel }}</p>
              }
              <h2 id="comps-sheet-title" tabindex="-1">
                @if (auth.editing()) {
                  <!-- A plain value binding, not ngModel: the page selects the placeholder name right after the sheet renders so
                       typing replaces it, and ngModel writes its value a tick later, after the selection. -->
                  <input id="comps-sheet-rename" class="comps-sheet-rename" [value]="nameDraft() ?? c.name" (input)="nameDraft.set($any($event.target).value)"
                         (blur)="commitName()" (keydown.enter)="blurTarget($event)" (keydown.escape)="revertField($event, nameDraft)"
                         aria-label="Comp name" data-tour="comp-name" autocomplete="off" />
                } @else {
                  {{ c.name }}
                }
              </h2>
              <p class="comps-sheet-sub">
                @if (c.headline; as h) {
                  <span><b [class]="h.band">{{ h.wins }}W&#8211;{{ h.losses }}L</b> · {{ h.winRate }}% {{ h.source === 'logged' ? 'logged' : 'from match history' }}</span>
                } @else { <span>No games yet</span> }
                @if (c.countsUnderName) { <span>Counts under <b>{{ c.countsUnderName }}</b></span> }
                @if (c.variants.length) { <span>{{ variantNames() }} {{ c.variants.length === 1 ? 'counts' : 'count' }} under this</span> }
              </p>
            </div>
            <div class="comps-sheet-actions">
              @if (siblings().length > 1) {
                <button type="button" class="view-btn icon-pill" (click)="go.emit(step(-1))" [attr.aria-label]="'Previous: ' + neighbour(-1)?.name" [appTip]="'Previous: ' + neighbour(-1)?.name">
                  <span class="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                </button>
                <button type="button" class="view-btn icon-pill" (click)="go.emit(step(1))" [attr.aria-label]="'Next: ' + neighbour(1)?.name" [appTip]="'Next: ' + neighbour(1)?.name">
                  <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                </button>
              }
              @if (c.played) {
                <a class="view-btn home-pill" [routerLink]="['/games']" [queryParams]="{ comp: c.id }" appTip="This comp’s games on the Games page"><span class="material-symbols-rounded" aria-hidden="true">query_stats</span> Match history</a>
              }
              @if (auth.editing()) {
                <button type="button" class="view-btn home-pill" [class.active]="logging()" [attr.aria-pressed]="logging()" (click)="logging.set(!logging())" appTip="Log a win or a loss by hand">
                  <span class="material-symbols-rounded" aria-hidden="true">{{ logging() ? 'close' : 'add' }}</span> Log a game
                </button>
                <app-overflow-menu data-tour="comp-more">
                  <a class="overflow-item" [routerLink]="['/admin']" [queryParams]="{ tab: 'comps', compId: c.id }">Edit as text on Admin</a>
                  <button type="button" class="overflow-item danger" (click)="remove.emit()">Delete comp</button>
                </app-overflow-menu>
              }
              <button type="button" class="view-btn icon-pill" (click)="close.emit()" aria-label="Close the sheet" appTip="Close (Esc)">
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
          </header>

          <!-- The five. Editors get the board — press a seat, press a champion — and readers five faces with who covers each. -->
          @if (auth.editing()) {
            <app-comp-board data-tour="comp-board" [picks]="comp().picks" [unavailable]="c.bans" (picksChange)="writes.savePicks(comp(), $event)" />
          } @else {
            <ol class="comps-seats" data-tour="comp-seats" aria-label="The five, by seat">
              @for (s of c.seats; track s.role; let k = $index) {
                <li class="splash-tile comps-seat" [style.--seat-i]="k" [class.is-empty]="!s.champion" [class.is-match]="s.champion && filter.matches(s.champion)">
                  @if (s.champion) {
                    <img class="splash-art" [src]="ui.championArtUrl(s.champion)" (error)="ui.artFallback($event, s.champion)" alt="" loading="lazy" />
                    <span class="splash-shade" aria-hidden="true"></span>
                    <div class="comps-seat-top"><span class="role-pill">{{ s.role }}</span></div>
                    <div class="comps-seat-plate">
                      <span class="comps-seat-champ">{{ ui.championName(s.champion) }}</span>
                      @if (s.note) { <span class="comps-seat-note" [appTip]="s.note">{{ s.note }}</span> }
                      @if (s.cover.length) {
                        <span class="comps-seat-cover" [appTip]="'Who can play ' + s.role">
                          @for (p of s.cover; track p.name) { <span [class.is-flex]="p.flex">{{ p.name }}<app-mvp-banner size="inline" [focusable]="false" [name]="p.name" /></span> }
                        </span>
                      }
                    </div>
                  } @else {
                    <span class="role-pill">{{ s.role }}</span>
                    <small>Empty</small>
                  }
                </li>
              }
            </ol>
          }

          <div class="comps-sheet-grid">
            <section class="comps-sheet-block" style="--block-i: 0" aria-labelledby="comps-block-plan" data-tour="comp-gameplan">
              <h3 id="comps-block-plan">Game plan</h3>
              @if (auth.editing()) {
                <div class="comps-plan-edit">
                  @for (ph of phases; track ph.key) {
                    <label><span>{{ ph.label }}</span>
                      <input class="comps-field" type="text" [ngModel]="planValue(ph.key)" (ngModelChange)="setPlan(ph.key, $event)" (blur)="saveWords()" [name]="'plan-' + ph.key" [placeholder]="ph.hint" /></label>
                  }
                </div>
              } @else if (hasPlan()) {
                <dl class="comps-plan">
                  @for (ph of phases; track ph.key) {
                    @if (c.gamePlan[ph.key]; as line) { <div><dt>{{ ph.label }}</dt><dd>{{ line }}</dd></div> }
                  }
                </dl>
              } @else {
                <p class="comps-sheet-empty">No plan written yet.</p>
              }
            </section>

            <section class="comps-sheet-block" style="--block-i: 1" aria-labelledby="comps-block-expect" data-tour="comp-expect">
              <h3 id="comps-block-expect">What we expect
                @if (c.expect; as ex) {
                  <small>{{ ex.source === 'edited' ? 'set by hand' : 'from the champions' }}</small>
                  @if (auth.editing() && ex.source === 'edited') {
                    <button type="button" class="view-btn" (click)="writes.resetExpectation(comp())" appTip="Drop what was set by hand and read the four axes off the champions again">Back to the champions</button>
                  }
                }
              </h3>
              @if (c.expect; as ex) {
                @if (auth.editing()) {
                  <div class="comps-expect-edit">
                    @for (axis of axes; track axis) {
                      <div class="comps-expect-row">
                        <span>{{ axisLabel[axis] }}</span>
                        <div class="view-segment" role="group" [attr.aria-label]="axisLabel[axis]">
                          @for (level of levels; track level) {
                            <button type="button" [class.active]="ex.expect[axis] === level" [attr.aria-pressed]="ex.expect[axis] === level" (click)="writes.setExpectation(comp(), axis, level, ex.expect)">{{ levelLabel[level] }}</button>
                          }
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <div class="comps-expect">
                    @for (axis of axes; track axis) {
                      <span class="chip comps-expect-chip" [class.is-high]="ex.expect[axis] === 'high'" [class.is-low]="ex.expect[axis] === 'low'">{{ axisLabel[axis] }} <b>{{ levelLabel[ex.expect[axis]] }}</b></span>
                    }
                  </div>
                }
              } @else {
                <p class="comps-sheet-empty">Fill the five and the four axes read themselves off the champions.</p>
              }
            </section>

            <section class="comps-sheet-block" style="--block-i: 2" aria-labelledby="comps-block-bans" data-tour="comp-bans">
              <h3 id="comps-block-bans">Bans <small>to take away when we run it</small></h3>
              @if (auth.editing()) {
                <app-champion-picker [champions]="c.bans" [inputName]="'compbans-' + c.id" placeholder="Add a ban…" (championsChange)="saveBans($event)" />
              } @else if (c.bans.length) {
                <div class="tag-row">
                  @for (ban of c.bans; track ban) { <app-champion-chip [champion]="ban" /> }
                </div>
              } @else {
                <p class="comps-sheet-empty">No bans noted.</p>
              }
            </section>

            <section class="comps-sheet-block" style="--block-i: 3" aria-labelledby="comps-block-notes">
              <h3 id="comps-block-notes">Notes</h3>
              @if (auth.editing()) {
                <textarea class="comps-field" rows="3" [ngModel]="notesDraft() ?? c.notes" (ngModelChange)="notesDraft.set($event)" (blur)="saveWords()" name="comp-notes" placeholder="Draft notes, win conditions, reminders…"></textarea>
              } @else if (c.notes) {
                <p class="comps-notes">{{ c.notes }}</p>
              } @else {
                <p class="comps-sheet-empty">Nothing written yet.</p>
              }
            </section>

            <section class="comps-sheet-block" style="--block-i: 4" aria-labelledby="comps-block-record" data-tour="comp-record">
              <h3 id="comps-block-record">Track record</h3>
              <app-comp-record [card]="c" [comp]="comp()" [full]="full()" [logging]="logging()" />
            </section>

            <section class="comps-sheet-block" style="--block-i: 5" aria-labelledby="comps-block-plays" data-tour="comp-plays">
              <h3 id="comps-block-plays">Dive plays
                @if (auth.editing()) {
                  <button type="button" class="view-btn" (click)="openPlay.emit({ comp: comp(), play: null })"><span class="material-symbols-rounded" aria-hidden="true">add</span> New play</button>
                }
              </h3>
              @if (c.plays.length) {
                <ul class="comps-plays">
                  @for (play of c.plays; track play.id) {
                    <li><button type="button" class="view-btn" (click)="openPlay.emit({ comp: comp(), play })"><span class="comps-play-phase">{{ play.phase }}</span> {{ play.title }} <span class="material-symbols-rounded" aria-hidden="true">open_in_full</span></button></li>
                  }
                </ul>
              } @else {
                <p class="comps-sheet-empty">No plays drawn yet.</p>
              }
            </section>
          </div>
        </div>
      </section>
    }
  `
})
export class CompSheetComponent {
  readonly card = input.required<CompCard>();
  /** The stored comp, for the writes. */
  readonly comp = input.required<Comp>();
  readonly full = input(false);
  /** The comps on the page, for previous and next. */
  readonly siblings = input<readonly CompCard[]>([]);
  readonly close = output<void>();
  readonly go = output<string>();
  readonly openPlay = output<{ comp: Comp; play: Play | null }>();
  readonly remove = output<void>();

  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly filter = inject(ChampionFilterService);
  protected readonly writes = inject(CompWritesService);
  private readonly toast = inject(ToastService);

  protected readonly phases = PHASES;
  protected readonly axes = EXPECT_AXES;
  protected readonly axisLabel = EXPECT_LABEL;
  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly levels = LEVELS;

  /** The log form, opened from the head's pill; shut again on another comp. */
  protected readonly logging = linkedSignal<boolean>(() => {
    this.card().id;
    return false;
  });

  // What is being typed, per comp: null means the field shows what is stored. A new comp clears them all.
  protected readonly nameDraft = linkedSignal<string | null>(() => {
    this.card().id;
    return null;
  });
  protected readonly categoryDraft = linkedSignal<string | null>(() => {
    this.card().id;
    return null;
  });
  protected readonly notesDraft = linkedSignal<string | null>(() => {
    this.card().id;
    return null;
  });
  protected readonly planDraft = linkedSignal<Partial<Record<Phase, string>> | null>(() => {
    this.card().id;
    return null;
  });

  protected readonly ago = computed(() => {
    const at = this.card().lastPlayed;
    return at ? playedAgo(at, Date.now()) : '';
  });
  protected readonly variantNames = computed(() => this.card().variants.map((v) => v.name).join(', '));
  protected readonly hasPlan = computed(() => {
    const p = this.card().gamePlan;
    return !!(p.early || p.mid || p.late);
  });

  protected neighbour(dir: 1 | -1): CompCard | undefined {
    const list = this.siblings();
    const at = list.findIndex((c) => c.id === this.card().id);
    return list.length ? list[(at + dir + list.length) % list.length] : undefined;
  }

  protected step(dir: 1 | -1): string {
    return this.neighbour(dir)?.id ?? this.card().id;
  }

  /** Escape closes the sheet, unless it was pressed in one of its fields: a picker shuts its menu, a field reverts. */
  protected onEscape(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, app-champion-picker')) return;
    this.close.emit();
  }

  protected blurTarget(event: Event): void {
    (event.target as HTMLElement).blur();
  }

  /** Escape in a field: what was typed goes, the field shows what is stored, and the sheet stays. */
  protected revertField(event: Event, draft: { set(v: null): void }): void {
    event.stopPropagation();
    draft.set(null);
    (event.target as HTMLElement).blur();
  }

  protected async commitName(): Promise<void> {
    const draft = this.nameDraft();
    if (draft === null) return;
    const result = await this.writes.rename(this.comp(), draft);
    if (result === 'empty') this.toast.show('A comp needs a name', { kind: 'warn', timeout: 2200 });
    this.nameDraft.set(null);
  }

  protected planValue(phase: Phase): string {
    return this.planDraft()?.[phase] ?? this.card().gamePlan[phase] ?? '';
  }

  protected setPlan(phase: Phase, value: string): void {
    this.planDraft.update((d) => ({ ...(d ?? {}), [phase]: value }));
  }

  /** Category, notes, the plan and the bans, as the fields hold them; the service writes only what changed. */
  protected async saveWords(bans: readonly string[] = this.card().bans): Promise<void> {
    const c = this.card();
    await this.writes.saveWords(this.comp(), {
      category: this.categoryDraft() ?? c.category ?? '',
      notes: this.notesDraft() ?? c.notes,
      early: this.planValue('early'),
      mid: this.planValue('mid'),
      late: this.planValue('late'),
      bans
    });
    this.categoryDraft.set(null);
    this.notesDraft.set(null);
    this.planDraft.set(null);
  }

  protected saveBans(bans: string[]): void {
    void this.saveWords(bans);
  }
}
