import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FilmModel, FilmSeat } from '../../../core/film-model';
import { evidenceChips } from '../../../core/review-view';
import { DeathVerdict, LedgerSummary, Role } from '../../../models/team.models';
import { MotionService } from '../../../services/motion.service';
import { UiService } from '../../../services/ui.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent, themeIcon } from '../film-frame.component';

/** The circumference of the presence ring, for the dash maths. */
const RING = 2 * Math.PI * 18;

/**
 * Your seat (9 Sep 2026): five tabs, the one that is yours remembered, and
 * the film's one real flip. The front is the seat's splash strip, stat line
 * and strength; the back is the work-on with the further points stacked
 * under it. This seat's deaths sit under the card as minute pills coloured
 * by what would have stopped them, and the jungler's presence on our kills
 * is a ring. With motion off the card swaps instead of turning.
 */
@Component({
  selector: 'app-film-seat',
  imports: [TooltipDirective, FilmFrameComponent],
  template: `
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      <div class="film-seat-tabs" role="tablist" aria-label="Seats">
        @for (s of model().seats; track s.seat) {
          <button type="button" class="film-seat-tab" role="tab" [class.active]="s.seat === selected()" [attr.aria-selected]="s.seat === selected()" (click)="select(s.seat)">
            <img [src]="ui.championIconUrl(s.champion)" alt="" loading="lazy" />
            <span>{{ s.seat }}</span>
          </button>
        }
      </div>

      @if (selected() !== mySeat()) {
        <p class="film-seat-ask">
          @if (!mySeat()) { Which seat is yours? }
          <button type="button" class="view-btn" [class.active]="!mySeat()" (click)="claim()">This is me</button>
        </p>
      }

      @if (seat(); as s) {
        <div class="film-flip" [class.is-flipped]="flipped()" [class.is-still]="motion.reduced()">
          <div class="film-flip-inner">
            <button type="button" class="film-flip-face is-front" (click)="flipped.set(true)" [attr.aria-hidden]="flipped()" [tabindex]="flipped() ? -1 : 0">
              <span class="film-seat-strip">
                <img class="film-splash" [src]="ui.championArtUrl(s.champion)" (error)="ui.artFallback($event, s.champion)" alt="" />
              </span>
              <span class="film-seat-who"><b>{{ s.name }}</b><small>{{ s.seat }} · {{ s.champion }}</small></span>
              @if (s.statLine) { <span class="film-seat-stats">{{ s.statLine }}</span> }
              <span class="film-seat-strength">
                <span class="film-seat-label is-ok"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span> Strength</span>
                <span>{{ s.strength.text || 'Nothing singled out.' }}</span>
              </span>
              <span class="film-flip-hint"><span class="material-symbols-rounded" aria-hidden="true">flip</span> Tap for the work-on</span>
            </button>
            <button type="button" class="film-flip-face is-back" (click)="flipped.set(false)" [attr.aria-hidden]="!flipped()" [tabindex]="flipped() ? 0 : -1">
              <span class="film-seat-label is-warn"><span class="material-symbols-rounded" aria-hidden="true">build</span> Work on</span>
              <span class="film-seat-workon">
                @if (timed() && s.workOn.minute !== null) { <span class="review-minute">{{ s.workOn.minute }} min</span> }
                {{ s.workOn.text || 'Nothing to work on from this game.' }}
              </span>
              @if (chips(s.workOn.evidence).length) {
                <span class="evidence-chips">
                  @for (c of chips(s.workOn.evidence); track $index) { <span class="evidence-chip">{{ c }}</span> }
                </span>
              }
              @if (s.more.length) {
                <span class="film-seat-more">
                  @for (m of s.more; track $index) {
                    <span class="film-seat-more-item">
                      @if (m.theme) { <span class="material-symbols-rounded" aria-hidden="true">{{ icon(m.theme) }}</span> }
                      {{ m.text }}
                    </span>
                  }
                </span>
              }
              <span class="film-flip-hint"><span class="material-symbols-rounded" aria-hidden="true">flip</span> Tap to turn back</span>
            </button>
          </div>
        </div>

        <div class="film-seat-under">
          @if (ledger()) {
            <div class="film-deaths" aria-label="This seat's deaths">
              <span class="film-deaths-label">{{ s.deaths.length ? 'Deaths' : 'No deaths' }}</span>
              @for (d of s.deaths; track $index) {
                <span [class]="'film-death is-' + tagOf(d)" [appTip]="d.line">{{ d.minute }}<small>min</small></span>
              }
            </div>
          } @else if (timed()) {
            <div class="film-deaths"><span class="film-deaths-label">No timeline read for this game yet</span></div>
          }
          @if (s.presence; as pr) {
            <div class="film-presence" [appTip]="pr.line">
              <svg class="film-ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle class="film-ring-track" cx="22" cy="22" r="18" />
                <circle class="film-ring-fill" cx="22" cy="22" r="18" [style.--film-ring-c]="ring" [style.stroke-dasharray]="ring" [style.stroke-dashoffset]="ringOffset(pr)" />
              </svg>
              <span class="film-presence-text"><b>{{ pr.kills }} of {{ pr.ofKills }}</b><small>of our kills with the jungler on them</small></span>
            </div>
          }
          <button type="button" class="view-btn" [class.active]="!gotIt()" (click)="got()">{{ gotIt() ? 'Got it' : 'Got it?' }}</button>
        </div>
      } @else {
        <p class="film-wait">The review carries no player notes for this game.</p>
      }
    </app-film-frame>
  `
})
export class FilmSeatComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('Your seat');
  readonly index = input<number>(2);
  readonly count = input<number>(1);
  readonly closeTick = input<number>(0);
  /** The calls already made, so a seat once acknowledged stays so. */
  readonly calls = input<Record<string, number> | undefined>(undefined);
  /** The ledger's summary when the timeline has been read: the deaths strip shows only then, whatever the tier says. */
  readonly ledger = input<LedgerSummary | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly ui = inject(UiService);
  protected readonly motion = inject(MotionService);
  private readonly prefs = inject(UserPrefsService);

  protected readonly ring = RING;
  private readonly chosen = signal<Role | undefined>(undefined);
  protected readonly flipped = signal(false);
  private readonly gotNow = signal<ReadonlySet<Role>>(new Set());

  protected readonly selected = computed<Role>(() => {
    const seats = this.model().seats;
    const wanted = this.chosen() ?? this.prefs.filmSeat() ?? 'Top';
    return seats.some((s) => s.seat === wanted) ? wanted : (seats[0]?.seat ?? 'Top');
  });
  protected readonly seat = computed<FilmSeat | undefined>(() => this.model().seats.find((s) => s.seat === this.selected()));
  /** The seat this person said is theirs; the This is me pill shows on any other, so a wrong claim can be put right. */
  protected readonly mySeat = computed<Role | undefined>(() => this.prefs.filmSeat());
  protected readonly timed = computed(() => this.model().tier === 'timeline');
  protected readonly gotIt = computed(() => this.gotNow().has(this.selected()) || !!this.calls()?.['seat:' + this.selected()]);

  constructor() {
    effect(() => {
      this.closeTick();
      this.flipped.set(false);
    });
  }

  protected select(seat: Role): void {
    this.chosen.set(seat);
    this.flipped.set(false);
  }

  protected claim(): void {
    void this.prefs.setFilmSeat(this.selected());
  }

  protected got(): void {
    const seat = this.selected();
    this.gotNow.set(new Set([...this.gotNow(), seat]));
    this.answered.emit({ key: 'seat:' + seat, choice: 1 });
  }

  /** The first tag on a death colours its pill; a death nothing would have stopped is plain. */
  protected tagOf(d: DeathVerdict): string {
    return d.could[0] ?? 'none';
  }

  protected ringOffset(pr: { kills: number; ofKills: number }): number {
    const share = pr.ofKills > 0 ? Math.min(1, pr.kills / pr.ofKills) : 0;
    return RING * (1 - share);
  }

  protected chips(evidence: string): string[] {
    return evidenceChips(evidence ?? '');
  }

  protected icon(theme: string | undefined): string {
    return themeIcon(theme);
  }
}
