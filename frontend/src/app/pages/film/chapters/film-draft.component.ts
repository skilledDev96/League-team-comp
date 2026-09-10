import { formatDate } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FilmDraft, FilmDraftSeat, FilmGlyph, FilmModel, GAIN_GLYPHS } from '../../../core/film-model';
import { GAIN_LABELS } from '../../../core/review-view';
import { Comp, CompPicks, DraftGain, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { ChampionDataService } from '../../../services/champion-data.service';
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
/** The `busy` key for the bottom pill's save; the swaps use `savedKey`, which always carries a seat, so the two never collide. */
const PLAYED = 'played';

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
 *
 * Every pill here leads to a comp (10 Sep 2026: the lead asked that Open
 * Comps take us to the same or semi-same comp, or make it). A swap whose
 * variant is already saved, five picks equal, offers Open <name> to everyone;
 * otherwise an editor gets Save with <champion>, and the pill turns into Open
 * once the comp exists. The bottom pill opens the comp we played when the
 * review names one or a saved comp carries the five picks as played, lets an
 * editor save the draft as played when neither holds, and falls back to the
 * Comps page for a viewer. Opening means `/comps?comp=<id>`: the Comps page
 * unfolds that card and scrolls to it.
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

        <!-- Layout only (10 Sep 2026): on a wide screen the two rows of five stand left and the swap cards right, so the cards never run under the fold. -->
        <div class="film-draft-layout">
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
                <!-- One pill a swap: the variant when it is saved, for anyone; else Save for an editor; a viewer with no variant sees none. -->
                @let variant = variantOf(sw);
                @if (variant || auth.canEdit()) {
                  <div class="film-draft-swap-actions">
                    @if (variant) {
                      <button type="button" class="view-btn active" (click)="open(variant.id)">
                        <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span> Open {{ variant.name }}
                      </button>
                    } @else {
                      <button type="button" class="view-btn active" [disabled]="busy() === savedKey(sw)" (click)="save(sw)">
                        <span class="material-symbols-rounded" aria-hidden="true">save</span> Save with {{ sw.in }}
                      </button>
                    }
                  </div>
                }
              </article>
            }
          </div>
        }
        </div>

        <!-- Nothing while the review names a comp the list has not delivered: Save here would duplicate it (10 Sep 2026, second fix pass). -->
        @if (!compPending()) {
          <div class="film-draft-actions">
            @if (playedComp(); as played) {
              <button type="button" class="view-btn" (click)="open(played.id)"><span class="material-symbols-rounded" aria-hidden="true">open_in_new</span> Open {{ played.name }}</button>
            } @else if (auth.canEdit()) {
              <button type="button" class="view-btn" [disabled]="busy() === PLAYED" (click)="saveAsPlayed()"><span class="material-symbols-rounded" aria-hidden="true">save</span> Save as a comp and open</button>
            } @else {
              <button type="button" class="view-btn" (click)="openComps()"><span class="material-symbols-rounded" aria-hidden="true">dashboard</span> Open Comps</button>
            }
          </div>
        }
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
  private readonly champData = inject(ChampionDataService);
  private readonly expectations = inject(CompExpectationService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly motion = inject(MotionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** The seats whose tile has turned; filled one swap at a time while the chapter is on screen. */
  private readonly swapped = signal<ReadonlySet<Role>>(new Set());
  /**
   * The variants this chapter made this visit, by the game and `keyOf` (`savedKey`), each with the comp's id and name so
   * the pill can read Open <name> before the comps list has caught up. The game is in the key so a film opened after this
   * one starts with nothing made.
   */
  private readonly made = signal<ReadonlyMap<string, { id: string; name: string }>>(new Map());
  /** The comp "Save as a comp and open" made this visit: the review still says `compId: null`, so the chapter remembers. */
  private readonly madeCompId = signal<string | null>(null);
  /** The key being written (`savedKey` of a swap, or `PLAYED`), so a double click cannot make two comps. */
  protected readonly busy = signal<string | null>(null);
  protected readonly PLAYED = PLAYED;
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
  /**
   * The comp the game was played from: the one the review names, the one "Save as a comp and open" just made, or any
   * saved comp whose five picks are the five we drafted (10 Sep 2026, second fix pass). The picks lookup is what keeps
   * a second visit from offering Save again: the review says `compId: null` until the next analysis run re-attributes
   * the game, and this chapter is torn down whenever it is not on stage, so the remembered id alone was lost by the time
   * Back, the poster or Before you play landed here again, and a second click made a duplicate "Jinx comp". Compared
   * the way `variantOf` compares, and only with all five seats filled: four picks are not a comp. A find on the list
   * rather than a remembered object: `createComp` puts the new comp on the signal before the network answers, so it is
   * there at once, and a comp deleted meanwhile falls away instead of being offered.
   */
  protected readonly playedComp = computed<Comp | undefined>(() => {
    const d = this.draft();
    if (!d) return undefined;
    const comps = this.data.comps();
    const id = d.compId ?? this.madeCompId();
    const byId = id ? comps.find((c) => c.id === id) : undefined;
    if (byId) return byId;
    const picks = this.picksOf(d.ours);
    if (ROLES.some((r) => !picks[r])) return undefined;
    const want = this.picksKey(picks);
    return comps.find((c) => this.picksKey(c.picks) === want);
  });
  /**
   * True while the review names a comp the list has not delivered yet. The list arrives whole from one listener, so an
   * empty list is one that has not landed rather than a team with no comps; offering Save meanwhile would make a copy
   * of a comp about to appear, so the bottom pill shows nothing until it does (10 Sep 2026, second fix pass). Once the
   * list is here and still lacks the id, the comp was deleted, and Save is honest again.
   */
  protected readonly compPending = computed(() => !!this.draft()?.compId && !this.playedComp() && this.data.comps().length === 0);

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

  protected savedKey(sw: Swap): string {
    return `${this.model().matchId}:${this.keyOf(sw)}`;
  }

  /**
   * The saved comp that is this swap: the one this chapter just made, else any comp whose five picks are ours with the
   * one seat changed. Picks are compared through `championName`, so Riot's id off the review ("MonkeyKing") and Data
   * Dragon's name in a comp ("Wukong") are the same champion, and a comp line's " - note" is dropped first. A swap with
   * a seat still blank is never matched: four picks are not a comp.
   */
  protected variantOf(sw: Swap): { id: string; name: string } | undefined {
    const own = this.made().get(this.savedKey(sw));
    if (own) return own;
    const d = this.draft();
    if (!d) return undefined;
    const picks = this.variantPicks(d, sw);
    if (ROLES.some((r) => !picks[r])) return undefined;
    const want = this.picksKey(picks);
    const hit = this.data.comps().find((c) => this.picksKey(c.picks) === want);
    return hit ? { id: hit.id, name: hit.name } : undefined;
  }

  /** The variant's five: the comp we played with the one seat changed when there is one, else the five we drafted with it. */
  private variantPicks(d: FilmDraft, sw: Swap): CompPicks {
    const comp = this.playedComp();
    return comp ? { ...comp.picks, [sw.seat]: sw.in } : this.picksFrom(d.ours, sw);
  }

  /** One champion however it was spelt: the display name, lowercased to letters and digits. */
  private champKey(champion: string): string {
    return this.champData.normalize(this.ui.championName(champion));
  }

  /** Five champions in lane order as one string, so two comps with the same draft compare equal. */
  private picksKey(picks: CompPicks): string {
    return ROLES.map((r) => this.champKey(this.ui.parseCompLine(picks[r] ?? '').champion)).join('|');
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
   * comp of its own from the five we drafted. The base is `playedComp`, so a
   * variant saved after "Save as a comp and open" counts under the comp just
   * made (10 Sep 2026). Every variant is named off its own swap alone ("Front
   * to back · Sejuani"), never the first swap's champion as well, since that
   * champion is not in it (10 Sep 2026, second review); for the first swap
   * this is the build's `variantName`. The expectation is stamped here the way
   * the Comps page stamps every save (`CompExpectationService.stamped`):
   * `createComp` does not derive it, and the next review of a game on this
   * comp compares the curve against it. Once saved, the pill becomes Open
   * <name> and the toast carries an Open pill too, so the reader can go
   * straight to what they just made.
   */
  protected async save(sw: Swap): Promise<void> {
    const d = this.draft();
    const key = this.savedKey(sw);
    if (!d || this.made().has(key) || this.busy() === key) return;
    const comp = this.playedComp();
    const base = comp?.name ?? d.compName ?? `${this.model().title.protagonist.champion || 'Our'} comp`;
    const name = `${base} · ${sw.in}`;
    const notes = `Variant from the review${this.reviewOf()}: ${sw.why}`;
    const picks = this.variantPicks(d, sw);
    const bare: Omit<Comp, 'id' | 'order'> = comp
      ? { name, picks, category: comp.category, notes, countsUnder: comp.id, bans: comp.bans, gamePlan: comp.gamePlan }
      : { name, picks, notes };
    this.busy.set(key);
    try {
      const id = await this.data.createComp(this.stamped(bare));
      this.made.update((m) => new Map(m).set(key, { id, name }));
      this.toast.show('Saved to Comps', { kind: 'ok', icon: 'save', text: name, action: { label: 'Open', run: () => this.open(id) } });
    } catch {
      this.toast.show('Could not save', { kind: 'warn', text: 'The comp did not reach the server; try again in a moment.' });
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Save the draft as played as a comp of its own and open it (10 Sep 2026):
   * the review names no comp, so there is nothing to open until one exists.
   * Named off the review's comp name when it has one, else the protagonist
   * ("Jinx comp"); the five we drafted, blank seats staying blank; the verdict
   * as its notes. No category and no `countsUnder`: there is no comp to
   * inherit either from, exactly as a variant saved off no comp. The chapter
   * then remembers the id, so the bottom pill reads Open <name> and a Save
   * with <champion> afterwards counts under it; on a later visit `playedComp`
   * finds the same comp by its picks, so this is never offered twice.
   */
  protected async saveAsPlayed(): Promise<void> {
    const d = this.draft();
    if (!d || this.playedComp() || this.compPending() || this.busy() === PLAYED) return;
    const name = d.compName ?? `${this.model().title.protagonist.champion || 'Our'} comp`;
    const picks = this.picksOf(d.ours);
    const notes = `From the review${this.reviewOf()}: ${d.verdict}`;
    this.busy.set(PLAYED);
    try {
      const id = await this.data.createComp(this.stamped({ name, picks, notes }));
      this.madeCompId.set(id);
      this.toast.show('Saved to Comps', { kind: 'ok', icon: 'save', text: name, action: { label: 'Open', run: () => this.open(id) } });
      this.open(id);
    } catch {
      this.toast.show('Could not save', { kind: 'warn', text: 'The comp did not reach the server; try again in a moment.' });
    } finally {
      this.busy.set(null);
    }
  }

  /** " of 9 Sep 2026" for the notes when the film knows the game's date; nothing when it does not. */
  private reviewOf(): string {
    const at = this.model().title.lowerThird.date;
    return at > 0 ? ` of ${formatDate(at, 'd MMM yyyy', 'en-US')}` : '';
  }

  /** The comp with its expectation stamped. `stamped` wants a whole comp; the id and the order are the service's to give, so they go on and come off again. */
  private stamped(bare: Omit<Comp, 'id' | 'order'>): Omit<Comp, 'id' | 'order'> {
    const { id: _id, order: _order, ...data } = this.expectations.stamped({ ...bare, id: '', order: 0 });
    return data;
  }

  /**
   * The five we drafted as a comp's picks, in the spelling a comp uses: the review carries Riot's id ("MonkeyKing") and
   * the Comps page shows a pick as written, so the display name goes in. A seat the review left blank stays blank, as a
   * new comp's does.
   */
  private picksOf(ours: readonly FilmDraftSeat[]): CompPicks {
    return Object.fromEntries(ROLES.map((r) => {
      const champion = ours.find((s) => s.seat === r)?.champion ?? '';
      return [r, champion ? this.ui.championName(champion) : ''];
    })) as CompPicks;
  }

  /** The five we drafted with the one seat swapped. */
  private picksFrom(ours: readonly FilmDraftSeat[], sw: Swap): CompPicks {
    const picks = this.picksOf(ours);
    picks[sw.seat] = sw.in;
    return picks;
  }

  /** The Comps page, unfolded and scrolled to one comp. */
  protected open(id: string): void {
    void this.router.navigate(['/comps'], { queryParams: { comp: id } });
  }

  protected openComps(): void {
    void this.router.navigate(['/comps']);
  }
}
