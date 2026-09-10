import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { AnalysisGame, FilmChoice, GameReview, ReviewPoint, ReviewSwap, ReviewTheme } from '../models/team.models';
import { askOf, GAIN_LABELS, reviewAsText, scoreline } from '../core/review-view';
import { initialsOf } from '../core/initials';
import { MatchTimelineService } from '../services/match-timeline.service';
import { TeamDataService } from '../services/team-data.service';
import { ToastService } from '../services/toast.service';
import { UiService } from '../services/ui.service';
import { FilmPosterComponent } from './film/film-poster.component';
import { InfoTipComponent } from './info-tip.component';
import { PlayerMarkComponent } from './player-mark.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * The short review of one game (9 Sep 2026): the poster that opens the film
 * room, the headline over the scoreline, the game as a strip of minute pills
 * (tap one for its sentence), the first thing next game as one line, one
 * Keep doing, one ask per player, and what the team committed to. Read-only,
 * apart from copying itself as text for the team chat; the button that
 * writes a review lives on the row.
 *
 * Everything with depth lives in the film room now: the summary and the comp
 * reasoning, the other work-ons and keep-doings, the strengths, each
 * player's further points, and the death ledger, which the film's map
 * chapter takes over in the next cut. The timeline is still read here for
 * the ledger's one line in the chat copy.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, TooltipDirective, InfoTipComponent, PlayerMarkComponent, FilmPosterComponent],
  template: `
    @if (review(); as r) {
      <details class="intel-collapse game-review" [open]="open() || fresh()" aria-label="Game review">
        <summary class="game-review-toggle">
          <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
          <strong>Review</strong>
          <span class="game-review-headline">{{ r.team.headline || 'Read the review' }}</span>
          <span class="tag" [appTip]="r.tier === 'timeline' ? 'Read from Riot\\'s minute-by-minute timeline' : 'A replay carries end-of-game totals only; nothing here is timed'">
            {{ r.tier === 'timeline' ? 'From the timeline' : 'Totals only' }}
          </span>
          <span class="material-symbols-rounded intel-collapse-chevron" aria-hidden="true">chevron_right</span>
        </summary>
        <div class="game-review-body">
        <app-film-poster [review]="r" [game]="game()" [opponent]="opponent()" size="row" />

        <div class="game-review-head">
          <span class="game-review-verdict" [class.is-good]="r.team.compVerdict === 'as drafted'" [class.is-bad]="r.team.compVerdict === 'off plan'"
                [appTip]="r.team.compWhy || 'Whether the comp did what its four axes and game plan expected'">
            {{ r.compName ? r.compName + ': ' : 'Comp: ' }}{{ r.team.compVerdict }}
          </span>
          <button type="button" class="view-btn game-review-copy" (click)="copy()" appTip="Copies a short version for the team chat: the headline and scoreline, the first thing next game, one Keep doing, one ask per player, the commitment and the film room's link. The figures stay in the film.">
            <span class="material-symbols-rounded" aria-hidden="true">content_copy</span> Copy for Discord
          </button>
        </div>

        @if (score().length) {
          <ul class="list-clean game-review-scoreline" aria-label="Scoreline">
            @for (c of score(); track c.label) {
              <li class="score-chip" [class.is-good]="c.good === true" [class.is-bad]="c.good === false">
                @if (c.ours) { <small>{{ c.label }}</small><b>{{ c.ours }}</b>@if (c.theirs) { <em>–{{ c.theirs }}</em> } } @else { <b>{{ c.label }}</b> }
              </li>
            }
          </ul>
        }

        @if (moments().length) {
          <div class="game-review-moment-strip" [class.is-untimed]="!timed()">
            <div class="moment-strip-row" role="group" aria-label="The game in moments">
              @for (m of moments(); track $index) {
                <button type="button" class="moment-minute" [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'" [class.active]="picked() === $index"
                        [attr.aria-pressed]="picked() === $index" [attr.aria-label]="timed() ? 'Minute ' + m.minute : 'Moment ' + ($index + 1)" (click)="pick($index)">
                  @if (timed()) { {{ m.minute }}<small>min</small> } @else { <span class="moment-dot" aria-hidden="true"></span> }
                </button>
              }
            </div>
            @if (pickedMoment(); as m) {
              <p class="moment-picked" [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'">{{ m.text }}</p>
            } @else {
              <p class="moment-picked muted">Tap a minute for what happened there.</p>
            }
          </div>
        }

        @if (first(); as f) {
          <p class="game-review-line-one is-warn">
            <b>First thing next game</b>
            @if (f.theme) { <span class="review-theme" [appTip]="f.theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(f.theme) }}</span></span> }
            @if (f.minute !== null && timed()) { <span class="review-minute">{{ f.minute }} min</span> }
            <span>{{ oneThing() || ask(f.text) }}</span>
          </p>
        }
        @if (keep(); as k) {
          <p class="game-review-line-one is-ok">
            <b>Keep doing</b>
            @if (k.theme) { <span class="review-theme" [appTip]="k.theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(k.theme) }}</span></span> }
            <span>{{ ask(k.text) }}</span>
          </p>
        }

        @if (asks().length) {
          <ul class="list-clean game-review-asks" aria-label="One ask each">
            @for (p of asks(); track p.name) {
              <li class="game-review-line-one is-person">
                <app-player-mark [name]="p.name" />
                <b [appTip]="p.seat + ' · ' + p.champion">{{ p.name }}</b>
                <span>{{ ask(p.workOn.text) }}</span>
              </li>
            }
          </ul>
        }

        @if (commitLine(); as c) {
          <p class="game-review-line-one is-commit">
            <span class="material-symbols-rounded" aria-hidden="true">handshake</span>
            <b>We committed to</b>
            <span>{{ c }}@if (initials().length) { <small class="game-review-initials">({{ initials().join(', ') }})</small> }</span>
          </p>
        }

        @for (s of draftSwaps(); track s.seat + ':' + s.in) {
          <!-- The draft with hindsight, one line a swap (10 Sep 2026): the why is cut to the line here; the film's draft chapter has the whole of it. -->
          <p class="game-review-draft" [appTip]="s.why">
            <img class="player-mark is-out" [src]="ui.championIconUrl(s.out)" alt="" loading="lazy" />
            <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            <img class="player-mark is-in" [src]="ui.championIconUrl(s.in)" alt="" loading="lazy" />
            <span><b>{{ s.in }}</b> for {{ ui.championName(s.out) }}{{ gainsOf(s) }}&#8195;<span class="game-review-draft-why">{{ s.why }}</span></span>
          </p>
        }

        <p class="muted game-review-foot">
          Written {{ r.reviewedAt | date: 'd MMM, HH:mm' }} by {{ models() }} for about {{ cost() }}{{ r.trigger === 'auto' ? ', by the morning run' : '' }}.
          <app-info-tip text="Every point should match a fact in How the game went; if one does not, the review is wrong, not the game. The reasoning and the figures are in the film room." label="How to read the review" />
        </p>
        </div>
      </details>
    }
  `
})
export class GameReviewComponent {
  readonly review = input<GameReview | undefined>(undefined);
  /** The game the review is about, for the scoreline and the poster. */
  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly opponent = input<string | undefined>(undefined);
  /** Start open: the row the page was asked to show. A review written in the last few minutes opens itself too. */
  readonly open = input<boolean>(false);

  private readonly timelines = inject(MatchTimelineService);
  private readonly data = inject(TeamDataService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly ui = inject(UiService);

  /** The timeline the drawer reads too; only its ledger summary is used here, for the chat copy. */
  private readonly timeline = computed(() => {
    const id = this.review()?.matchId;
    return id ? (this.timelines.known().get(id) ?? null) : null;
  });
  protected readonly moments = computed(() => this.review()?.team.moments ?? []);
  /** A replay review has no minutes behind it, so dots instead of minute pills. */
  protected readonly timed = computed(() => this.review()?.tier === 'timeline');
  protected readonly fresh = computed(() => {
    const at = Date.parse(this.review()?.reviewedAt ?? '');
    return Number.isFinite(at) && Date.now() - at < 5 * 60_000;
  });

  /** The moment whose sentence is open; one at a time, none to start. */
  protected readonly picked = signal<number | null>(null);
  protected readonly pickedMoment = computed(() => {
    const i = this.picked();
    return i === null ? undefined : this.moments()[i];
  });

  constructor() {
    effect(() => {
      const r = this.review();
      if (!r || r.tier !== 'timeline') return;
      if (this.timelines.known().has(r.matchId)) return;
      void this.timelines.load(r.matchId);
    });
    // A re-review rewrites the moments, so the open one would point at another sentence.
    effect(() => {
      this.moments();
      this.picked.set(null);
    });
  }

  protected pick(index: number): void {
    this.picked.set(this.picked() === index ? null : index);
  }

  /** The game on the Games page, as a link a teammate can open from the chat. */
  private gameLink(matchId: string): string {
    return this.absolute(this.router.createUrlTree(['/games'], { queryParams: { match: matchId, tab: 'games' } }));
  }

  private filmLink(matchId: string): string {
    return this.absolute(this.router.createUrlTree(['/film', matchId]));
  }

  private absolute(tree: UrlTree): string {
    const path = this.router.serializeUrl(tree);
    return `${window.location.origin}${this.location.prepareExternalUrl(path)}`;
  }

  private static readonly ICONS: Record<ReviewTheme, string> = {
    draft: 'swords',
    lanes: 'alt_route',
    fights: 'local_fire_department',
    objectives: 'flag',
    vision: 'visibility',
    tempo: 'schedule',
    macro: 'map'
  };

  protected icon(theme: ReviewTheme): string {
    return GameReviewComponent.ICONS[theme] ?? 'label';
  }

  protected ask(text: string): string {
    return askOf(text);
  }

  protected readonly score = computed(() => scoreline(this.game()));
  protected readonly first = computed<ReviewPoint | undefined>(() => this.review()?.team.workOn[0]);
  /** The model's own one thing (review version 4); the line falls back to the first work-on as an ask. */
  protected readonly oneThing = computed(() => this.review()?.team.oneThing?.trim() ?? '');
  protected readonly keep = computed<ReviewPoint | undefined>(() => this.review()?.team.keepDoing[0]);
  protected readonly asks = computed(() => (this.review()?.players ?? []).filter((p) => p.workOn.text));
  /** The draft with hindsight (review version 5): the swaps to try, none when the draft held, so the panel stays short. */
  protected readonly draftSwaps = computed<ReviewSwap[]>(() => this.review()?.team.draft?.swaps ?? []);

  /** ", for the peel and engage": what the swap buys, as the tail of the line in sentence case; nothing when the review named no gain. */
  protected gainsOf(s: ReviewSwap): string {
    return s.gains.length ? `, for the ${s.gains.map((g) => GAIN_LABELS[g].toLowerCase()).join(' and ')}` : '';
  }

  /** What the team committed to in the film room, and who picked it. */
  private readonly commitment = computed(() => this.data.commitmentFor(this.review()?.matchId));
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

  protected async copy(): Promise<void> {
    const r = this.review();
    if (!r) return;
    const notes = Object.values(this.data.notesFor(r.matchId)?.notes ?? {})
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((n) => `(${initialsOf(n.by)}) ${n.text}`);
    try {
      await navigator.clipboard.writeText(
        reviewAsText(r, this.game(), this.opponent(), this.gameLink(r.matchId), this.timeline()?.facts?.ledgerSummary, {
          filmLink: this.filmLink(r.matchId),
          commitment: this.commitLine(),
          notes,
          // The swaps to try, so the chat copy says what to draft next time (10 Sep 2026); "out" is Riot's id, said the display way.
          draft: r.team.draft,
          championName: (name) => this.ui.championName(name)
        })
      );
      this.toast.show('Review copied', { kind: 'ok', icon: 'content_copy', text: 'Paste it in the team chat; the headline, the points, every player’s ask and the film room’s link are in it.' });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; select the text and copy it by hand.' });
    }
  }

  protected readonly models = computed(() => {
    const r = this.review();
    if (!r) return '';
    const short = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return r.models.team === r.models.players ? short(r.models.team) : `${short(r.models.team)} and ${short(r.models.players)}`;
  });

  protected readonly cost = computed(() => {
    const usd = this.review()?.usage.costUsd ?? 0;
    return usd < 0.01 ? 'a cent' : `${Math.round(usd * 100)} cents`;
  });
}
