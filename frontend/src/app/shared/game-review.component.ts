import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { AnalysisGame, FilmChoice, GameReview, ReviewPoint, ReviewSwap, ReviewTheme, Role } from '../models/team.models';
import { alternativesPhrase, askOf, gainsPhrase, reviewAsText, reviewSource, THEME_GLYPHS } from '../core/review-view';
import type { FilmGlyph } from '../core/film-model';
import { DecidedByComponent } from './review/decided-by.component';
import { ReviewPointComponent } from './review/review-point.component';
import { ReviewSeatComponent } from './review/review-seat.component';
import { FilmGlyphComponent } from './film/film-glyph.component';
import { initialsOf } from '../core/initials';
import { MatchTimelineService } from '../services/match-timeline.service';
import { ReviewTakeoverService } from '../services/review-takeover.service';
import { TeamDataService } from '../services/team-data.service';
import { ToastService } from '../services/toast.service';
import { UiService } from '../services/ui.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { FilmPosterComponent } from './film/film-poster.component';
import { InfoTipComponent } from './info-tip.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * The short review of one game (9 Sep 2026): the poster that opens the film
 * room, what decided the game, the game as a strip of minute pills (tap one
 * for its sentence), the first thing next game with the two choices it
 * offers, then every work-on, every keep-doing and every player's ask as
 * `app-review-point` — a glyph and the figures, with the sentence behind the
 * info tip. Read-only, apart from copying itself as text for the team chat;
 * the button that writes a review lives on the row.
 *
 * Team or My seat is a switch over the same review (12 Sep 2026). The seat is
 * `UserPrefs.film.seat`, which the person picked in the film room's Your seat
 * chapter: there is no email-to-player link in this app — `Player` carries no
 * email and `AccessEntry` no player id — so a first-run picker asks rather
 * than guessing from who is signed in, and the choice of view is remembered
 * per browser under `bom-review-view`.
 *
 * The panel is a dashboard and the film room is the story (12 Sep 2026). It
 * used to print two of the five team points as paragraphs and never render an
 * `evidence` string at all, which is how it managed to be both long and
 * incomplete. The summary, the comp reasoning, the strengths, each player's
 * further points and the death ledger are still the film's. The timeline is
 * read here for the ledger's one line in the chat copy.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, TooltipDirective, InfoTipComponent, FilmPosterComponent, DecidedByComponent, FilmGlyphComponent, ReviewPointComponent, ReviewSeatComponent],
  template: `
    @if (review(); as r) {
      <details class="intel-collapse game-review" [open]="open() || fresh() || takeover.ready(r.matchId)" aria-label="Game review">
        <summary class="game-review-toggle">
          <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
          <strong>Review</strong>
          <span class="game-review-headline">{{ r.team.headline || 'Read the review' }}</span>
          <span class="tag" [appTip]="sourceTip()">{{ sourceTag() }}</span>
          <span class="material-symbols-rounded intel-collapse-chevron" aria-hidden="true">chevron_right</span>
        </summary>
        <div class="game-review-body">
        <app-film-poster [review]="r" [game]="game()" [opponent]="opponent()" size="row" />

        <app-decided-by [review]="r" />

        <div class="game-review-head">
          <!-- Team or the reader's own seat (12 Sep 2026). A person opening a review looks for their own
               name first; five equal rows made them hunt for it, and made the panel five rows longer. -->
          <div class="view-segment game-review-views" role="group" aria-label="Review view">
            <button type="button" [class.active]="view() === 'team'" (click)="setView('team')">Team</button>
            <button type="button" [class.active]="view() === 'seat'" (click)="setView('seat')">My seat</button>
          </div>
          <span class="game-review-verdict" [class.is-good]="r.team.compVerdict === 'as drafted'" [class.is-bad]="r.team.compVerdict === 'off plan'"
                [appTip]="r.team.compWhy || 'Whether the comp did what its four axes and game plan expected'">
            {{ r.compName ? r.compName + ': ' : 'Comp: ' }}{{ r.team.compVerdict }}
          </span>
          <button type="button" class="view-btn game-review-copy" (click)="copy()" appTip="Copies a short version for the team chat: the headline and scoreline, the first thing next game, one Keep doing, one ask per player, the commitment and the film room's link. The figures stay in the film.">
            <span class="material-symbols-rounded" aria-hidden="true">content_copy</span> Copy for Discord
          </button>
        </div>

        @if (view() === 'team' && moments().length) {
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
          <div class="review-one-thing">
            <p class="game-review-line-one is-warn">
              <b>First thing next game</b>
              @if (f.theme) { <app-film-glyph class="review-point-glyph" [name]="glyphOf(f.theme)" [appTip]="f.theme" /> }
              <span class="review-one-thing-said">{{ oneThing() || ask(f.text) }}</span>
            </p>
            <!--
              The two choices the coach offered, which the schema has carried since version 4 and
              this panel has never shown. They are the difference between a note and a decision: the
              film's One thing chapter has always split on them and the panel printed the sentence
              they came from instead.
            -->
            @if (f.options?.length === 2) {
              <p class="review-options">
                @for (o of f.options; track o) { <span class="view-btn is-static">{{ o }}</span> }
              </p>
            }
          </div>
        }
        <!--
          Every point of the review, as its own figures (12 Sep 2026). The panel used to print the
          first work-on and the first keep-doing as sentences and drop the other three on the floor;
          the evidence strings, which are the part written in the team's own jargon, it never
          rendered at all. Now all five stand, each as a glyph and its figures, and the sentences
          they came from are one hover away. Fewer words on screen and more of the review reachable.
        -->
        @if (view() === 'team' && workOns().length) {
          <div class="review-points" role="group" aria-label="Work on">
            <h4 class="review-group-label is-warn">Work on</h4>
            @for (w of workOns(); track $index) {
              <app-review-point [point]="w" tone="warn" [timed]="timed()" />
            }
          </div>
        }

        @if (view() === 'team' && keeps().length) {
          <div class="review-points" role="group" aria-label="Keep doing">
            <h4 class="review-group-label is-ok">Keep doing</h4>
            @for (k of keeps(); track $index) {
              <app-review-point [point]="k" tone="ok" [timed]="timed()" />
            }
          </div>
        }

        @if (view() === 'seat') {
          <!-- The reader's own seat: the one the film room remembers, asked for here the first time. -->
          @if (!seat() || picking()) {
            <div class="review-seat-pick">
              <p class="muted">Which seat is yours? The film room remembers it.</p>
              <div class="review-seat-pick-row">
                @for (s of SEATS; track s) {
                  <button type="button" class="view-btn" (click)="pickSeat(s)">{{ s }}</button>
                }
              </div>
            </div>
          } @else if (mine(); as m) {
            <app-review-seat [player]="m" [game]="game()" [mine]="true" [timed]="timed()" />
            @if (others().length) {
              <div class="review-points" role="group" aria-label="The other four">
                <h4 class="review-group-label">The other four</h4>
                @for (o of others(); track o.name) {
                  <app-review-seat [player]="o" [game]="game()" [timed]="timed()" />
                }
              </div>
            }
          } @else {
            <p class="muted review-seat-none">No {{ seat() }} in this review — it is not a game you played. <button type="button" class="view-btn" (click)="clearSeat()">Pick another seat</button></p>
            @if (asks().length) {
              <div class="review-points" role="group" aria-label="One ask each">
                @for (o of asks(); track o.name) {
                  <app-review-seat [player]="o" [game]="game()" [timed]="timed()" />
                }
              </div>
            }
          }
        }

        @if (commitLine(); as c) {
          <p class="game-review-line-one is-commit">
            <span class="material-symbols-rounded" aria-hidden="true">handshake</span>
            <b>We committed to</b>
            <span>{{ c }}@if (initials().length) { <small class="game-review-initials">({{ initials().join(', ') }})</small> }</span>
          </p>
        }

        @if (view() === 'team') {
        @for (s of draftSwaps(); track s.seat + ':' + s.in) {
          <!-- The draft with hindsight, one line a swap (10 Sep 2026): the why is cut to the line here; the film's draft chapter has the whole of it.
               Since review version 6 the swap's other options follow the champion, "Nautilus, or Braum for Leona"; the gaps the comp lacked stay in the film. -->
          <p class="game-review-draft" [appTip]="s.why">
            <img class="player-mark is-out" [src]="ui.championIconUrl(s.out)" alt="" loading="lazy" />
            <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            <img class="player-mark is-in" [src]="ui.championIconUrl(s.in)" alt="" loading="lazy" />
            <span><b>{{ s.in }}</b>@if (altsOf(s); as alts) {<span class="game-review-draft-alt">, {{ alts }}</span>} for {{ ui.championName(s.out) }}{{ gainsOf(s) }}&#8195;<span class="game-review-draft-why">{{ s.why }}</span></span>
          </p>
        }
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
  /** The one seat this app stores about a person: what they picked in the film room's Your seat chapter. */
  private readonly prefs = inject(UserPrefsService);
  /** The takeover's landing mark (10 Sep 2026): the poster it rings lives in this drawer, so a review that landed while the takeover was minimised opens the drawer rather than lighting a pill behind a closed one. */
  protected readonly takeover = inject(ReviewTakeoverService);

  /** The timeline the drawer reads too; only its ledger summary is used here, for the chat copy. */
  private readonly timeline = computed(() => {
    const id = this.review()?.matchId;
    return id ? (this.timelines.known().get(id) ?? null) : null;
  });
  protected readonly moments = computed(() => this.review()?.team.moments ?? []);
  /**
   * Which of the three roads the review came down, and so whether the strip
   * shows minute pills or dots. Riot's timeline is one road; the local
   * recorder's walk through the replay is the other (review version 7,
   * 11 Sep 2026) — a recorded review is written off minute-by-minute lines
   * and frames, and calling it untimed threw all of that away.
   */
  private readonly source = computed(() => reviewSource(this.review()));
  protected readonly timed = computed(() => this.source().timed);
  protected readonly sourceTag = computed(() => this.source().tag);
  protected readonly sourceTip = computed(() => this.source().tip);
  protected readonly fresh = computed(() => {
    const at = Date.parse(this.review()?.reviewedAt ?? '');
    return Number.isFinite(at) && Date.now() - at < 5 * 60_000;
  });

  /**
   * Team or My seat, remembered across every review on the page (12 Sep 2026). A person who has
   * said which seat is theirs almost always wants the same view next time, and localStorage is the
   * right home for it: it is a per-browser convenience, not a team fact, and a panel that opened on
   * the wrong view would cost a click on every row.
   */
  private static readonly VIEW_KEY = 'bom-review-view';
  protected readonly view = signal<'team' | 'seat'>(GameReviewComponent.storedView());
  protected readonly SEATS: Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

  private static storedView(): 'team' | 'seat' {
    try {
      return localStorage.getItem(GameReviewComponent.VIEW_KEY) === 'seat' ? 'seat' : 'team';
    } catch {
      return 'team';
    }
  }

  protected setView(view: 'team' | 'seat'): void {
    this.view.set(view);
    try {
      localStorage.setItem(GameReviewComponent.VIEW_KEY, view);
    } catch {
      /* a browser refusing storage still gets the view it clicked */
    }
  }

  /** The seat this person said is theirs in the film room; undefined until they have. */
  protected readonly seat = computed(() => this.prefs.filmSeat());
  protected readonly mine = computed(() => this.asks().find((p) => p.seat === this.seat()));
  protected readonly others = computed(() => this.asks().filter((p) => p.seat !== this.seat()));

  /** Open on the picker again, for the person whose stored seat is not one this game had. */
  protected readonly picking = signal(false);

  protected pickSeat(seat: Role): void {
    this.picking.set(false);
    void this.prefs.setFilmSeat(seat);
  }

  protected clearSeat(): void {
    this.picking.set(true);
  }

  /** The moment whose sentence is open; one at a time, none to start. */
  protected readonly picked = signal<number | null>(null);
  protected readonly pickedMoment = computed(() => {
    const i = this.picked();
    return i === null ? undefined : this.moments()[i];
  });

  constructor() {
    // The timeline is NOT loaded here (12 Sep 2026). `app-game-story` renders on this same open
    // row and loads the same document through the same de-duplicating service, so this was a second
    // call into a cache rather than a second read — and the one line it fed reaches Discord only.
    // It is read synchronously from that cache in `copy()`; putting the read inside `copy()` would
    // lose transient user activation and get the clipboard write refused.
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

  /**
   * The theme as one of the film's own glyphs.
   *
   * Material Symbols are this app's chrome and the thirty hand-drawn glyphs are its content
   * imagery; a theme is content. Three of the seven had no glyph until 12 Sep 2026, which is why
   * this used to reach for a Material icon and mix the two families on one line.
   */
  protected glyphOf(theme: ReviewTheme): FilmGlyph {
    return THEME_GLYPHS[theme] ?? 'flag';
  }

  protected ask(text: string): string {
    return askOf(text);
  }

  // The scoreline is NOT here any more (12 Sep 2026). The open row renders Win/Loss, kills, the
  // length and every objective count about 150px above this panel, so the panel was printing the
  // same eight figures a second time in the same drawer. `scoreline()` itself stays exactly where
  // it was: `reviewAsText` computes its own for the chat, and the film's card and the review
  // takeover each compute theirs, so nothing else notices.
  protected readonly first = computed<ReviewPoint | undefined>(() => this.review()?.team.workOn[0]);
  /** The model's own one thing (review version 4); the line falls back to the first work-on as an ask. */
  protected readonly oneThing = computed(() => this.review()?.team.oneThing?.trim() ?? '');
  /**
   * All of them, not the first of each (12 Sep 2026). The panel showed `workOn[0]` and
   * `keepDoing[0]` and dropped the other three; as chips, five lines cost less height than the two
   * paragraphs did, which is the whole trade this cut makes.
   */
  protected readonly workOns = computed<ReviewPoint[]>(() => this.review()?.team.workOn ?? []);
  protected readonly keeps = computed<ReviewPoint[]>(() => this.review()?.team.keepDoing ?? []);
  protected readonly asks = computed(() => (this.review()?.players ?? []).filter((p) => p.workOn.text));
  /** The draft with hindsight (review version 5): the swaps to try, none when the draft held, so the panel stays short. */
  protected readonly draftSwaps = computed<ReviewSwap[]>(() => this.review()?.team.draft?.swaps ?? []);

  /** ", for peel and engage": what the swap buys, as the tail of the line; nothing when the review named no gain. */
  protected gainsOf(s: ReviewSwap): string {
    const phrase = gainsPhrase(s.gains);
    return phrase ? `, ${phrase}` : '';
  }

  /** "or Braum, or Alistar": the swap's other options (review version 6), empty for a review that named none. */
  protected altsOf(s: ReviewSwap): string {
    return alternativesPhrase(s.alternatives);
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
