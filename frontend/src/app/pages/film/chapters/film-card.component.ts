import { Location } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, input, output, untracked, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FilmModel } from '../../../core/film-model';
import { reviewAsText } from '../../../core/review-view';
import { AnalysisGame, FilmChoice, GameReview, LedgerSummary, Role } from '../../../models/team.models';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { UiService } from '../../../services/ui.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { initialsOf } from '../../../core/initials';
import { countAll } from '../../../shared/film/film-count';
import { FilmFrameComponent } from '../film-frame.component';

/**
 * The card (9 Sep 2026): the film folded to a phone-sized card the team can
 * keep, over the protagonist's splash dimmed and panning slowly (no clip
 * here: two clips a film is enough), the scoreline's figures counting up
 * chip by chip. The headline over the scoreline, what to watch for next game, the
 * commitment with the initials of who picked, one ask per player with your
 * own seat first, one keep-doing, and the toggle that asks you
 * again before the next game. Copy for Discord carries the same review text
 * the panel copies, plus the commitment, the film link and the notes.
 */
@Component({
  selector: 'app-film-card',
  imports: [RouterLink, FilmFrameComponent],
  template: `
    @let c = model().card;
    @if (model().title.protagonist.champion; as champ) {
      <div class="film-chapter-art is-dim" aria-hidden="true">
        <img class="film-splash" [src]="ui.championArtUrl(champ)" (error)="ui.artFallback($event, champ)" alt="" />
        <span class="film-chapter-shade"></span>
      </div>
    }
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      <div class="film-card">
        <div class="film-card-head">
          <span class="film-card-result" [class.is-win]="model().title.win" [class.is-loss]="!model().title.win">{{ model().title.win ? 'Win' : 'Loss' }}</span>
          <h2 class="film-card-headline">{{ c.headline }}</h2>
          @if (c.scoreline.length) {
            <ul class="list-clean film-card-scoreline" aria-label="Scoreline">
              @for (s of c.scoreline; track s.label) {
                <li class="score-chip" [class.is-good]="s.good === true" [class.is-bad]="s.good === false">
                  @if (s.ours) { <small>{{ s.label }}</small><b #num [attr.data-count]="s.ours"></b>@if (s.theirs) { <em>–<span #num [attr.data-count]="s.theirs"></span></em> } } @else { <b>{{ s.label }}</b> }
                </li>
              }
            </ul>
          }
        </div>

        @if (c.oneThing) {
          <div class="film-card-block is-warn" [style.--i]="0">
            <p class="film-card-label">Watch for it next game</p>
            <p class="film-card-text">{{ c.oneThing }}</p>
          </div>
        }

        @if (commitLine(); as line) {
          <div class="film-card-block" [style.--i]="1">
            <p class="film-card-label">We committed to</p>
            <p class="film-card-text">
              {{ line }}
              <span class="film-initials">
                @for (ini of initials(); track ini) { <span class="film-initial">{{ ini }}</span> }
              </span>
            </p>
          </div>
        }

        @if (asks().length) {
          <ul class="list-clean film-card-asks" aria-label="One ask each">
            @for (a of asks(); track a.seat) {
              <li class="film-card-ask" [class.is-me]="a.seat === mySeat()" [style.--i]="2 + $index">
                <img [src]="ui.championIconUrl(a.champion)" alt="" loading="lazy" />
                <span><b>{{ a.name }}</b><small>{{ a.seat }}</small>{{ a.ask }}</span>
              </li>
            }
          </ul>
        }

        @if (c.keepDoing) {
          <div class="film-card-row">
            <span class="film-card-keep"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span> {{ c.keepDoing }}</span>
          </div>
        }

        <label class="field-check film-card-ask-again">
          <input type="checkbox" [checked]="askAgain()" (change)="askAgainChange.emit($any($event.target).checked)" />
          <span>Ask me again before the next game</span>
        </label>

        <div class="film-card-actions">
          <button type="button" class="view-btn active" (click)="copy()"><span class="material-symbols-rounded" aria-hidden="true">content_copy</span> Copy for Discord</button>
          <a class="view-btn" [routerLink]="['/games']" [queryParams]="{ match: model().matchId, tab: 'games' }"><span class="material-symbols-rounded" aria-hidden="true">arrow_back</span> Back to the game</a>
          <button type="button" class="view-btn" (click)="watchAgain.emit()"><span class="material-symbols-rounded" aria-hidden="true">replay</span> Watch again</button>
        </div>
      </div>
    </app-film-frame>
  `
})
export class FilmCardComponent {
  readonly model = input.required<FilmModel>();
  readonly review = input.required<GameReview>();
  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly opponent = input<string | undefined>(undefined);
  readonly ledger = input<LedgerSummary | undefined>(undefined);
  readonly kicker = input<string>('The card');
  readonly index = input<number>(3);
  readonly count = input<number>(1);
  /** Whether the reminder is on; the page keeps it in the progress. */
  readonly askAgain = input<boolean>(true);
  readonly askAgainChange = output<boolean>();
  readonly watchAgain = output<void>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly nums = viewChildren<ElementRef<HTMLElement>>('num');

  constructor() {
    // The scoreline's figures count up from nothing, one chip after the next.
    afterRenderEffect((onCleanup) => {
      const els = this.nums().map((r) => r.nativeElement);
      if (!els.length) return;
      untracked(() => onCleanup(countAll(this.motion, els, 800, 60)));
    });
  }

  protected readonly mySeat = computed<Role | undefined>(() => this.prefs.filmSeat());
  /** Own seat first, the rest in lane order. */
  protected readonly asks = computed(() => {
    const mine = this.mySeat();
    const asks = this.model().card.asks;
    return mine ? [...asks.filter((a) => a.seat === mine), ...asks.filter((a) => a.seat !== mine)] : asks;
  });
  private readonly commitment = computed(() => this.data.commitmentFor(this.model().matchId));
  private readonly teamChoice = computed<FilmChoice | undefined>(() => {
    const c = this.commitment();
    return c && Object.keys(c.by).length ? this.data.teamChoice(c) : undefined;
  });
  protected readonly commitLine = computed(() => {
    const c = this.commitment();
    const choice = this.teamChoice();
    if (!c || !choice) return '';
    return choice === 'commit' || !c.options ? c.text : c.options[choice === 'a' ? 0 : 1];
  });
  protected readonly initials = computed(() => {
    const c = this.commitment();
    const choice = this.teamChoice();
    if (!c || !choice) return [];
    return Object.entries(c.by)
      .filter(([, v]) => v === choice)
      .map(([key]) => initialsOf(key));
  });

  private link(path: string[], query?: Record<string, string>): string {
    const url = this.router.serializeUrl(this.router.createUrlTree(path, query ? { queryParams: query } : {}));
    return `${window.location.origin}${this.location.prepareExternalUrl(url)}`;
  }

  protected async copy(): Promise<void> {
    const r = this.review();
    const id = this.model().matchId;
    const notes = Object.values(this.data.notesFor(id)?.notes ?? {})
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((n) => `(${initialsOf(n.by)}) ${n.text}`);
    const text = reviewAsText(r, this.game(), this.opponent(), this.link(['/games'], { match: id, tab: 'games' }), this.ledger(), {
      filmLink: this.link(['/film', id]),
      commitment: this.commitLine(),
      notes
    });
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show('Card copied', { kind: 'ok', icon: 'content_copy', text: 'Paste it in the team chat; the commitment and the film link are in it.' });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; select the text and copy it by hand.' });
    }
  }
}
