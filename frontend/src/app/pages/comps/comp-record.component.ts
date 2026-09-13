import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CompCard } from '../../core/comps-build';
import { Comp, CompResult } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { CompWritesService, ResultDraft } from './comp-writes.service';
import { rollupNotes } from './note-insights.util';

/** How many of a comp's game notes show before "Show all". */
const NOTES_PREVIEW = 3;

/**
 * A comp's track record, in the sheet (13 Sep 2026). Starter is the headline and, for an editor who asked, the log
 * form. Full adds the checks: the bar, each result, what the reviews made of the games, the notes written on them,
 * and the counts-under rule — a records rule, so it sits with the record.
 */
@Component({
  selector: 'app-comp-record',
  imports: [DatePipe, FormsModule, NgModelNameDirective, RouterLink, TooltipDirective],
  template: `
    @let c = card();
    @if (c.headline; as h) {
      <p class="comps-record-line">
        <b [class]="h.band">{{ h.wins }}W&#8211;{{ h.losses }}L</b>
        <span>{{ h.winRate }}% {{ h.source === 'logged' ? 'logged by hand' : 'from match history' }}</span>
        @if (h.source === 'logged' && c.played; as p) { <small>· match history {{ p.wins }}W&#8211;{{ p.losses }}L</small> }
      </p>
    } @else {
      <p class="empty-state comps-sheet-empty">No games yet — play it, or log one.</p>
    }

    @if (full() && c.headline; as h) {
      <div class="comps-record-bar" role="img" [attr.aria-label]="h.winRate + '% win rate'"><span [style.width.%]="h.winRate"></span></div>
    }

    @if (full() && c.reviewed; as r) {
      <p class="comps-played-out" [appTip]="r.offPlanWhy.length ? 'Off plan: ' + r.offPlanWhy.join(' · ') : 'From the post-game reviews of the games that count as this comp'">
        <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
        Played out as drafted in <b>{{ r.asDrafted }}</b> of <b>{{ r.reviewed }}</b> reviewed {{ r.reviewed === 1 ? 'game' : 'games' }}@if (r.offPlan) {, off plan in <b class="is-warn">{{ r.offPlan }}</b>}@if (r.unclear) {, unclear in {{ r.unclear }}}.
      </p>
    }

    @if (full() && c.logged; as l) {
      <ul class="comps-results" aria-label="Logged results, newest first">
        @for (r of l.results; track r.id) {
          <li class="comps-result" [class.is-win]="r.outcome === 'win'" [class.is-loss]="r.outcome === 'loss'">
            <span class="comps-result-outcome">{{ r.outcome === 'win' ? 'Win' : 'Loss' }}</span>
            <span class="comps-result-meta">
              @if (r.opponent) { <span>vs {{ r.opponent }}</span> }
              <span>{{ ui.formatDay(r.playedOn) }}</span>
              @if (r.note) { <span class="is-note">{{ r.note }}</span> }
            </span>
            @if (auth.editing()) {
              <button type="button" class="view-btn icon-pill" aria-label="Delete this result" appTip="Delete this result" (click)="deleteResult(r)">
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            }
          </li>
        }
      </ul>
    }

    @if (full() && c.gameNotes.length) {
      <details class="comps-retro" (toggle)="retroOpen.set($any($event.target).open)">
        <summary>
          <span class="material-symbols-rounded" aria-hidden="true">sticky_note_2</span>
          <span appTip="The match notes written on the games that count as this comp">Notes from its games</span>
          <span class="chip">{{ c.gameNotes.length }}</span>
          <span class="fold-chevron material-symbols-rounded" aria-hidden="true">expand_more</span>
        </summary>
        @if (rollup(); as r) {
          @if (r.mentions.length) {
            <div class="comps-retro-mentions">
              <span>Keeps coming up</span>
              @for (m of r.mentions; track m.champion) {
                <span class="comps-retro-mention" [class.is-negative]="m.losses > m.count - m.losses" [appTip]="m.count + ' notes, ' + m.losses + ' of them losses'">
                  <img [src]="ui.championIconUrl(m.champion)" alt="" loading="lazy" />{{ m.champion }} <em>{{ m.count }}</em>
                </span>
              }
            </div>
          }
          <ul class="comps-retro-notes">
            @for (n of (retroAll() ? r.notes : r.notes.slice(0, preview)); track n.matchId) {
              <li class="comps-retro-note" [class.is-win]="n.win" [class.is-loss]="!n.win">
                <span class="comps-retro-note-outcome">{{ n.win ? 'W' : 'L' }}</span>
                <span class="comps-retro-note-date">@if (n.date) { {{ n.date | date: 'd MMM' }} }</span>
                <a [routerLink]="['/games']" [queryParams]="{ match: n.matchId }" appTip="Open the game this note is about">{{ n.text }}</a>
              </li>
            }
          </ul>
          @if (r.notes.length > preview) {
            <button type="button" class="view-btn" (click)="retroAll.set(!retroAll())">{{ retroAll() ? 'Show fewer' : 'Show all ' + r.notes.length + ' notes' }}</button>
          }
        }
      </details>
    }

    @if (full()) {
      @if (auth.editing()) {
        <label class="comps-sheet-line" data-tour="comp-counts-under">
          <span appTip="For the records only: this comp’s games are counted as the comp chosen here, straight away on Games and Patterns. For near-duplicate drafts kept separate to play from.">Counts as part of</span>
          <select class="comps-field" [name]="'compunder-' + c.id" [ngModel]="c.countsUnder ?? ''" (ngModelChange)="writes.setCountsUnder(comp(), $event)">
            <option value="">Stands on its own</option>
            @for (other of others(); track other.id) { <option [value]="other.id">{{ other.name }}</option> }
          </select>
        </label>
      } @else if (c.countsUnderName) {
        <p class="comps-sheet-line" data-tour="comp-counts-under"><span class="material-symbols-rounded" aria-hidden="true">merge</span>Counts as part of <b>{{ c.countsUnderName }}</b></p>
      }
    }

    @if (auth.editing() && logging()) {
      <form class="comps-log" (ngSubmit)="submit()" aria-label="Log a game">
        <div class="view-segment" role="group" aria-label="Result">
          <button type="button" [class.active]="draft().outcome === 'win'" [attr.aria-pressed]="draft().outcome === 'win'" (click)="patch({ outcome: 'win' })">Win</button>
          <button type="button" [class.active]="draft().outcome === 'loss'" [attr.aria-pressed]="draft().outcome === 'loss'" (click)="patch({ outcome: 'loss' })">Loss</button>
        </div>
        <label><span>Opponent</span><input class="comps-field" type="text" [ngModel]="draft().opponent" (ngModelChange)="patch({ opponent: $event })" [name]="'opp-' + c.id" placeholder="Team name" /></label>
        <label><span>Date</span><input class="comps-field" type="date" [ngModel]="draft().playedOn" (ngModelChange)="patch({ playedOn: $event })" [name]="'date-' + c.id" /></label>
        <label><span>Note</span><input class="comps-field" type="text" [ngModel]="draft().note" (ngModelChange)="patch({ note: $event })" [name]="'note-' + c.id" placeholder="What worked or didn’t" /></label>
        <button type="submit" class="view-btn active" [disabled]="saving()">Log game</button>
      </form>
    }
  `
})
export class CompRecordComponent {
  readonly card = input.required<CompCard>();
  readonly comp = input.required<Comp>();
  readonly full = input(false);
  /** The log form is open (the sheet's Log a game pill). */
  readonly logging = input(false);

  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly writes = inject(CompWritesService);
  private readonly data = inject(TeamDataService);
  private readonly champData = inject(ChampionDataService);

  protected readonly preview = NOTES_PREVIEW;
  protected readonly retroOpen = signal(false);
  protected readonly retroAll = signal(false);
  /** The rollup over the notes, only while the fold is open: fifty games is fifty notes. */
  protected readonly rollup = computed(() => (this.retroOpen() ? rollupNotes(this.card().gameNotes, this.champData.champions().map((c) => c.name)) : null));

  /** Every other comp, as targets for counts-under; a comp cannot fold into itself. */
  protected readonly others = computed(() => this.data.comps().filter((c) => c.id !== this.card().id));

  protected readonly draft = signal<ResultDraft>(this.writes.blankDraft());
  protected readonly saving = signal(false);

  protected patch(p: Partial<ResultDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.writes.logResult(this.comp(), this.draft());
      // Blank again, and the form stays open for the next one.
      this.draft.set(this.writes.blankDraft());
    } finally {
      this.saving.set(false);
    }
  }

  protected deleteResult(r: CompResult): void {
    const who = r.opponent ? ` against ${r.opponent}` : '';
    if (!confirm(`Delete the logged ${r.outcome}${who} on ${this.ui.formatDay(r.playedOn)}?`)) return;
    void this.writes.deleteResult(r);
  }
}
