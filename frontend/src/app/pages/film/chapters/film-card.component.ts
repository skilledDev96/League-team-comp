import { Location } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, input, output, untracked, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FilmModel } from '../../../core/film-model';
import { reminderFor } from '../../../core/film-progress';
import { gainsPhrase, reviewAsText } from '../../../core/review-view';
import { AnalysisGame, FilmChoice, GameReview, LedgerSummary, ReviewSwap, Role } from '../../../models/team.models';
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
 * commitment with the initials of who picked, Call it back (the review's
 * lessons, version 4, each a question with three chips and the fact after the
 * pick; a pick is a call in the progress), one ask per player with your own
 * seat first, one keep-doing, and the toggle that asks you again before the
 * next game. Copy for Discord carries the same review text
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

        @if (model().lessons; as lessons) {
          <div class="film-card-block film-card-lessons" [style.--i]="2">
            <p class="film-card-label">Call it back</p>
            @for (l of lessons; track l.key) {
              @let picked = pickOf(l.key);
              <div class="film-card-lesson" [class.is-done]="picked !== null">
                <p class="film-call-q film-card-lesson-q">{{ l.question }}</p>
                <div class="film-chips" role="group" [attr.aria-label]="l.question">
                  @for (opt of l.options; track opt; let i = $index) {
                    <button
                      type="button"
                      class="film-chip"
                      [class.is-right]="picked !== null && i === l.answer"
                      [class.is-wrong]="picked === i && i !== l.answer"
                      [class.is-picked]="picked === i"
                      [disabled]="picked !== null"
                      [attr.aria-pressed]="picked === i"
                      (click)="answered.emit({ key: l.key, choice: i })"
                    >{{ opt }}</button>
                  }
                </div>
                @if (picked !== null) {
                  <p class="film-call-why"><b>{{ picked === l.answer ? 'Called it.' : 'Not this time.' }}</b> {{ l.why }}</p>
                }
              </div>
            }
          </div>
        }

        @if (draftSwaps().length) {
          <!-- The draft with hindsight (10 Sep 2026): one line a swap, the champion we played struck beside the one to try. -->
          <div class="film-card-block film-card-draft" [style.--i]="3">
            <p class="film-card-label">Next time in the draft</p>
            @for (s of draftSwaps(); track s.seat + ':' + s.in) {
              <p class="film-card-draft-row">
                <img class="is-out" [src]="ui.championIconUrl(s.out)" alt="" loading="lazy" />
                <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                <img class="is-in" [src]="ui.championIconUrl(s.in)" alt="" loading="lazy" />
                <span><b>{{ s.in }}</b> for {{ ui.championName(s.out) }}@if (s.gains.length) { <small>· {{ gainsOf(s) }}</small> }</span>
              </p>
            }
          </div>
        }

        @if (asks().length) {
          <ul class="list-clean film-card-asks" aria-label="One ask each">
            @for (a of asks(); track a.seat) {
              <li class="film-card-ask" [class.is-me]="a.seat === mySeat()" [style.--i]="askBase() + $index">
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

        <div class="film-card-ask-row">
          <label class="field-check film-card-ask-again">
            <input type="checkbox" [checked]="askAgain()" (change)="askAgainChange.emit($any($event.target).checked)" />
            <span>Ask me again before the next game</span>
          </label>
          <button type="button" class="view-btn film-card-try" (click)="tryNow()"><span class="material-symbols-rounded" aria-hidden="true">bolt</span> Try it now</button>
        </div>

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
  /** The calls made so far, keyed as the model keys them; a lesson called here stays called. */
  readonly calls = input<Record<string, number> | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
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
  /** The option called on one lesson, or null while it is still open. */
  protected pickOf(key: string): number | null {
    const v = this.calls()?.[key];
    return typeof v === 'number' ? v : null;
  }
  /** Own seat first, the rest in lane order. */
  protected readonly asks = computed(() => {
    const mine = this.mySeat();
    const asks = this.model().card.asks;
    return mine ? [...asks.filter((a) => a.seat === mine), ...asks.filter((a) => a.seat !== mine)] : asks;
  });
  /** The swaps to try next draft (review version 5); none when the draft held, and the block stays away. */
  protected readonly draftSwaps = computed<ReviewSwap[]>(() => this.model().draft?.swaps ?? []);
  /** Where the asks' entrance stagger starts: after the draft block when there is one. */
  protected readonly askBase = computed(() => (this.draftSwaps().length ? 4 : 3));

  /** "for peel and engage": what a swap buys, as a phrase after the champions, so the words lose the capital the chips carry. */
  protected gainsOf(s: ReviewSwap): string {
    return gainsPhrase(s.gains);
  }
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

  /**
   * Make the reminder due right now, so the Before you play card shows on
   * Games at once (editors and viewers alike; it is this person's own
   * progress). The ask count stays where it is, so the card asks the next
   * lesson in turn and the ladder carries on from there.
   */
  protected tryNow(): void {
    const id = this.model().matchId;
    const progress = this.prefs.filmProgress(id) ?? {};
    const item = reminderFor(this.review(), progress, this.commitment(), this.model().seed);
    if (!item) {
      this.toast.show('Nothing to ask yet', { kind: 'warn', text: 'No lessons in this review, and no commitment picked.' });
      return;
    }
    void this.prefs.saveFilmProgress(id, { nextAskAt: new Date().toISOString(), asked: progress.asked ?? 0 });
    this.toast.show('Reminder set', { kind: 'ok', icon: 'bolt', text: 'At the top of Games and in the roster quick actions. Ask me again is on.' });
  }

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
      notes,
      // What the card itself shows goes in the copy too (10 Sep 2026, second review): the swaps to try, and the film's reads of the deaths over the ledger's counts.
      draft: r.team.draft,
      reads: this.model().map?.reads,
      championName: (name) => this.ui.championName(name)
    });
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show('Card copied', { kind: 'ok', icon: 'content_copy', text: 'Paste it in the team chat; the commitment, the draft to try and the film link are in it.' });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; select the text and copy it by hand.' });
    }
  }
}
