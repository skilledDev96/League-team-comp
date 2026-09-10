import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked, viewChildren } from '@angular/core';
import { READ_LABELS } from '../../../core/death-reads';
import { FilmDeathPin, FilmGlyph, FilmModel, FilmSeat } from '../../../core/film-model';
import { evidenceChips } from '../../../core/review-view';
import { pick } from '../../../core/seed';
import { DeathVerdict, LedgerSummary, Role } from '../../../models/team.models';
import { MotionService } from '../../../services/motion.service';
import { UiService } from '../../../services/ui.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { ChampionMotionComponent } from '../../../shared/film/champion-motion.component';
import { countAll } from '../../../shared/film/film-count';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent, themeIcon } from '../film-frame.component';

type ClipSlot = 'P' | 'Q' | 'W' | 'E' | 'R';
const OTHER_SLOTS: readonly ClipSlot[] = ['Q', 'W', 'E'];

/** The circumference of the presence ring, for the dash maths. */
const RING = 2 * Math.PI * 18;

/** How long the new seat's layer takes to fade in over the old one (and the old to fade under it), before the tempo. */
const CROSSFADE_MS = 400;

/** The reads list under the card names at most this many deaths; a seat with more has the map for the rest. */
const MAX_READ_LINES = 6;

/**
 * A seat's stat line split so the figures can count: "8/3/2 · 312 CS" is
 * digits and the text between them. The key carries the seat, so a change
 * of seat remounts every span (a key built from the component's state alone
 * would read the same for the old row and the new, and Angular would reuse it).
 */
interface StatToken {
  key: string;
  num: boolean;
  text: string;
}

/**
 * Your seat (9 Sep 2026): five tabs, the one that is yours remembered, and
 * the film's one real flip, over the selected seat's champion in motion.
 * Changing seat lays the new champion's layer over the old, fades it in
 * while the old fades out beneath, then drops the old; only the top layer's
 * clip plays. The front of the card is
 * the seat's splash strip, stat line (its figures counting up as the card
 * shows) and strength; the back is the work-on with the further points
 * stacked under it. This seat's deaths sit under the card as minute pills:
 * when the film has read them (cut 4, 10 Sep 2026, `FilmSeat.pins`) each
 * pill wears its read's colour and glyph with the read's line as its tip,
 * and a short list under them says each read in a sentence, at most six;
 * without the reads they are coloured by what would have stopped them, as
 * before. The jungler's presence on our kills is a ring. With motion off the
 * card swaps instead of turning.
 */
@Component({
  selector: 'app-film-seat',
  imports: [TooltipDirective, FilmFrameComponent, ChampionMotionComponent, FilmGlyphComponent],
  template: `
    <div class="film-chapter-art" aria-hidden="true">
      @for (l of layers(); track l.id; let last = $last) {
        <app-champion-motion class="film-layer" [class.is-out]="!last" [champion]="l.champion" [slot]="l.slot" [active]="active() && last" />
      }
      <span class="film-chapter-shade"></span>
    </div>
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      <div class="film-seat-tabs" role="tablist" aria-label="Seats">
        @for (s of model().seats; track s.seat) {
          <button type="button" class="film-seat-tab" role="tab" [style.--i]="$index" [class.active]="s.seat === selected()" [attr.aria-selected]="s.seat === selected()" (click)="select(s.seat)">
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
              <span class="film-seat-who"><b>{{ s.name }}</b><small>{{ s.seat }} · {{ ui.championName(s.champion) }}</small></span>
              @if (s.statLine) {
                <span class="film-seat-stats">
                  <!-- Keyed by seat so a change of seat remounts the spans; a figure's text belongs to the counter alone, off data-count. -->
                  @for (tok of statTokens(); track tok.key) {
                    @if (tok.num) {
                      <span #num class="film-num" [attr.data-count]="tok.text"></span>
                    } @else {
                      <span>{{ tok.text }}</span>
                    }
                  }
                </span>
              }
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
              @if (s.pins; as pins) {
                @for (p of pins; track p.key) {
                  <span [class]="'film-death is-read-' + p.read" [style.--i]="$index" [appTip]="p.readLine"><app-film-glyph [name]="glyphOf(p)" />{{ p.minute }}<small>min</small></span>
                }
              } @else {
                @for (d of s.deaths; track d.seat + ':' + $index) {
                  <span [class]="'film-death is-' + tagOf(d)" [style.--i]="$index" [appTip]="d.line">{{ d.minute }}<small>min</small></span>
                }
              }
            </div>
            @if (readLines(s).length) {
              <div class="film-seat-reads">
                <!-- Anyone can read any seat: "Your" only when this one is the reader's. -->
                <span class="film-deaths-label">{{ s.seat === mySeat() ? 'Your deaths, read' : 'Deaths, read' }}</span>
                <ul class="list-clean film-seat-reads-list">
                  @for (p of readLines(s); track p.key) {
                    <li class="film-seat-read" [style.--i]="$index">
                      <span class="film-tape-min">{{ p.minute }} min</span>
                      <span [class]="'film-read-badge is-read-' + p.read" [appTip]="readLabels[p.read].tip"><app-film-glyph [name]="readLabels[p.read].icon" />{{ readLabels[p.read].label }}</span>
                      <span class="film-seat-read-line">{{ p.readLine }}</span>
                    </li>
                  }
                </ul>
                @if (moreOnMap(s); as n) {
                  <span class="film-deaths-label film-seat-reads-more">and {{ n }} more on the map</span>
                }
              </div>
            }
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
  /** True while this is the chapter on screen: the top layer's clip plays only then. */
  readonly active = input<boolean>(false);
  readonly answered = output<{ key: string; choice: number }>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly ui = inject(UiService);
  protected readonly motion = inject(MotionService);
  private readonly prefs = inject(UserPrefsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly nums = viewChildren<ElementRef<HTMLElement>>('num');

  protected readonly ring = RING;
  protected readonly readLabels = READ_LABELS;
  private readonly chosen = signal<Role | undefined>(undefined);
  protected readonly flipped = signal(false);
  private readonly gotNow = signal<ReadonlySet<Role>>(new Set());
  /** The champion layers behind the card: the top one is the selected seat's, the one under it is fading out. */
  protected readonly layers = signal<{ id: number; champion: string; slot: ClipSlot }[]>([]);
  private layerId = 0;
  /** The wait before the faded-out layer is dropped; cleared on the next change of seat and on destroy. */
  private layerTimer: ReturnType<typeof setTimeout> | undefined;

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
  protected readonly statTokens = computed<StatToken[]>(() => {
    const s = this.seat();
    const line = s?.statLine ?? '';
    return (line.match(/\d+|\D+/g) ?? []).map((text, i) => ({ key: `${s?.seat}:${i}`, num: /^\d+$/.test(text), text }));
  });

  constructor() {
    effect(() => {
      this.closeTick();
      this.flipped.set(false);
    });

    // The seat's champion goes on top; the old layer fades under it and is dropped once it has.
    effect(() => {
      const champion = this.seat()?.champion;
      if (!champion) return;
      untracked(() => this.layChampion(champion));
    });

    // The figures on the card's front count up whenever a seat's card is shown; the spans remount per seat, so this re-runs on a switch.
    afterRenderEffect((onCleanup) => {
      const els = this.nums().map((r) => r.nativeElement);
      if (!els.length) return;
      untracked(() => onCleanup(countAll(this.motion, els, 700, 60)));
    });

    this.destroyRef.onDestroy(() => clearTimeout(this.layerTimer));
  }

  /**
   * The title card already played the protagonist's ultimate, so their seat
   * shows another ability, picked by the match seed; every other seat gets
   * the ultimate.
   */
  private slotFor(champion: string): ClipSlot {
    const m = this.model();
    if (champion !== m.title.protagonist.champion) return 'R';
    return pick(m.seed, OTHER_SLOTS, 'seat-clip:' + champion);
  }

  private layChampion(champion: string): void {
    const cur = this.layers();
    if (cur[cur.length - 1]?.champion === champion) return;
    const id = ++this.layerId;
    this.layers.set([...cur.slice(-1), { id, champion, slot: this.slotFor(champion) }]);
    const wait = this.motion.reduced() ? 0 : CROSSFADE_MS * this.motion.tempo(this.host.nativeElement) + 60;
    clearTimeout(this.layerTimer);
    this.layerTimer = setTimeout(() => this.layers.update((ls) => ls.filter((l) => l.id >= id)), wait);
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

  /** The glyph on a read pill: the pin's most telling one, else the read's own mark. */
  protected glyphOf(p: FilmDeathPin): FilmGlyph {
    return p.glyphs[0] ?? READ_LABELS[p.read].icon;
  }

  /** The reads said in sentences under the pills, in time order, at most six; nothing without the film's reads. */
  protected readLines(s: FilmSeat): FilmDeathPin[] {
    return (s.pins ?? []).slice(0, MAX_READ_LINES);
  }

  /** How many of this seat's deaths the list leaves to the map, so a player who died nine times knows where the other three are. */
  protected moreOnMap(s: FilmSeat): number {
    return Math.max(0, (s.pins ?? []).length - MAX_READ_LINES);
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
