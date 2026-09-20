import { afterNextRender, Component, computed, DestroyRef, effect, inject, Injector, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { buildComps, championsOf, CompCard, sheetAfterIndex } from '../../core/comps-build';
import { Comp, Play } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { CompExpectationService } from '../../services/comp-expectation.service';
import { MotionService } from '../../services/motion.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { DetailToggleComponent } from '../../shared/detail-toggle.component';
import { InViewDirective } from '../../shared/in-view.directive';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { buildGameRows } from '../games/game-rows';
import { CompSheetComponent } from './comp-sheet.component';
import { CompTileComponent } from './comp-tile.component';
import { CompWritesService } from './comp-writes.service';
import { compToOpen, revealBehavior } from './open-comp.util';
import { TacticalBoardComponent } from './tactical-board.component';
import { ConfirmService } from '../../services/confirm.service';

/** Below this the grid is two across and the sheet one column; the CSS carries the same figure. */
const NARROW = '(max-width: 62rem)';

/**
 * Comps as a poster (13 Sep 2026, the lead: "I love the look we have now, let's bring this over to the comps page").
 * One model (`buildComps`) feeds every tile and the sheet, so a record, a face or a shape cannot disagree between
 * them. Tiles stand four across over the comp's face; one comp's sheet opens in a gold frame under the row holding
 * its tile. Starter is the poster with a sheet on click; Full opens the first comp's sheet on arrival and adds the
 * checks — the results one by one, the notes from its games, the counts-under rule and the expectation strip on the
 * tiles. A click turns the choice against the depth, and changing the depth resets it.
 *
 * Adding, renaming, editing and deleting a comp all happen here (the lead: "overwhelming complaints to just add and
 * edit comps"): Add a comp shows to anyone who can edit and turns edit mode on, the sheet edits in place, and Admin
 * keeps the names and picks as text for pasting.
 */
@Component({
  selector: 'app-comps',
  imports: [ChampionFilterComponent, CompSheetComponent, CompTileComponent, DetailToggleComponent, InViewDirective, TacticalBoardComponent, TooltipDirective, TourPillComponent],
  providers: [CompWritesService],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  private readonly confirm = inject(ConfirmService);
  protected readonly auth = inject(AuthService);
  protected readonly filter = inject(ChampionFilterService);
  protected readonly motion = inject(MotionService);
  private readonly writes = inject(CompWritesService);
  private readonly expectations = inject(CompExpectationService);
  private readonly prefs = inject(UserPrefsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  // ---- The model ----------------------------------------------------------------------------------------------
  /** Every game from every source, the comp each counts under on the row — the same rows Home and Games read. */
  private readonly rows = computed(() =>
    buildGameRows({
      analysis: this.data.compAnalysis()?.games ?? [],
      comps: [...this.data.comps()],
      compOverride: (id) => this.data.compOverride(id),
      players: this.data.players(),
      starters: this.data.players().filter((p) => !p.sub),
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      seriesGames: this.data.seriesGames(),
      scrims: this.data.scrims()
    })
  );
  protected readonly model = computed(() =>
    buildComps({
      comps: this.data.comps(),
      compResults: this.data.compResults(),
      plays: this.data.plays(),
      players: this.data.players(),
      gameReviews: this.data.gameReviews(),
      rows: this.rows(),
      matchNote: (id) => this.data.matchNote(id),
      traitsOf: (c) => this.expectations.traitsOf(c),
      junglerIdOf: (c) => this.expectations.junglerIdOf(c)
    })
  );

  protected readonly full = computed(() => this.prefs.depthOf('comps') === 'full');
  protected readonly categorySuggestions = ['Meta', 'Comfort', 'For Fun', 'Themed', 'Practice'];
  protected readonly category = signal<string>('all');
  protected readonly categories = computed(() => this.model().categories);

  /** The comps on the page: the category chosen, and only those the champion asked about is anywhere in. */
  protected readonly visible = computed<CompCard[]>(() => {
    const cat = this.category();
    return this.model()
      .cards.filter((c) => cat === 'all' || c.category === cat)
      .filter((c) => this.filter.passes(championsOf(c)));
  });

  /**
   * The filter's answer, split in two (20 Sep 2026). A seat can hold more than one champion, so `visible()` now
   * also holds the comps that merely keep the champion behind a priority — and one flat "Drafted in" over them
   * said a comp drafts a champion its own five icons, and the tile's "+1" mark, say it does not field. What the
   * comp fields is its five, so the card's own seats tell the two lists apart with no new field.
   */
  protected readonly drafted = computed(() => this.visible().filter((c) => this.fields(c)));
  protected readonly reserve = computed(() => this.visible().filter((c) => !this.fields(c)));

  /** Is the champion being asked about one of this comp's priority five, rather than something behind one? */
  private fields(c: CompCard): boolean {
    return c.seats.some((s) => this.filter.matches(s.champion));
  }

  /** The slim hero's words: what the page holds, and one line that says what to do. */
  protected readonly heading = computed(() => {
    const team = this.data.settings().teamName || 'Bom Squad';
    const m = this.model();
    const n = m.cards.length;
    const cats = m.categories.length;
    const parts = [`${n} ${n === 1 ? 'comp' : 'comps'}`];
    if (cats) parts.push(`${cats} ${cats === 1 ? 'category' : 'categories'}`);
    if (m.onRecord) parts.push(`${m.onRecord} ${m.onRecord === 1 ? 'game' : 'games'} on record`);
    return { title: `${team} Comps`, kicker: parts.join(' · '), blurb: 'Click a comp for its five, its plan and what to ban.' };
  });

  // ---- The grid -----------------------------------------------------------------------------------------------
  /** The poster has come on screen: the rings count from here. */
  protected readonly seen = signal(false);
  /** Tiles across; the CSS changes at the same width. */
  protected readonly cols = signal(4);
  /** The tiles plus the New comp tile, for placing the sheet. */
  protected readonly cells = computed(() => this.visible().length + (this.auth.canEdit() ? 1 : 0));

  /**
   * The one comp the tours walk: a finished comp with a record, else a finished comp, else the first. Every tile used
   * to carry the same anchors, so each step landed on whichever came first in the page.
   */
  protected readonly tourCompId = computed<string | null>(() => {
    const cards = this.visible();
    return (cards.find((c) => c.complete && c.headline) ?? cards.find((c) => c.complete) ?? cards[0])?.id ?? null;
  });

  // ---- The sheet ----------------------------------------------------------------------------------------------
  /** The chosen comp; `null` follows the depth, `'none'` is a sheet closed by hand. */
  private readonly picked = signal<string | null>(null);
  private lastFull: boolean | null = null;
  /** A change of depth starts from the depth's own default. Only a change: the first run must not undo a `?comp=`. */
  private readonly resetPick = effect(() => {
    const full = this.full();
    if (this.lastFull !== null && this.lastFull !== full) untracked(() => this.picked.set(null));
    this.lastFull = full;
  });
  /** Full opens the first comp's sheet and pins it by id, so a change in the list never slides it under the cursor. */
  private readonly openFirst = effect(() => {
    const first = this.full() ? this.visible()[0]?.id : undefined;
    if (first && untracked(() => this.picked()) === null) untracked(() => this.picked.set(first));
  });

  protected readonly selectedId = computed(() => {
    const picked = this.picked();
    return picked !== null && picked !== 'none' && this.visible().some((c) => c.id === picked) ? picked : null;
  });
  protected readonly selected = computed(() => this.visible().find((c) => c.id === this.selectedId()));
  /** The stored comp behind the chosen card, for the writes. */
  protected readonly selectedComp = computed<Comp | undefined>(() => this.data.comps().find((c) => c.id === this.selectedId()));
  /** After which cell the sheet's row goes: under the row holding the open tile; -1 with none open. */
  protected readonly sheetAfter = computed(() => {
    const id = this.selectedId();
    const i = id ? this.visible().findIndex((c) => c.id === id) : -1;
    return i < 0 ? -1 : sheetAfterIndex(i, this.cols(), this.cells());
  });

  protected toggle(id: string, keyboard: boolean): void {
    if (this.selectedId() === id) {
      this.close();
      return;
    }
    this.show(id, keyboard);
  }

  protected show(id: string, keyboard = false): void {
    this.picked.set(id);
    afterNextRender(
      () => {
        document.getElementById('comps-sheet')?.scrollIntoView?.({ block: 'nearest', behavior: revealBehavior(this.motion.reduced()) });
        if (keyboard) document.getElementById('comps-sheet-title')?.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
  }

  /** Close the sheet and hand focus back to the tile that opened it. */
  protected close(): void {
    const id = this.selectedId();
    this.picked.set('none');
    if (id) afterNextRender(() => document.getElementById(`comps-open-${id}`)?.focus({ preventScroll: true }), { injector: this.injector });
  }

  // ---- Links in --------------------------------------------------------------------------------------------------
  /** The comp a link asked for with ?comp=<id>, until the list holds it and it has been opened. */
  private readonly wantedComp = signal<string | null>(null);
  /** The reveal's pending scroll, so leaving the page cancels it. */
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Two across under 62rem, four above; the sheet's row follows.
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;
    if (mq) {
      const apply = () => this.cols.set(mq.matches ? 2 : 4);
      apply();
      mq.addEventListener?.('change', apply);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener?.('change', apply));
    }

    // "Add a comp" from the quick actions lands here with ?add=comp: one blank comp, then the param is dropped so a
    // reload does not add another.
    effect(() => {
      if (this.route.snapshot.queryParamMap.get('add') !== 'comp') return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { add: null }, queryParamsHandling: 'merge', replaceUrl: true });
      if (this.auth.canEdit()) void this.addComp();
    });

    // The film's draft chapter and Home's comp of the month land here with ?comp=<id>. Read as a stream, so a second
    // arrival with another id works and not only the first; the list may still be empty on the first tick, and the
    // effect runs again when the comps land (`compToOpen`, pure, has a spec of its own).
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('comp');
      if (id) this.wantedComp.set(id);
    });
    effect(() => {
      const id = compToOpen(this.wantedComp(), this.data.comps());
      if (id) untracked(() => this.revealComp(id));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.revealTimer));
  }

  /** Open one comp's sheet, drop the param that asked for it and bring its tile to the top of the screen. */
  private revealComp(id: string): void {
    this.wantedComp.set(null);
    // A category could hide the tile, and so could the champion filter that follows across pages: a link to a comp
    // means that comp, so both stand down — the filter only when it would hide this one.
    this.category.set('all');
    const card = this.model().cards.find((c) => c.id === id);
    if (card && !this.filter.passes(championsOf(card))) this.filter.clear();
    this.picked.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { comp: null }, queryParamsHandling: 'merge', replaceUrl: true });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      const tile = document.querySelector<HTMLElement>(`[data-comp="${CSS.escape(id)}"]`);
      // Not every DOM has scrollIntoView (jsdom has none); opening the sheet is the part that matters, the scroll is the courtesy.
      if (!tile || typeof tile.scrollIntoView !== 'function') return;
      tile.scrollIntoView({ behavior: revealBehavior(this.motion.reduced()), block: 'start' });
    }, 80);
  }

  // ---- Add, delete ---------------------------------------------------------------------------------------------
  /** A blank comp, its sheet open on the name so typing replaces "New comp N"; edit mode follows the press. */
  protected async addComp(): Promise<void> {
    if (!this.auth.editMode()) this.auth.editMode.set(true);
    const id = await this.writes.add();
    this.category.set('all');
    if (this.filter.active()) this.filter.clear();
    this.picked.set(id);
    afterNextRender(
      () => {
        document.getElementById('comps-sheet')?.scrollIntoView?.({ block: 'nearest', behavior: revealBehavior(this.motion.reduced()) });
        const name = document.getElementById('comps-sheet-rename') as HTMLInputElement | null;
        name?.focus({ preventScroll: true });
        name?.select();
      },
      { injector: this.injector }
    );
  }

  /** The comp and what hangs off it, after a confirm that names all of that; focus lands on the next tile, else Add. */
  protected async removeComp(card: CompCard): Promise<void> {
    const comp = this.data.comps().find((c) => c.id === card.id);
    if (!comp) return;
    const results = card.logged?.results ?? [];
    const plays = card.plays;
    const variants = this.data.comps().filter((c) => c.countsUnder === card.id);
    const goes = [
      results.length ? `${results.length} logged ${results.length === 1 ? 'result' : 'results'}` : '',
      plays.length ? `${plays.length} ${plays.length === 1 ? 'play' : 'plays'}` : ''
    ].filter(Boolean);
    const lines: string[] = [];
    if (goes.length) lines.push(`Its ${goes.join(' and ')} ${results.length + plays.length === 1 ? 'goes' : 'go'} too.`);
    if (variants.length) lines.push(variants.length === 1 ? '1 comp that counted under it will stand on its own.' : `${variants.length} comps that counted under it will stand on their own.`);
    const ok = await this.confirm.ask({ title: `Delete ${comp.name}?`, body: lines.join(' ') || undefined, confirmLabel: 'Delete comp', danger: true });
    if (!ok) return;
    const list = this.visible();
    const at = list.findIndex((c) => c.id === card.id);
    const next = list[at + 1]?.id ?? list[at - 1]?.id ?? null;
    this.picked.set('none');
    await this.writes.remove(comp, { results, plays, variants });
    afterNextRender(
      () => (next ? document.getElementById(`comps-open-${next}`) : document.querySelector<HTMLElement>('[data-tour="comps-add"]'))?.focus({ preventScroll: true }),
      { injector: this.injector }
    );
  }

  // ---- The tactical board, over the page -------------------------------------------------------------------------
  protected readonly boardComp = signal<Comp | null>(null);
  protected readonly boardPlay = signal<Play | null>(null);

  protected openBoard(comp: Comp, play: Play | null): void {
    this.boardPlay.set(play);
    this.boardComp.set(comp);
  }

  protected closeBoard(): void {
    this.boardComp.set(null);
    this.boardPlay.set(null);
  }
}
