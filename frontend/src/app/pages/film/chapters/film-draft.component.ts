import { formatDate } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FilmDraft, FilmDraftSeat, FilmGlyph, FilmModel, GAIN_GLYPHS } from '../../../core/film-model';
import { GAIN_LABELS } from '../../../core/review-view';
import { Comp, CompPicks, DraftGain, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { CompExpectationService } from '../../../services/comp-expectation.service';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { UiService } from '../../../services/ui.service';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { FilmFrameComponent } from '../film-frame.component';

type Swap = FilmDraft['swaps'][number];

/** How long after the chapter comes on screen the first tile turns, before the tempo: the frame's own rise and the ten tiles' entrance have settled by then. */
const TURN_AFTER_MS = 900;
/** The wait between one swap's turn and the next, before the tempo. */
const TURN_STAGGER_MS = 250;

/** The seats in lane order, dropping any the review did not fill. */
function bySeat(seats: readonly FilmDraftSeat[]): FilmDraftSeat[] {
  return ROLES.map((r) => seats.find((s) => s.seat === r)).filter((s): s is FilmDraftSeat => !!s);
}

/**
 * The draft with hindsight (cut 4, 10 Sep 2026): the champion the coach would
 * have drafted fills the stage, the verdict on the fit leads, our five stand
 * over their five (theirs faint, a champion in a seat and never a name), and
 * for each swap the seat's tile turns from the champion we played into the
 * one to try, a quarter second apart, while the swap's card drops in with
 * what it buys and why. Nothing here is a question: the reader is told what
 * to change and can save it as a variant of the comp we played, so the next
 * draft starts from this one. With motion off every tile stands where the
 * turn would have left it.
 */
@Component({
  selector: 'app-film-draft',
  imports: [FilmFrameComponent, FilmGlyphComponent],
  template: `
    @let d = draft();
    @if (artChampion(); as champ) {
      <div class="film-chapter-art" [class.is-dim]="!hasSwaps()" aria-hidden="true">
        <img class="film-splash" [src]="ui.championArtUrl(champ)" (error)="ui.artFallback($event, champ)" alt="" />
        <span class="film-chapter-shade"></span>
      </div>
    }
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (d) {
        <p class="film-draft-verdict">{{ d.verdict }}</p>
        @if (!d.swaps.length) {
          <p class="film-draft-held"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span> The draft held.</p>
        }

        <div class="film-draft-rows">
          <ul class="list-clean film-draft-row is-ours" aria-label="Our draft">
            @for (s of ours(); track s.seat) {
              @let sw = swapFor(s.seat);
              <li class="film-draft-seat" [class.has-swap]="!!sw" [class.is-swapped]="!!sw && isSwapped(s.seat)" [style.--i]="$index">
                <span class="film-draft-tiles">
                  <img class="film-draft-tile is-out" [src]="ui.championIconUrl(s.champion)" [alt]="s.champion" loading="lazy" />
                  @if (sw) {
                    <img class="film-draft-tile is-in" [src]="ui.championIconUrl(sw.in)" [alt]="sw.in" loading="lazy" />
                    <!-- The champion we played stays in the corner, small and struck, so the row still says what the draft was. -->
                    <span class="film-draft-badge" aria-hidden="true"><img [src]="ui.championIconUrl(s.champion)" alt="" loading="lazy" /></span>
                  }
                </span>
                <span class="film-draft-seat-name">{{ s.seat }}</span>
                @if (s.name) { <span class="film-draft-name">{{ s.name }}</span> }
              </li>
            }
          </ul>
          @if (theirs().length) {
            <span class="film-draft-vs" aria-hidden="true">vs</span>
            <ul class="list-clean film-draft-row is-theirs" aria-label="Their draft">
              @for (s of theirs(); track s.seat) {
                <li class="film-draft-seat" [style.--i]="5 + $index">
                  <span class="film-draft-tiles"><img class="film-draft-tile" [src]="ui.championIconUrl(s.champion)" [alt]="s.champion" loading="lazy" /></span>
                  <span class="film-draft-seat-name">{{ s.seat }}</span>
                </li>
              }
            </ul>
          }
        </div>

        @if (d.swaps.length) {
          <div class="film-draft-swaps">
            @for (sw of d.swaps; track keyOf(sw)) {
              <article class="film-draft-swap" [style.--i]="$index" [attr.aria-label]="sw.in + ' for ' + ui.championName(sw.out) + ', ' + sw.seat">
                <p class="film-draft-swap-seat">{{ sw.seat }}</p>
                <div class="film-draft-swap-pair">
                  <span class="film-draft-swap-side is-out">
                    <span class="film-draft-out"><img class="film-draft-tile is-out" [src]="ui.championIconUrl(sw.out)" alt="" loading="lazy" /></span>
                    <!-- "out" is Riot's id and "in" is Data Dragon's name; the sentence says both the display way. -->
                    <span class="film-draft-champ">{{ ui.championName(sw.out) }}</span>
                  </span>
                  <app-film-glyph class="film-draft-swap-glyph" name="swap" />
                  <span class="film-draft-swap-side is-in">
                    <img class="film-draft-tile is-in" [src]="ui.championIconUrl(sw.in)" alt="" loading="lazy" />
                    <span class="film-draft-champ">{{ sw.in }}</span>
                  </span>
                </div>
                @if (sw.gains.length) {
                  <ul class="list-clean film-gain-chips" aria-label="What it buys">
                    @for (g of sw.gains; track g) {
                      <li class="film-gain-chip"><app-film-glyph [name]="gainGlyph(g)" /><span>{{ gainLabel(g) }}</span></li>
                    }
                  </ul>
                }
                <p class="film-draft-swap-why">{{ sw.why }}</p>
                @if (auth.canEdit()) {
                  <div class="film-draft-swap-actions">
                    <button type="button" class="view-btn active" [disabled]="isSaved(sw)" (click)="save(sw)">
                      <span class="material-symbols-rounded" aria-hidden="true">{{ isSaved(sw) ? 'check' : 'save' }}</span> {{ isSaved(sw) ? 'Saved' : 'Save with ' + sw.in }}
                    </button>
                  </div>
                }
              </article>
            }
          </div>
        }

        <div class="film-draft-actions">
          <button type="button" class="view-btn" (click)="openComps()"><span class="material-symbols-rounded" aria-hidden="true">dashboard</span> Open Comps</button>
        </div>
      } @else {
        <p class="film-wait">The review carries no draft verdict for this game.</p>
      }
    </app-film-frame>
  `
})
export class FilmDraftComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The draft');
  readonly index = input<number>(0);
  readonly count = input<number>(1);
  /** True while this is the chapter on screen: the tiles turn only then, and turn again on the next visit. */
  readonly active = input<boolean>(false);
  /** Bumped by the page on Escape. Nothing on this chapter opens, so there is nothing to fold; the input is here so the page wires every chapter the same way. */
  readonly closeTick = input<number>(0);
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly data = inject(TeamDataService);
  private readonly expectations = inject(CompExpectationService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly motion = inject(MotionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** The seats whose tile has turned; filled one swap at a time while the chapter is on screen. */
  private readonly swapped = signal<ReadonlySet<Role>>(new Set());
  /** The swaps saved to Comps this visit, by the game and `keyOf`; the pill reads Saved and stays put. The game is in the key so a film opened after this one starts unsaved. */
  private readonly saved = signal<ReadonlySet<string>>(new Set());
  private timers: ReturnType<typeof setTimeout>[] = [];

  protected readonly draft = computed<FilmDraft | undefined>(() => this.model().draft);
  protected readonly swaps = computed<Swap[]>(() => this.draft()?.swaps ?? []);
  /** The swaps as one string, so the turn re-runs only when a swap changes, not whenever the model is rebuilt around the same ones. */
  private readonly swapsKey = computed(() => this.swaps().map((s) => this.keyOf(s)).join('|'));
  protected readonly hasSwaps = computed(() => this.swaps().length > 0);
  protected readonly ours = computed(() => bySeat(this.draft()?.ours ?? []));
  protected readonly theirs = computed(() => bySeat(this.draft()?.theirs ?? []));
  /** The stage's splash: the first swap's champion, the one the coach would have drafted; the protagonist, dimmed, when the draft held. */
  protected readonly artChampion = computed<string>(() => this.swaps()[0]?.in ?? this.model().title.protagonist.champion);

  constructor() {
    // The turn plays each time the chapter comes on screen: swap by swap, a quarter second apart, after
    // the frame's own entrance. Off screen the row shows the comp as played, so the next visit plays the
    // turn again. With motion off there is no wait: every swapped seat shows both tiles at once. Keyed on
    // the swaps as a string (10 Sep 2026, second review): the model is rebuilt whenever any review, comp or
    // series snapshot lands, and the tiles must not flip back and turn again for a teammate saving a note.
    effect(() => {
      const on = this.active();
      this.swapsKey();
      untracked(() => this.runTurn(on, this.swaps()));
    });
    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  private runTurn(on: boolean, swaps: readonly Swap[]): void {
    this.clearTimers();
    if (!on || !swaps.length) {
      this.swapped.set(new Set());
      return;
    }
    if (this.motion.reduced()) {
      this.swapped.set(new Set(swaps.map((s) => s.seat)));
      return;
    }
    this.swapped.set(new Set());
    const tempo = this.motion.tempo(this.host.nativeElement);
    swaps.forEach((s, i) => {
      this.timers.push(setTimeout(() => this.swapped.update((set) => new Set([...set, s.seat])), (TURN_AFTER_MS + i * TURN_STAGGER_MS) * tempo));
    });
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  protected swapFor(seat: Role): Swap | undefined {
    return this.swaps().find((s) => s.seat === seat);
  }

  protected isSwapped(seat: Role): boolean {
    return this.swapped().has(seat);
  }

  protected keyOf(sw: Swap): string {
    return `${sw.seat}:${sw.in}`;
  }

  protected isSaved(sw: Swap): boolean {
    return this.saved().has(this.savedKey(sw));
  }

  private savedKey(sw: Swap): string {
    return `${this.model().matchId}:${this.keyOf(sw)}`;
  }

  protected gainGlyph(g: DraftGain): FilmGlyph {
    return GAIN_GLYPHS[g];
  }

  protected gainLabel(g: DraftGain): string {
    return GAIN_LABELS[g];
  }

  /**
   * Save the swap as a comp. When the game was played from a saved comp the
   * variant keeps its category, bans and game plan and counts under it for
   * stats, with the one pick changed; a game played off no comp becomes a
   * comp of its own from the five we drafted. Every variant is named off its
   * own swap alone ("Front to back · Sejuani"), never the first swap's
   * champion as well, since that champion is not in it (10 Sep 2026, second
   * review); for the first swap this is the build's `variantName`. The
   * expectation is stamped here the way the Comps page stamps every save
   * (`CompExpectationService.stamped`): `createComp` does not derive it, and
   * the next review of a game on this comp compares the curve against it.
   */
  protected async save(sw: Swap): Promise<void> {
    const d = this.draft();
    if (!d || this.isSaved(sw)) return;
    const comp = d.compId ? this.data.comps().find((c) => c.id === d.compId) : undefined;
    const base = comp?.name ?? d.compName ?? `${this.model().title.protagonist.champion || 'Our'} comp`;
    const name = `${base} · ${sw.in}`;
    const at = this.model().title.lowerThird.date;
    const of = at > 0 ? ` of ${formatDate(at, 'd MMM yyyy', 'en-US')}` : '';
    const notes = `Variant from the review${of}: ${sw.why}`;
    const picks: CompPicks = comp ? { ...comp.picks, [sw.seat]: sw.in } : this.picksFrom(d.ours, sw);
    const bare: Omit<Comp, 'id' | 'order'> = comp
      ? { name, picks, category: comp.category, notes, countsUnder: comp.id, bans: comp.bans, gamePlan: comp.gamePlan }
      : { name, picks, notes };
    // `stamped` wants a whole comp; the id and the order are the service's to give, so they go on and come off again.
    const { id: _id, order: _order, ...data } = this.expectations.stamped({ ...bare, id: '', order: 0 });
    try {
      await this.data.createComp(data);
      this.saved.update((set) => new Set([...set, this.savedKey(sw)]));
      this.toast.show('Saved to Comps', { kind: 'ok', icon: 'save', text: name });
    } catch {
      this.toast.show('Could not save', { kind: 'warn', text: 'The comp did not reach the server; try again in a moment.' });
    }
  }

  /** The five we drafted with the one seat swapped; a seat the review left blank stays blank, as a new comp's does. */
  private picksFrom(ours: readonly FilmDraftSeat[], sw: Swap): CompPicks {
    const picks = Object.fromEntries(ROLES.map((r) => [r, ours.find((s) => s.seat === r)?.champion ?? ''])) as CompPicks;
    picks[sw.seat] = sw.in;
    return picks;
  }

  protected openComps(): void {
    void this.router.navigate(['/comps']);
  }
}
