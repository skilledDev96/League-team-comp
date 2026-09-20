import { Component, DestroyRef, OnInit, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionTraits, OpponentPlayer, Role, SeriesGame, TournamentSeries } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { ChampionDataService } from '../../../services/champion-data.service';
import { RouterLink } from '@angular/router';
import { ChampionGridComponent } from '../../../shared/champion-grid.component';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { ModalDirective } from '../../../shared/modal.directive';
import {
  blockedSet,
  BurnGap,
  COMP_RATE_MIN_GAMES,
  CompAvailability,
  compAvailability,
  gameAfterPlayed,
  gameHasContent,
  gapsBefore,
  gapsLine,
  normalizeChampion,
  playedGameWrite,
  playedSeats,
  PoolPressure,
  poolPressure,
  SeatAvailability,
  SeatOptionState,
  uniqueChampions
} from '../draft.util';
import {
  bansLeftInPhase,
  banPlaceWords,
  banTeamAt,
  banWallClick,
  bansForTeam,
  describeStep,
  DraftStep,
  draftProgress,
  emptyEnterAction,
  LOCK_AFTER_MS,
  HeldLine,
  heldLine,
  isComplete,
  isNoBan,
  lastPickOfPhase,
  NO_BAN,
  picksLeftInPhase,
  positionOf,
  seatFor,
  sequenceClosed,
  stepAt,
  undoTarget
} from '../draft-sequence';
import {
  BanSuggestion,
  banSuggestions,
  ownRecord,
  OwnRecord,
  ChampionSuggestion,
  CompFit,
  CompGaps,
  compGaps,
  CompCost,
  compsUsing,
  currentStanding,
  DraftRead,
  enemyRead,
  suggestForLane,
  swingOf
} from '../draft-advice';
import { indexTraits, traitsFor } from '../../../shared/comp-board.util';
import { comfortOf, gamePlan, GamePlan, LaneRead, LaneVerdict, readLanes, SeatInput } from '../lane-read';
import { countersFor, poolFor, starters } from '../../../core/opponent-view';
import { playsRole } from '../../../core/champion-lanes';
import { MAP_SPOTS } from '../../../core/rift-zones';
import { isSandboxSeries } from '../../../core/sandbox-series';
import { DraftAdvisorService } from '../../../services/draft-advisor.service';
import { DraftAdvice, SavedDraftAdvice } from '../../../models/team.models';
import { CompIdentity, IDENTITY_ICON, IDENTITY_LABEL, classifyComp } from '../../../core/comp-identity';
import { ChampionRate, ChampionStatsService, previousPatch } from '../../../services/champion-stats.service';
import { MatchupRate, MatchupStatsService } from '../../../services/matchup-stats.service';
import { TournamentContextService } from '../tournament-context.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/** Which team a draft slot belongs to. */
type DraftSide = 'our' | 'their';

/** Where the next champion clicked in the grid lands. */
type DraftTarget =
  | { kind: 'ban'; index?: number }
  | { kind: 'pick'; side: DraftSide; index: number };

/** Fearless series run ten bans a game, same as the client. */
const MAX_BANS = 10;

/** How the ten picks are laid out: five a side, or on the map. */
type DraftLayout = 'columns' | 'map';
const LAYOUT_KEY = 'bom-draft-layout';

/**
 * Where each seat stands on the rift during the laning phase, as a percentage
 * of the map image, blue side (base bottom-left) and red side (base top-right).
 *
 * The point of the map is that a lane matchup sits *together*: both top laners
 * at the top-left corner, both bot lanes at the bottom-right, and both junglers
 * in the top-side jungle — the half of the map above mid, each in their own
 * quadrant of it (asked for on 5 Sep 2026; the bot-side spots read as bot lane). Mirroring blue through the centre would have put red's top laner
 * in bot lane, so red is placed by hand, not derived. The table lives in
 * `core/rift-zones.ts` (`MAP_SPOTS`), which the film's Rift and the tactical
 * board read too, so a seat stands in one place on every map.
 */

/**
 * Burned champions shown in the confirm-slot strip.
 *
 * Forty is a full Bo5 — in practice, all of them. Capping at ten was the wrong
 * instinct: under fearless the burned list *is* the thing being tracked, so
 * hiding half of it behind a "+10" put the answer one hover away at exactly the
 * moment it is needed. The row scrolls inside its own box instead, which keeps
 * the slot height fixed without dropping anything.
 */

/**
 * One game, full width, for use while the draft is actually happening: bans and
 * picks as they land, and what still survives the fearless burn.
 */
@Component({
  selector: 'app-tournament-draft',
  imports: [
    RouterLink,
    FormsModule,
    ChampionGridComponent,
    ChampionPickerComponent,
    TooltipDirective,
    ModalDirective
  ],
  templateUrl: './draft.component.html'
})
export class TournamentDraftComponent implements OnInit {
  /**
   * Open in edit mode. This screen exists to be used while a draft is running —
   * arriving to a read-only board and having to find the toggle first is a step
   * nobody wants with a pick timer going. Leaving is still one click.
   */
  ngOnInit(): void {
    if (this.auth.canEdit()) this.auth.editMode.set(true);

    // One document, fetched once. Nothing waits on it: every champion's rate is
    // optional in the view, so the panel renders immediately and the solo queue
    // numbers appear when they arrive.
    void this.stats.load();

    // All five lanes up front rather than as each is advised. The published
    // index holds only pairings past the prune floor, so a lane is kilobytes —
    // and fetching lazily would mean a Firestore read landing mid-render the
    // first time a lane is looked at, which is both a side effect in the wrong
    // place and a visible pause during a draft.
    for (const role of this.roles) void this.matchups.load(role);

    // Put the stage on screen. Opening Draft means drafting, and the page
    // header above it is not what anyone came here to read.
    //
    // Polled rather than fired once: the stage sits behind the series and game
    // being resolved from stored data, so on a cold open it does not exist yet
    // and a single deferred call finds nothing. Gives up after two seconds.
    const started = Date.now();
    const findStage = setInterval(() => {
      const stage = document.querySelector('.draft-stage');
      if (stage) {
        // Instant, not smooth. Smooth scrolling needs animation frames, so it
        // silently does nothing wherever they are throttled — and for "put me
        // on the draft" you want to be there, not watch the journey.
        stage.scrollIntoView({ block: 'start', behavior: 'auto' });
        clearInterval(findStage);
      } else if (Date.now() - started > 2000) {
        clearInterval(findStage);
      }
    }, 80);
    this.destroyRef.onDestroy(() => clearInterval(findStage));

    // Drives the pick clock. 250ms rather than a second so the countdown does
    // not visibly stutter; it only ever reads whole seconds.
    const timer = setInterval(() => this.now.set(Date.now()), 250);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  private readonly destroyRef = inject(DestroyRef);

  /** Publish what the view resolved to, for the address bar. */
  private readonly publishShown = effect(() => {
    const series = this.draftSeries();
    const game = this.draftGame();
    untracked(() => {
      this.ctx.shownSeriesId.set(series?.id ?? '');
      this.ctx.shownGameId.set(game?.id ?? '');
    });
  });

  /**
   * The held champion follows the game document, not this screen.
   *
   * Holding is written to `SeriesGame.holding` so everyone on the link sees
   * the same thing being considered. Mirroring it back here means a second
   * editor, or the same editor on another device, sees the hold and the
   * cancel as they happen instead of a board that only moves on confirm.
   */
  private readonly mirrorHold = effect(() => {
    const game = this.draftGame();
    const held = game?.holding ?? null;
    untracked(() => {
      if (this.pending() !== held) this.pending.set(held);
    });
  });

  // ---- The pick clock -----------------------------------------------------
  //
  // Tournament drafts run a 30-second shot clock per action. This one is a
  // reminder, not a referee: it never advances the draft or discards a pick,
  // because the real clock is in the client and disagreeing with it would be
  // worse than not having one.

  protected readonly PICK_SECONDS = 30;

  /**
   * The test aids (skip the bans, fill the draft) used to sit in the live
   * bar for every editor. They show only for a browser that asked: a
   * Diagnostics checkbox, or any page opened with ?dev=1 (8 Sep 2026).
   */
  protected readonly devAids = signal(readDevAids());

  /**
   * And only on a sandbox series (17 Sep 2026). Random bans written into a real series are read as real by the
   * burn lists, the advisor and the review lockouts; a ban nobody saw is "Rest of phase not seen", not a test aid.
   */
  protected aidsShown(series: TournamentSeries): boolean {
    return this.devAids() && series.sandbox === true;
  }

  /** Their target bans from scouting that are still on the table. */
  protected targetBans(series: TournamentSeries, game: SeriesGame): string[] {
    const gone = blockedSet(game.bans, game.ourChampions, game.theirChampions);
    return (series.bans ?? []).filter((b) => b && !gone.has(normalizeChampion(b))).slice(0, 5);
  }
  private readonly now = signal(Date.now());
  private readonly stepStartedAt = signal(Date.now());

  /** Restart the clock. Called wherever the step moves. */
  private restartClock(): void {
    this.stepStartedAt.set(Date.now());
    this.now.set(Date.now());
  }

  protected readonly secondsLeft = computed(() => {
    const elapsed = Math.floor((this.now() - this.stepStartedAt()) / 1000);
    return Math.max(0, this.PICK_SECONDS - elapsed);
  });

  protected clockPercent(): number {
    return (this.secondsLeft() / this.PICK_SECONDS) * 100;
  }

  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly champs = inject(ChampionDataService);
  protected readonly stats = inject(ChampionStatsService);
  protected readonly matchups = inject(MatchupStatsService);

  protected readonly ctx = inject(TournamentContextService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Shared with the other view; re-exposed so the template reads the same.
  protected readonly roles = this.ctx.roles;
  protected readonly teamName = this.ctx.teamName;
  protected readonly tournaments = this.ctx.tournaments;
  protected readonly currentTournament = this.ctx.currentTournament;
  protected readonly seriesList = this.ctx.seriesList;
  protected readonly selectTournament = (id: string) => this.ctx.selectTournament(id);
  protected readonly gamesFor = (id: string) => this.ctx.gamesFor(id);
  protected readonly seriesScore = (id: string) => this.ctx.seriesScore(id);
  protected readonly usedChampions = (id: string) => this.ctx.usedChampions(id);
  protected readonly usedCount = (id: string) => this.ctx.usedCount(id);
  protected readonly compAvailability = (id: string) => this.ctx.compAvailability(id);
  protected readonly playableComps = (id: string) => this.ctx.playableComps(id);
  protected readonly brokenComps = (id: string) => this.ctx.brokenComps(id);
  protected readonly poolPressure = (id: string) => this.ctx.poolPressure(id);
  protected readonly burnedBefore = (id: string, n: number) => this.ctx.burnedBefore(id, n);
  protected readonly compChampions = () => this.ctx.compChampions();
  /** Jump to this opponent's prep panel on the plan view. */
  protected readonly openPrep = (seriesId: string) => this.ctx.openPrep(seriesId);

  // On the context service, so a shared link can set them and the shell can
  // write them back into the address bar.
  private readonly pickedSeriesId = this.ctx.draftSeriesId;
  private readonly pickedGameId = this.ctx.draftGameId;

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  // ---- Columns or map ---------------------------------------------------------
  //
  // The columns are the client's own layout and the one to draft from. The map
  // puts the same ten champions where they will stand at two minutes, so a
  // draft can be read as five lane matchups instead of two lists — which is
  // what the lane read below is about. Remembered per browser.

  protected readonly layout = signal<DraftLayout>(this.storedLayout());

  private storedLayout(): DraftLayout {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'map' ? 'map' : 'columns';
    } catch {
      return 'columns';
    }
  }

  protected setLayout(layout: DraftLayout): void {
    this.layout.set(layout);
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // A preference, not state; losing it costs one click.
    }
  }

  /** Which colour a side is on this game. Unset means we take blue on the map. */
  protected colourOf(game: SeriesGame, side: DraftSide): 'blue' | 'red' {
    const ours = game.ourSide ?? 'blue';
    return side === 'our' ? ours : ours === 'blue' ? 'red' : 'blue';
  }

  /** The ten seats with their spot on the map, for the map layout. */
  protected mapTokens(game: SeriesGame): { side: DraftSide; index: number; role: Role; champion: string; x: number; y: number }[] {
    const out: { side: DraftSide; index: number; role: Role; champion: string; x: number; y: number }[] = [];
    for (const side of ['our', 'their'] as const) {
      const spots = MAP_SPOTS[this.colourOf(game, side)];
      this.pickSlots(game, side).forEach((slot, index) => {
        out.push({ side, index, role: slot.role, champion: slot.champion, ...spots[slot.role] });
      });
    }
    return out;
  }

  /**
   * The address bar is the share link. Copying it here rather than building a
   * URL by hand means what is copied is exactly what the shell keeps current.
   */
  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toast.show('Draft link copied', {
        kind: 'ok',
        icon: 'link',
        text: 'Anyone on the team who opens it sees this game live as picks are confirmed.'
      });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'Copy the address bar instead.' });
    }
  }

  /**
   * The series being drafted: whatever was picked, else the first live one. A sandbox series is only ever opened by
   * a click or a link (17 Sep 2026): an open rehearsal game made "vs test" the room everyone landed in.
   */
  protected draftSeries(): TournamentSeries | undefined {
    const list = this.seriesList();
    return (
      list.find((s) => s.id === this.pickedSeriesId()) ??
      list.find((s) => !isSandboxSeries(s) && this.gamesFor(s.id).some((g) => g.win === undefined)) ??
      list[0]
    );
  }

  protected draftGame(): SeriesGame | undefined {
    const series = this.draftSeries();
    if (!series) return undefined;
    const games = this.gamesFor(series.id);
    return games.find((g) => g.id === this.pickedGameId()) ?? games.find((g) => g.win === undefined) ?? games.at(-1);
  }

  protected selectDraftSeries(seriesId: string): void {
    this.pickedSeriesId.set(seriesId);
    this.pickedGameId.set('');
  }

  /** Show the champion wall again after the draft is complete, to correct a pick or ban. */
  protected readonly wallAfterDone = signal(false);

  /** The game after this one in the series, if it exists. */
  protected nextGameOf(game: SeriesGame): SeriesGame | undefined {
    return this.gamesFor(game.seriesId).find((g) => g.gameNumber > game.gameNumber);
  }

  /** The result, the same write the plan page makes. */
  protected setGameResult(game: SeriesGame, win: boolean): void {
    const live = this.current(game);
    void this.data.updateSeriesGame({ ...live, win: live.win === win ? undefined : win });
  }

  protected selectDraftGame(gameId: string): void {
    this.pickedGameId.set(gameId);
    this.heldPick.set(null);
  }

  /** Bo3 means three games; there is nothing to draft beyond that. */
  protected canAddDraftGame(series: TournamentSeries): boolean {
    return this.ctx.canAddGame(series);
  }

  protected nextGameNumber(series: TournamentSeries): number {
    return this.gamesFor(series.id).length + 1;
  }

  /**
   * Add the next game and open it, so a series can be drafted from this view
   * without going back to Plan to create the game first.
   */
  protected async addDraftGame(series: TournamentSeries): Promise<void> {
    const existing = this.gamesFor(series.id);
    if (!this.ctx.canAddGame(series)) return;
    await this.data.createSeriesGame({
      seriesId: series.id,
      gameNumber: existing.length + 1,
      ourChampions: [],
      theirChampions: []
    });
    const added = this.gamesFor(series.id).at(-1);
    this.pickedGameId.set(added?.id ?? '');
  }

  /** Comps and pools open on click, so the detail is there when it is wanted. */
  private readonly openComps = signal<ReadonlySet<string>>(new Set());
  private readonly openPools = signal<ReadonlySet<string>>(new Set());

  protected isCompOpen(compId: string): boolean {
    return this.openComps().has(compId);
  }

  protected toggleComp(compId: string): void {
    this.openComps.update((ids) => this.flip(ids, compId));
  }

  protected isPoolOpen(name: string): boolean {
    return this.openPools().has(name);
  }

  protected togglePool(name: string): void {
    this.openPools.update((ids) => this.flip(ids, name));
  }

  private flip(ids: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(ids);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  }

  // ---- The comps board, as a popup (12 Sep 2026) -------------------------------------
  //
  // The lead: "remove the comps from the actual draft for now, make it a popup if need be … then we
  // can have a fixed view and keep it focused on what needs focusing." The board was the last rows of
  // the stage, under the wall, the advice, the lane read and the bans. It is the same board in a
  // native <dialog> now, opened from a pill in the head.

  protected readonly compsShown = signal(false);
  private readonly compsDialog = viewChild<ElementRef<HTMLDialogElement>>('compsDialog');

  /** Games a comp's row needs before it prints "83% · 6"; under it the row says "few games" (17 Sep 2026). */
  protected readonly COMP_RATE_MIN_GAMES = COMP_RATE_MIN_GAMES;

  /** Into the top layer as soon as it is on the page. jsdom has no showModal, and is left alone. */
  private readonly openCompsDialog = afterRenderEffect(() => {
    const dialog = this.compsDialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  });

  /** A game removed while the board is open must not leave it armed for the next one. */
  private readonly closeCompsWithoutGame = effect(() => {
    if (!this.draftGame()) untracked(() => this.compsShown.set(false));
  });

  protected showComps(): void {
    this.compsShown.set(true);
  }

  protected hideComps(): void {
    const dialog = this.compsDialog()?.nativeElement;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    this.compsShown.set(false);
  }

  /** Escape: closed through the signal, or the browser shuts the dialog behind its back. */
  protected onCompsCancel(event: Event): void {
    event.preventDefault();
    this.hideComps();
  }

  /** A click on the backdrop lands on the dialog itself; a click inside the card never does. */
  protected onCompsBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.hideComps();
  }

  /**
   * A champion picked from a comp. While the sequence runs it is held, exactly as a click on the wall
   * holds it — the sequence decides the seat and the drafter confirms in the room — and the popup
   * closes so the confirm slot is in view. The board always wrote a pick straight into a seat, which
   * mid-sequence puts a pick on the board without moving the step: the free-form edit that must
   * stand down while a sequence runs. With no sequence running it picks as it always did.
   */
  protected pickFromComps(game: SeriesGame, champion: string, role?: Role): void {
    if (this.sequenceActive(game)) {
      // A seat or ban still aimed from earlier would turn the hold into an instant replace of a
      // confirmed pick, behind a popup that hides the line saying so. From here it always holds.
      this.cancelReplace();
      // On our pick, the comp names the seat: aim the wall's lane at it while that seat is open, so
      // the held pick is proposed into it rather than wherever the champion's lanes point first.
      const step = this.step(game);
      const seatOpen = role && !this.pickSlots(this.current(game)).find((s) => s.role === role)?.champion;
      if (seatOpen && step?.action === 'pick' && this.isOurTurn(game)) this.wall()?.chooseLane(role);
      this.proposeFromSequence(champion);
      this.hideComps();
      return;
    }
    this.togglePick(game, champion, role);
  }

  /** Mid-sequence a champion on the board, or one this step cannot take, cannot be held. */
  protected compsPickBlocked(game: SeriesGame, champion: string, role?: Role): boolean {
    if (!this.sequenceActive(game)) return this.pickBlocked(game, champion, role);
    const key = normalizeChampion(champion);
    return this.isPicked(game, champion) || this.sequenceUnavailable(game).some((c) => normalizeChampion(c) === key);
  }

  protected compsPickHint(game: SeriesGame, champion: string, role?: Role): string {
    if (!this.sequenceActive(game)) return this.pickHint(game, champion, role);
    if (this.compsPickBlocked(game, champion, role)) return champion + ' cannot be taken on this step';
    const step = this.step(game);
    const whose = this.isOurTurn(game) ? 'our' : 'their';
    return 'Hold ' + champion + ' as ' + whose + ' ' + (step?.action ?? 'pick') + ', then confirm it in the room';
  }

  /**
   * What a comp's seat would field now, for every reader in the room that wants one champion a seat
   * (20 Sep 2026): the seat's highest-ranked champion this board has not taken, so a comp whose
   * Nautilus is banned answers Leona rather than a champion nobody can pick.
   *
   * Read off the availability row rather than the comp document, which is the point: the row already
   * decided what is gone, so a chip in the popup and the verdict above it cannot disagree.
   */
  private seatBest(comp: CompAvailability, role: Role): string {
    return comp.seats.find((seat) => seat.role === role)?.best ?? '';
  }

  /**
   * What a seat would field if the drafter took *this* champion: the champion itself when the seat
   * names it at any rank and the board still has it, otherwise the seat's best (20 Sep 2026).
   *
   * The confirm line asks what holding this one champion does for us, and the lead has decided a game
   * played on a listed fallback counts as that comp — so holding Leona while Nautilus is still free is
   * Dive with one swap, not "in no comp of ours". The lane shortlist deliberately does **not** use this:
   * there every champion is a candidate, and letting a fallback stand in for its own seat would rank
   * Leona level with Nautilus and put Dive behind both.
   */
  private seatIfTaken(comp: CompAvailability, role: Role, champion: string): string {
    const key = normalizeChampion(champion);
    const seat = comp.seats.find((s) => s.role === role);
    const held = seat?.options.find((o) => normalizeChampion(o.champion) === key && !o.gone);
    return held?.champion ?? seat?.best ?? '';
  }

  /** The seats of a comp against the live board, for the popup's expanded row. */
  protected compSeats(comp: CompAvailability): SeatAvailability[] {
    return comp.seats;
  }

  /** A seat's role as the pick path takes it: a seat with no role aims at no lane rather than at ''. */
  protected seatRole(seat: SeatAvailability): Role | undefined {
    return seat.role || undefined;
  }

  /**
   * What one option in a seat is, then what clicking it would do. A gone champion keeps its chip — it is
   * the reason the seat is on a fallback — and says so instead of offering a hold it cannot honour.
   */
  protected seatOptionHint(game: SeriesGame, seat: SeatAvailability, option: SeatOptionState): string {
    const where = seat.role || 'Seat';
    const place = option.rank === 0 ? `${where} priority` : `${where} fallback ${option.rank}`;
    if (option.gone) return `${option.champion} — ${place}, gone from this board`;
    return `${option.champion} — ${place}. ${this.compsPickHint(game, option.champion, this.seatRole(seat))}`;
  }

  /** How many swaps a comp is running, for its chip: seats alive on a fallback rather than the priority. */
  protected compSwapTip(comp: CompAvailability): string {
    const swapped = comp.seats.filter((seat) => seat.substituted);
    return swapped
      .map((seat) => `${seat.role || 'Seat'}: ${seat.options[0].champion} gone, playing ${seat.best}`)
      .join('\n');
  }

  /** Which seats a broken comp has lost, and to what — the tip on its row, in place of a flat champion list. */
  protected compLostTip(comp: CompAvailability): string {
    const lost = comp.seats.filter((seat) => seat.lost);
    if (!lost.length) return '';
    return lost
      .map((seat) => `${seat.role || 'Seat'} has nothing left: ${seat.options.map((o) => o.champion).join(', ')} gone`)
      .join('\n');
  }

  // ---- Drafting a champion straight off the board ------------------------
  //
  // Mid-draft the board is the fastest place to reach a champion: it is already
  // showing the comp you are building. Clicking one adds it to our picks rather
  // than opening a champion page, which is not what anyone wants at the table.

  /**
   * Our picks by role. Stored positionally — index 0 is Top, 4 is Support — so
   * a half-finished draft still says which seats are filled. Empty slots are
   * blank strings, which every consumer already filters out.
   */
  protected pickSlots(game: SeriesGame, side: DraftSide = 'our'): { role: Role; champion: string }[] {
    const picks = (side === 'our' ? game.ourChampions : game.theirChampions) ?? [];
    return this.roles.map((role, i) => ({ role, champion: picks[i] ?? '' }));
  }

  // ---- Moving a pick between seats ---------------------------------------
  //
  // Flex picks change seat mid-draft. Click the champion to lift it, click the
  // seat it should go to. Two clicks for any move — arrows would be four to get
  // Support up to Top — and it swaps rather than overwrites, so the pick that
  // was there is not lost.

  private readonly heldPick = signal<{ side: DraftSide; index: number } | null>(null);

  protected isHeld(side: DraftSide, index: number): boolean {
    const held = this.heldPick();
    return held?.side === side && held.index === index;
  }

  /** Only the team being moved lights up as a drop target. */
  protected isMovingPick(side: DraftSide): boolean {
    return this.heldPick()?.side === side;
  }

  /**
   * Drag a seat onto another to swap them — the same move as lift-and-place,
   * for people who reach for a drag first. Both stay: a drag is quicker when
   * you know where a pick is going, two clicks are steadier mid-draft.
   *
   * Dragging across teams is refused rather than silently ignored: seats are
   * per-side and a champion cannot move to the other team.
   */
  protected dropSeat(game: SeriesGame, side: DraftSide, to: number, payload: string): void {
    const [fromSide, fromIndex] = (payload || '').split(':');
    const from = Number(fromIndex);
    if (fromSide !== side || !Number.isInteger(from) || from === to) return;

    const live = this.current(game);
    const next = this.pickSlots(live, side).map((sl) => sl.champion);
    [next[from], next[to]] = [next[to], next[from]];
    void this.data.updateSeriesGame({
      ...live,
      ...(side === 'our' ? { ourChampions: next } : { theirChampions: next })
    });
    this.heldPick.set(null);
  }

  protected liftOrPlace(game: SeriesGame, side: DraftSide, index: number): void {
    const held = this.heldPick();

    // Nothing lifted, or lifting on the other team: start a new move.
    if (!held || held.side !== side) {
      if (this.pickSlots(game, side)[index].champion) this.heldPick.set({ side, index });
      return;
    }
    if (held.index === index) {
      this.heldPick.set(null);
      return;
    }

    const next = this.pickSlots(game, side).map((s) => s.champion);
    [next[held.index], next[index]] = [next[index], next[held.index]];
    void this.data.updateSeriesGame(this.withPicks(game, side, next));
    this.heldPick.set(null);
  }

  protected moveHint(game: SeriesGame, side: DraftSide, index: number): string {
    const slots = this.pickSlots(game, side);
    const held = this.heldPick();
    if (held?.side === side) {
      if (held.index === index) return 'Click again to cancel';
      const moving = slots[held.index].champion;
      const sitting = slots[index].champion;
      return sitting ? 'Swap ' + moving + ' with ' + sitting : 'Move ' + moving + ' to ' + slots[index].role;
    }
    return slots[index].champion ? 'Move ' + slots[index].champion + ' to another role' : '';
  }

  protected setPickAt(game: SeriesGame, side: DraftSide, index: number, champion: string): void {
    const next = this.pickSlots(game, side).map((s) => s.champion);
    next[index] = champion;
    void this.data.updateSeriesGame(this.withPicks(game, side, next));
  }

  private withPicks(game: SeriesGame, side: DraftSide, picks: string[]): SeriesGame {
    return side === 'our' ? { ...game, ourChampions: picks } : { ...game, theirChampions: picks };
  }

  /** From a picker, which hands back an array of at most one champion. */
  protected setPickFromPicker(game: SeriesGame, side: DraftSide, index: number, champs: string[]): void {
    this.setPickAt(game, side, index, champs[0] ?? '');
  }

  protected pickedCount(game: SeriesGame, side: DraftSide = 'our'): number {
    return this.pickSlots(game, side).filter((s) => s.champion).length;
  }

  /** The role a player plays, so a pick off their pool lands in the right seat. */
  protected roleOfPlayer(name: string): Role | undefined {
    return this.data.players().find((p) => p.name === name)?.role;
  }

  protected isPicked(game: SeriesGame, champion: string): boolean {
    return blockedSet(game.ourChampions).has(normalizeChampion(champion));
  }

  protected picksFull(game: SeriesGame): boolean {
    return this.pickSlots(game).every((s) => Boolean(s.champion));
  }

  /**
   * Puts a champion in its own role slot, or takes it back out. A role is
   * passed when the board knows it — a comp lineup row, or a player's pool —
   * otherwise it drops into the first free seat.
   */
  protected togglePick(game: SeriesGame, champion: string, role?: Role): void {
    if (!champion) return;
    const slots = this.pickSlots(game);

    const held = slots.findIndex((s) => normalizeChampion(s.champion) === normalizeChampion(champion));
    if (held >= 0) {
      this.setPickAt(game, 'our', held, '');
      return;
    }

    const target = role ? this.roles.indexOf(role) : slots.findIndex((s) => !s.champion);
    if (target < 0) return;
    this.setPickAt(game, 'our', target, champion);
  }

  /** Why a chip cannot be clicked, so the reason is not a mystery. */
  protected pickHint(game: SeriesGame, champion: string, role?: Role): string {
    if (this.isPicked(game, champion)) return 'Picked — click to undo';
    if (role && this.pickSlots(game)[this.roles.indexOf(role)]?.champion) {
      return role + ' is already picked';
    }
    if (this.picksFull(game)) return 'All five picked';
    return 'Pick ' + champion + (role ? ' at ' + role : '');
  }

  /** True when this champion cannot go anywhere right now. */
  protected pickBlocked(game: SeriesGame, champion: string, role?: Role): boolean {
    if (this.isPicked(game, champion)) return false;
    if (role) return Boolean(this.pickSlots(game)[this.roles.indexOf(role)]?.champion);
    return this.picksFull(game);
  }

  /** Drop the last game of the series; removing an earlier one would renumber. */
  protected async removeDraftGame(game: SeriesGame): Promise<void> {
    const drafted = (game.bans ?? []).length
      + [...(game.ourChampions ?? []), ...(game.theirChampions ?? [])].filter(Boolean).length;
    const result = game.win === undefined ? '' : game.win ? 'its win' : 'its loss';
    const goes = [drafted ? `the ${drafted} bans and picks drafted into it` : '', result].filter(Boolean).join(' and ');
    const ok = await this.confirm.ask({
      title: `Remove game ${game.gameNumber}?`,
      body: goes ? `${goes[0].toUpperCase()}${goes.slice(1)} go too.` : undefined,
      confirmLabel: 'Remove game',
      danger: true
    });
    // The draft is live and shared: act on the game as it is after the answer, not as it was when asked.
    const live = this.data.seriesGames().find((g) => g.id === game.id);
    if (!ok || !live) return;
    this.pickedGameId.set('');
    void this.data.deleteSeriesGame(live.id);
    if (gameHasContent(live)) {
      this.toast.show(`Removed game ${live.gameNumber}`, {
        kind: 'warn',
        icon: 'delete',
        timeout: 12000,
        action: {
          label: 'Undo',
          run: () =>
            void this.data.restoreSeriesGame(live).then((why) => {
              if (why) this.toast.show(`Game ${live.gameNumber} stayed removed`, { text: `Undo could not put it back: ${why}.`, kind: 'warn' });
            })
        }
      });
    }
  }

  protected isLastGame(game: SeriesGame): boolean {
    return this.gamesFor(game.seriesId).at(-1)?.id === game.id;
  }

  protected isDraftGame(game: SeriesGame): boolean {
    return this.draftGame()?.id === game.id;
  }

  // ---- Live draft --------------------------------------------------------
  //
  // Mid-draft the board keeps moving: bans land, the enemy takes something. The
  // series view answers "what survives into the next game"; this answers "what
  // survives right now", which is the question being asked at the table.

  /**
   * Everything we cannot draft into a comp this game. Our own picks are left
   * out: two of Engage already on the board means Engage is live, not blocked.
   */
  private draftBlocked(game: SeriesGame): Set<string> {
    return blockedSet(
      this.burnedBefore(game.seriesId, game.gameNumber),
      game.bans,
      game.theirChampions
    );
  }

  protected draftComps(game: SeriesGame): CompAvailability[] {
    return compAvailability(this.compChampions(), this.draftBlocked(game));
  }

  protected draftPlayable(game: SeriesGame): CompAvailability[] {
    return this.draftComps(game).filter((c) => c.playable);
  }

  protected draftBroken(game: SeriesGame): CompAvailability[] {
    return this.draftComps(game).filter((c) => !c.playable);
  }

  /**
   * Pool left per player. Our own picks *do* count here — once a champion is on
   * the board nobody else can have it, so it is gone from everyone's options.
   */
  protected draftPools(game: SeriesGame): PoolPressure[] {
    const blocked = blockedSet(
      this.burnedBefore(game.seriesId, game.gameNumber),
      game.bans,
      game.theirChampions,
      game.ourChampions
    );
    return poolPressure(
      this.data.starters().map((p) => ({ name: p.name, role: p.role, pool: p.top3 ?? [] })),
      blocked
    );
  }

  protected burnedBeforeCount(game: SeriesGame): number {
    return this.burnedBefore(game.seriesId, game.gameNumber).length;
  }

  /** What the series has already spent, split by who spent it, for the strip in the confirm slot. */
  protected burnedBySide(game: SeriesGame, side: 'our' | 'their'): string[] {
    return this.ctx.burnedBeforeBySide(game.seriesId, game.gameNumber)[side];
  }

  /**
   * Which starter lists a burned champion in their pool, if any. Under fearless
   * that is the burn that hurts — a comfort pick gone for the rest of the series
   * — so the strip marks it rather than leaving the drafter to remember.
   */
  protected burnedPoolOwner(champion: string): string | undefined {
    const key = normalizeChampion(champion);
    return this.data.starters().find((p) => (p.top3 ?? []).some((c) => normalizeChampion(c) === key))?.name;
  }

  protected burnedNote(game: SeriesGame): string {
    const n = this.burnedBeforeCount(game);
    if (!n) return 'Nothing burned yet — this is the first game of the series.';
    return `${n} champion${n === 1 ? '' : 's'} used earlier in this series and unavailable under fearless.`;
  }

  /**
   * Everything already spoken for this game: burned in an earlier game of the
   * series, banned, or drafted by either team. A ban is the one case that can
   * still land on a champion the other side has not taken, so existing bans are
   * left to the bans picker's own list.
   */
  protected unavailableFor(game: SeriesGame, kind: 'ban' | 'pick'): string[] {
    const onBoard = [
      ...this.burnedBefore(game.seriesId, game.gameNumber),
      ...(game.ourChampions ?? []).filter(Boolean),
      ...(game.theirChampions ?? []).filter(Boolean)
    ];
    return kind === 'ban' ? onBoard : [...onBoard, ...(game.bans ?? [])];
  }

  protected setGameBans(game: SeriesGame, bans: string[]): void {
    void this.data.updateSeriesGame({ ...game, bans: bans.length ? bans : undefined });
  }

  // ---- The shared champion grid -------------------------------------------
  //
  // One wall of champions for the whole draft rather than a typeahead in each
  // of the eleven fields. A target is aimed first — a ban, or a seat on either
  // team — and every click lands there, which is the only way to keep up with a
  // draft happening in real time.
  //
  // The enemy side gets the same treatment because under fearless their picks
  // burn our pool too: entering what they took is not bookkeeping, it is how
  // the "still playable" list stays true.

  protected readonly target = signal<DraftTarget>({ kind: 'ban' });

  protected isTargeted(kind: 'ban'): boolean;
  protected isTargeted(kind: 'pick', side: DraftSide, index: number): boolean;
  protected isTargeted(kind: 'ban' | 'pick', side?: DraftSide, index?: number): boolean {
    const t = this.target();
    if (t.kind !== kind) return false;
    return t.kind === 'ban' || (t.side === side && t.index === index);
  }

  protected aimAtBans(): void {
    this.target.set({ kind: 'ban' });
  }

  protected aimAtPick(side: DraftSide, index: number): void {
    this.target.set({ kind: 'pick', side, index });
  }

  /** Aim at one made ban, to replace it: the next wall click lands there. */
  protected aimAtBan(index: number): void {
    const aimed = this.target();
    if (aimed.kind === 'ban' && aimed.index === index) {
      this.target.set({ kind: 'ban' });
      return;
    }
    this.target.set({ kind: 'ban', index });
  }

  protected isBanTargeted(index: number): boolean {
    const aimed = this.target();
    return aimed.kind === 'ban' && aimed.index === index;
  }

  /**
   * The flat index in `bans` of a side's k-th ban. Bans are one flat list in
   * sequence order; which side made one is read off its position.
   */
  protected banIndexOf(game: SeriesGame, side: DraftSide, k: number): number {
    const live = this.current(game);
    let seen = -1;
    for (let i = 0; i < (live.bans ?? []).length; i += 1) {
      const team = banTeamAt(i);
      const ours = team === live.ourSide;
      if ((side === 'our') === ours) {
        seen += 1;
        if (seen === k) return i;
      }
    }
    return -1;
  }

  /** What a wall click would replace right now, or null when it would be a normal pick. */
  protected replacing(game: SeriesGame): { label: string } | null {
    const live = this.current(game);
    if (!this.sequenceActive(live)) return null;
    const aimed = this.target();
    if (aimed.kind === 'ban' && aimed.index !== undefined) {
      const champ = (live.bans ?? [])[aimed.index];
      return champ ? { label: this.banLabel(champ) } : null;
    }
    if (aimed.kind === 'pick') {
      const slot = this.pickSlots(live, aimed.side)[aimed.index];
      return slot?.champion ? { label: `${slot.champion} at ${slot.role}` } : null;
    }
    return null;
  }

  /** "the Ahri ban", or "the not-seen ban" for a ban nobody saw (17 Sep 2026). */
  private banLabel(champion: string): string {
    return isNoBan(champion) ? 'the not-seen ban' : `the ${champion} ban`;
  }

  protected cancelReplace(): void {
    this.target.set({ kind: 'ban' });
  }

  /**
   * What the grid refuses, which depends on what is aimed at. A ban may still
   * land on a champion nobody has drafted, so bans and picks ask different
   * questions — `unavailableFor` already draws that line.
   */
  protected gridUnavailable(game: SeriesGame): string[] {
    return this.unavailableFor(game, this.target().kind === 'ban' ? 'ban' : 'pick');
  }

  /**
   * Ticked, and clickable again to undo. Only bans: a drafted champion is
   * blocked rather than ticked, and comes off through its seat's own control.
   */
  protected gridTaken(game: SeriesGame): Set<string> {
    if (this.target().kind !== 'ban') return new Set<string>();
    return blockedSet(game.bans);
  }

  protected gridPick(game: SeriesGame, name: string): void {
    const aimed = this.target();

    if (aimed.kind === 'ban') {
      // A ban nobody saw is filled in place, and on a drafted board a ban taken off leaves one (17 Sep 2026):
      // with all ten in, a not-seen ban read off the client afterwards used to be a click that did nothing.
      const bans = game.bans ?? [];
      const at = bans.findIndex((b) => normalizeChampion(b) === normalizeChampion(name));
      const click = banWallClick(bans, at, name, game.ourSide, MAX_BANS);
      this.setGameBans(game, click.bans);
      if (click.filled !== null) {
        const place = banPlaceWords(click.filled, game.ourSide);
        this.toast.show(`Replaced the not-seen ban with ${name}${place ? ` (${place})` : ''}`);
      }
      return;
    }

    this.setPickAt(game, aimed.side, aimed.index, name);

    // Advance to the next empty seat on the same side, so five picks are five
    // clicks. Staying put would mean the next click overwrote what was just set.
    const slots = this.pickSlots(game, aimed.side);
    const next = slots.findIndex((s, i) => i > aimed.index && !s.champion);
    if (next >= 0) this.aimAtPick(aimed.side, next);
  }

  // ---- The draft sequence -------------------------------------------------
  //
  // With a side chosen, the draft stops being eleven fields to fill in any
  // order and becomes twenty steps with exactly one legal move each. The screen
  // then only has to answer "whose turn, ban or pick" — which is a lookup — and
  // a pick is confirmed rather than typed, the way it happens at the table.

  protected readonly pending = signal<string | null>(null);
  /**
   * When the held champion was taken, so a second Enter can lock it without a double tap doing it (21 Sep 2026).
   * Set beside every hold; read only by `wallEmptyEnter`.
   */
  private heldAt = 0;

  /**
   * A write is in flight. Confirming is one click and a draft is drafted fast,
   * so two clicks can land inside one round trip; without this the second reads
   * the state the first has not finished writing.
   */
  private readonly committing = signal(false);

  /**
   * The freshest copy of a game.
   *
   * The template hands components the `game` object it rendered with, which is
   * a snapshot. Every confirm builds the next state from the current one, so
   * confirming twice quickly had both build from the same snapshot and the
   * second silently overwrote the first — a pick simply vanished from the
   * board. Re-reading by id is what makes each step build on the last.
   */
  private current(game: SeriesGame): SeriesGame {
    return this.data.seriesGames().find((g) => g.id === game.id) ?? game;
  }

  protected ourSide(game: SeriesGame): 'blue' | 'red' | null {
    return game.ourSide ?? null;
  }

  protected async setOurSide(game: SeriesGame, side: 'blue' | 'red'): Promise<void> {
    await this.data.updateSeriesGame({ ...game, ourSide: side, draftStep: 0 });
    this.pending.set(null);
    this.restartClock();
  }

  /**
   * A board with nothing on it yet, and so safe to block on the side question.
   *
   * Games drafted before sides existed carry picks and bans but no `ourSide`.
   * Demanding an answer from those would trap a finished record behind a
   * question nobody was asked at the time, so the modal only appears on a board
   * that has not started — where the answer still changes what happens next.
   */
  protected freshBoard(game: SeriesGame): boolean {
    const live = this.current(game);
    return (
      !live.ourSide &&
      positionOf(live) === 0 &&
      !(live.bans ?? []).some(Boolean) &&
      !(live.ourChampions ?? []).some(Boolean) &&
      !(live.theirChampions ?? []).some(Boolean)
    );
  }

  // ---- A game played without the room (17 Sep 2026) -------------------------------------------------
  //
  // On 10 Sep Paradox Requiem's games 1 and 2 were back-filled through the live sequence with the Skip
  // bans test aid two minutes before game 3, which wrote random bans; nothing had said the two games
  // were empty, and an empty earlier game leaves the burn, the advisor and the Comps popup wrong. The
  // side question now names those games, and offers to enter a played game whole: our side, both fives
  // in seat order, the result when there is one. One dialog, in the top layer, so nothing in the room
  // moves while it is open.

  /** Earlier games of a fearless series short of five picks a side. A series that burns nothing misses nothing. */
  protected sideGaps(game: SeriesGame): BurnGap[] {
    return this.ctx.isFearless(game.seriesId) ? gapsBefore(this.gamesFor(game.seriesId), game.gameNumber) : [];
  }

  protected readonly gapsLine = gapsLine;

  /** The game being entered, and the game the room was showing when the dialog opened. */
  private readonly playedGameId = signal('');
  private readonly playedFromId = signal('');
  protected readonly playedGame = computed(() => {
    const id = this.playedGameId();
    return id ? this.data.seriesGames().find((g) => g.id === id) : undefined;
  });
  protected readonly playedSide = signal<'blue' | 'red' | null>(null);
  protected readonly playedOurs = signal<string[]>([]);
  protected readonly playedTheirs = signal<string[]>([]);
  protected readonly playedWin = signal<boolean | undefined>(undefined);

  /** A game deleted, or the room left without a game, while the dialog is open closes it rather than leaving it armed. */
  private readonly dropPlayedWithoutGame = effect(() => {
    if (this.playedGameId() && (!this.playedGame() || !this.draftGame())) untracked(() => this.playedGameId.set(''));
  });

  /** Open the dialog on a game, filled with whatever it already holds. */
  protected openPlayed(gameId: string, from: SeriesGame): void {
    const game = this.data.seriesGames().find((g) => g.id === gameId);
    if (!game) return;
    // Game 1's side is the one the pre-series 1v1 settled, when Prep recorded it.
    const agreed = game.gameNumber === 1 ? this.data.tournamentSeries().find((s) => s.id === game.seriesId)?.side : undefined;
    this.playedSide.set(game.ourSide ?? agreed ?? null);
    this.playedOurs.set([...(game.ourChampions ?? [])]);
    this.playedTheirs.set([...(game.theirChampions ?? [])]);
    this.playedWin.set(game.win);
    this.playedFromId.set(from.id);
    this.playedGameId.set(game.id);
  }

  protected closePlayed(): void {
    this.playedGameId.set('');
  }

  /**
   * Escape in a picker whose list is showing closes the list and keeps the form: the dialog's cancel
   * would otherwise throw away every champion typed so far. The picker closes its list only on Escape in
   * its own input, and has already asked to by the time the key reaches here (the list is still on the
   * page until the view updates). With focus on an option or a chip instead, nothing closed the list and
   * every Escape was swallowed until a click outside (review, 17 Sep 2026), so focus goes back to the
   * input and the Escape is handed to it there. A picker with no input, all five in, has no list to close,
   * and the Escape cancels the dialog as usual.
   */
  protected keepPlayedOpen(event: Event): void {
    const target = event.target as HTMLElement | null;
    const picker = target?.closest?.('.champ-picker');
    const input = picker?.querySelector<HTMLInputElement>('.champ-picker-input');
    if (!input || !picker?.querySelector('.champ-picker-menu, .champ-picker-none')) return;
    event.preventDefault();
    if (target === input) return;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }

  /** Win and Loss are optional: pressing the chosen one again takes the result off. */
  protected togglePlayedWin(win: boolean): void {
    this.playedWin.update((was) => (was === win ? undefined : win));
  }

  /** Counted off the seats Save writes, so the note never promises a champion the save would cut. */
  private filledSeats(list: readonly string[]): number {
    return playedSeats(list).filter(Boolean).length;
  }

  /** The seat the next champion lands in: a seated picker fills the first empty one, Top to Support. */
  protected nextSeat(list: readonly string[]): Role | '' {
    return this.roles.find((_, i) => !list[i]?.trim()) ?? '';
  }

  protected seatPlaceholder(list: readonly string[]): string {
    const seat = this.nextSeat(list);
    return seat ? `${seat}…` : '';
  }

  /**
   * What neither five can take: the other five in this dialog, and in a fearless series every champion
   * another game of it holds. Bans are not refused, because a back-filled game's bans are the ones this
   * dialog exists to stop trusting.
   */
  protected playedUnavailable(game: SeriesGame, side: DraftSide): string[] {
    const across = side === 'our' ? this.playedTheirs() : this.playedOurs();
    if (!this.ctx.isFearless(game.seriesId)) return across.filter(Boolean);
    const others = this.gamesFor(game.seriesId).filter((g) => g.id !== game.id);
    return uniqueChampions(across, ...others.map((g) => g.ourChampions), ...others.map((g) => g.theirChampions));
  }

  protected readonly playedCanSave = computed(
    () => !!this.playedSide() && this.filledSeats(this.playedOurs()) + this.filledSeats(this.playedTheirs()) > 0
  );

  /** One muted line under the form: what Save still needs, else how many champions the burn will miss. */
  protected readonly playedNote = computed(() => {
    const game = this.playedGame();
    if (!game) return '';
    if (!this.playedSide()) return 'Choose our side to save.';
    const filled = this.filledSeats(this.playedOurs()) + this.filledSeats(this.playedTheirs());
    if (!filled) return 'Add at least one champion to save.';
    const missing = 10 - filled;
    if (!missing || !this.ctx.isFearless(game.seriesId)) return '';
    return `Saved like this, the burn will miss ${missing} champion${missing === 1 ? '' : 's'} from game ${game.gameNumber}.`;
  });

  /**
   * Write the game as played, in one save built by `playedGameWrite` (the side, both fives as seats, the
   * result, the step at the end; the hold and the pick log go, the bans and the rest stay). Then the room
   * shows the game `gameAfterPlayed` names: the one it was on when an earlier game was entered from the
   * warning, else the next game still to draft, else this one, whose done bar offers the next game.
   */
  protected async savePlayed(): Promise<void> {
    const game = this.playedGame();
    const side = this.playedSide();
    if (!game || !side || !this.playedCanSave()) return;
    const from = this.playedFromId();
    const saved = playedGameWrite(this.current(game), {
      ourSide: side,
      ours: this.playedOurs(),
      theirs: this.playedTheirs(),
      win: this.playedWin()
    });
    this.closePlayed();
    await this.data.updateSeriesGame(saved);

    const after = gameAfterPlayed(this.gamesFor(saved.seriesId), saved, from);
    if (after.back) {
      this.pickedGameId.set(after.id);
      return;
    }
    this.selectDraftGame(after.id);
    this.pending.set(null);
    this.restartClock();
  }

  /**
   * Who takes the final pick of the phase in progress, in our own terms.
   *
   * The side picking last sees the other's champion before choosing, so it
   * answers rather than commits. Worth saying out loud: it decides whether a
   * flex pick should be held back or spent, and the sequence has always known
   * without ever mentioning it.
   */
  protected lastPickIsOurs(game: SeriesGame): boolean | null {
    const closing = lastPickOfPhase(positionOf(game));
    if (!closing || !game.ourSide) return null;
    return closing === game.ourSide;
  }

  protected picksLeft(game: SeriesGame): number {
    return picksLeftInPhase(positionOf(game));
  }

  /**
   * Comps of ours that a champion belongs to — the cost of banning it.
   *
   * At ban time the useful question inverts: not "does this help us" but "does
   * banning it cost us". A ban is permanent for the whole series under
   * fearless, so banning a champion three of our comps depend on spends one of
   * their bans for them.
   *
   * Two answers since fallbacks (20 Sep 2026): the comps the ban *takes*, and
   * the comps that carry on without it because the seat named somebody else.
   * Only the first is a cost.
   */
  protected banCost(game: SeriesGame, champion: string): CompCost {
    if (isNoBan(champion)) return { breaks: [], weakens: [] };
    return compsUsing(champion, this.compAvailability(game.seriesId));
  }

  /**
   * The one line under a held ban, or null when the ban costs us nothing (20 Sep 2026).
   *
   * Counted on `breaks`, worded on both: "takes 2 of our comps" is the cost, and a comp the ban only
   * thins is said as covered rather than counted as lost. Before fallbacks the line said "also in N
   * of our comps", which with a fallback behind the seat was simply untrue.
   *
   * One call a render on purpose — the template reads the line, the tip and the tone off this object
   * — and it stays a single inline span, because the confirm slot's height is fixed.
   */
  protected banCostRead(game: SeriesGame, champion: string): { line: string; tip: string; covered: boolean } | null {
    const { breaks, weakens } = this.banCost(game, champion);
    if (!breaks.length && !weakens.length) return null;

    const line = breaks.length
      ? weakens.length
        ? `takes ${breaks.length} of ours, ${weakens.length} covered`
        : `takes ${breaks.length} of our comps`
      : `${weakens.length} of ours, covered`;
    const tip = [
      breaks.length ? `Banning ${champion} takes: ${breaks.join(', ')}` : '',
      weakens.length ? `Covered by a fallback: ${weakens.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    return { line, tip, covered: !breaks.length };
  }

  /**
   * The opponent whose seat is on the clock, if we have scouted them.
   *
   * Only shown on their pick, which is the one moment it answers a live
   * question — the rest of the time it is a dossier nobody asked to read. The
   * seat comes from the role recorded on their roster, since the draft itself
   * never says which of them is picking.
   */
  protected pickingOpponent(game: SeriesGame): OpponentPlayer | null {
    const step = this.step(game);
    if (!step || step.action !== 'pick' || this.isOurTurn(game)) return null;

    const roster = this.draftSeries()?.opponentPlayers ?? [];
    if (!roster.length) return null;

    // Which of their seats is still empty: that is who is about to pick. With
    // several open it is a guess, so only the unambiguous case is shown.
    const open = this.pickSlots(game, 'their')
      .map((slot, index) => (slot.champion ? null : this.roles[index]))
      .filter((role): role is Role => !!role);
    if (open.length !== 1) return null;

    return roster.find((p) => p.role === open[0]) ?? null;
  }

  /** Their pool minus what is already gone — the burn applies to them too. */
  protected opponentPool(game: SeriesGame, player: OpponentPlayer): string[] {
    const blocked = blockedSet(this.unavailableFor(game, 'pick'));
    return (player.top3 ?? []).filter((champ) => !blocked.has(normalizeChampion(champ)));
  }

  /**
   * What to ban, from what has actually beaten the people we are playing.
   *
   * Empty until the opponent is scouted, and deliberately so: this is the panel
   * that waited for the roster rather than inventing a ban list from our own
   * comps. Capped at five, because a ban phase is thirty seconds long.
   */
  protected banIdeas(game: SeriesGame): BanSuggestion[] {
    const roster = this.draftSeries()?.opponentPlayers ?? [];
    if (!roster.length) return [];

    const blocked = blockedSet(this.unavailableFor(game, 'ban'));
    return banSuggestions(
      roster,
      (champ) => !blocked.has(normalizeChampion(champ)),
      // The cost of banning one of their answers is the comps it takes: a comp whose seat names a
      // fallback is not spent by the ban, so since 20 Sep 2026 it no longer marks the idea costly.
      (champ) => [...this.banCost(game, champ).breaks]
    ).slice(0, 5);
  }

  protected readonly positionOf = positionOf;

  protected step(game: SeriesGame): DraftStep | null {
    return stepAt(positionOf(game));
  }

  protected sequenceDone(game: SeriesGame): boolean {
    return isComplete(positionOf(game));
  }

  protected progress(game: SeriesGame): number {
    return draftProgress(positionOf(game));
  }

  /** Whether the side on turn is us, so the screen can say "your pick". */
  protected isOurTurn(game: SeriesGame): boolean {
    const step = this.step(game);
    return !!step && !!game.ourSide && step.team === game.ourSide;
  }

  protected stepLabel(game: SeriesGame): string {
    const step = this.step(game);
    if (!step) return 'Draft complete';
    const us = this.teamName();
    const them = this.draftSeries()?.opponent ?? 'Opponent';
    const blue = game.ourSide === 'blue' ? us : them;
    const red = game.ourSide === 'blue' ? them : us;
    return describeStep(step, blue, red);
  }

  /** Which side of the board the step belongs to, in our own terms. */
  private sideOfStep(game: SeriesGame): DraftSide {
    return this.isOurTurn(game) ? 'our' : 'their';
  }

  /**
   * Whether this side is the one being asked to pick.
   *
   * The step bar already names the turn, but it sits above the champion wall
   * and the columns are at the far edges of a full-width screen — so mid-draft
   * the question "whose pick is this" is answered by reading text in the middle
   * while looking at a card on the side. Lighting the column answers it where
   * the eye already is.
   *
   * Pick steps only. A ban is answered on the ban strip, so lighting a pick
   * column during one would point at the wrong control.
   */
  protected onTurn(game: SeriesGame, side: DraftSide): boolean {
    const step = this.step(game);
    if (!step || !game.ourSide || step.action !== 'pick') return false;
    return this.sideOfStep(game) === side;
  }

  /**
   * The seat a pending pick would land in. Shown before confirming so a wrong
   * lane can be seen and corrected rather than discovered afterwards.
   */
  protected pendingSeat(game: SeriesGame): Role | null {
    const champ = this.pending();
    const step = this.step(game);
    if (!champ || isNoBan(champ) || !step || step.action !== 'pick') return null;

    const taken = this.pickSlots(game, this.sideOfStep(game)).map((s) => s.champion);

    // A lane chip beats the champion's usual lane.
    //
    // `seatFor` reads pro play, so filtering to Top and clicking Dr. Mundo
    // proposed Jungle — right about him in general, wrong about what was just
    // asked for. Choosing the chip is an explicit statement of intent; the lane
    // data is only a guess at one, so the guess does not get to overrule it.
    // Only when that seat is still open: a chip cannot displace a made pick.
    const chip = this.shownLane();
    if (chip) {
      const index = this.roles.indexOf(chip);
      if (index >= 0 && !taken[index]) return chip;
    }

    return seatFor(champ, taken);
  }

  /** Hold a champion for confirmation rather than committing it immediately. */
  protected proposeFromSequence(name: string): void {
    // Aimed at a ban or a seat that is already filled: this click replaces
    // it, in place, without moving the step. That is how a wrong entry is
    // corrected mid-sequence — Undo only reaches the most recent one, and the
    // free-form clear controls stand down while a sequence runs.
    const game = this.draftGame();
    if (game && this.replacing(game)) {
      void this.replaceAimed(this.current(game), name);
      return;
    }
    this.hold(name);
  }

  /** Hold a champion for confirmation, remembering when, and tell the watchers. */
  private hold(name: string): void {
    this.pending.set(name);
    this.heldAt = Date.now();
    this.writeHold(name);
  }

  private async replaceAimed(live: SeriesGame, name: string): Promise<void> {
    const aimed = this.target();
    if (aimed.kind === 'ban' && aimed.index !== undefined) {
      const bans = [...(live.bans ?? [])];
      const was = bans[aimed.index];
      if (!was) return;
      bans[aimed.index] = name;
      await this.data.updateSeriesGame({ ...live, bans });
      this.toast.show(`Replaced ${this.banLabel(was)} with ${name}`);
    } else if (aimed.kind === 'pick') {
      const picks = [...((aimed.side === 'our' ? live.ourChampions : live.theirChampions) ?? [])];
      const was = picks[aimed.index];
      if (!was) return;
      picks[aimed.index] = name;
      const pickLog = (live.pickLog ?? []).map((c) => (normalizeChampion(c) === normalizeChampion(was) ? name : c));
      await this.data.updateSeriesGame({
        ...live,
        ...(aimed.side === 'our' ? { ourChampions: picks } : { theirChampions: picks }),
        pickLog
      });
      this.toast.show(`Replaced ${was} with ${name}`);
    }
    this.target.set({ kind: 'ban' });
    this.pending.set(null);
    this.writeHold(null);
  }

  protected cancelPending(): void {
    this.pending.set(null);
    this.writeHold(null);
  }

  /** Share the hold with everyone on the link. Nothing else on the game moves. */
  private writeHold(name: string | null): void {
    const game = this.draftGame();
    if (!game) return;
    const live = this.current(game);
    if ((live.holding ?? null) === name) return;
    void this.data.updateSeriesGame({ ...live, holding: name ?? undefined });
  }

  protected readonly isNoBan = isNoBan;

  /** The held line in the confirm slot, in parts: whose step and which, what is held, and the seat (17 Sep 2026). */
  protected held(game: SeriesGame): HeldLine | null {
    const champ = this.pending();
    return champ ? heldLine(this.step(game), game.ourSide, champ, this.pendingSeat(game)) : null;
  }

  /**
   * Enter in the sequence wall's empty search box. On a ban step with nothing held it holds a ban nobody saw
   * (17 Sep 2026), and with anything held it locks it (21 Sep 2026, the lead: "second enter should lock the pick") —
   * so a pick is type, Enter, Enter, and a missed ban is Enter, Enter, with no reach for the mouse. Taking a champion
   * off the wall clears the search box, which is what makes the second Enter land here; `LOCK_AFTER_MS` since the
   * hold keeps a double tap of one key from confirming it. The rule itself is `emptyEnterAction`, pure and tested:
   * nothing while a replace is aimed, and nothing on a pick step with an empty hand.
   */
  protected wallEmptyEnter(): void {
    const game = this.draftGame();
    if (!game || !this.auth.editing()) return;
    const live = this.current(game);
    if (!this.sequenceActive(live)) return;
    const action = emptyEnterAction(this.step(live)?.action, this.pending(), !!this.replacing(live), Date.now() - this.heldAt);
    if (action === 'hold') {
      this.hold(NO_BAN);
    } else if (action === 'confirm') {
      void this.confirmPending(live);
    }
  }

  /**
   * What the wall's search box says, which is what the next two keys do (21 Sep 2026). It changes only with the
   * step and whether something is held — the box is a fixed width, so nothing moves.
   */
  protected wallPlaceholder(game: SeriesGame): string {
    if (this.pending()) return 'Enter again locks it';
    return this.step(game)?.action === 'ban'
      ? 'Type a name, Enter holds · Enter on empty: ban not seen'
      : 'Type a name, Enter holds · Enter again locks';
  }

  /** How many bans "Rest of phase not seen" would write from here: the bans left before the next pick. */
  protected bansLeft(game: SeriesGame): number {
    return this.sequenceActive(game) ? bansLeftInPhase(positionOf(game)) : 0;
  }

  /**
   * Rest of phase not seen (17 Sep 2026): every ban left before the next pick, written as `NO_BAN` in one save, for
   * an operator who joined late or lost the thread mid-phase. Not a test aid, so any editor on any series. Undo in
   * the toast takes them all back while the draft has not moved since; after that each one is replaced in place by
   * aiming at it, like any other ban.
   */
  protected async restOfPhaseNotSeen(game: SeriesGame): Promise<void> {
    if (this.committing()) return;
    const live = this.current(game);
    if (!this.sequenceActive(live) || this.step(live)?.action !== 'ban') return;
    const from = positionOf(live);
    const count = bansLeftInPhase(from);
    if (!count) return;

    this.committing.set(true);
    try {
      const bans = [...(live.bans ?? []), ...Array.from({ length: count }, () => NO_BAN)];
      await this.data.updateSeriesGame({ ...live, bans, draftStep: from + count, holding: undefined });
      this.pending.set(null);
      this.wall()?.chooseLane(null);
      this.restartClock();
    } finally {
      this.committing.set(false);
    }
    this.toast.show(count === 1 ? 'Ban marked not seen' : `${count} bans marked not seen`, {
      icon: 'visibility_off',
      timeout: 12000,
      action: { label: 'Undo', run: () => void this.undoNotSeen(game, from, count) }
    });
  }

  /** Take back what "Rest of phase not seen" wrote, only while those bans are still the last thing that happened. */
  private async undoNotSeen(game: SeriesGame, from: number, count: number): Promise<void> {
    const now = this.current(game);
    const bans = now.bans ?? [];
    const stillLast = positionOf(now) === from + count && bans.length >= count && bans.slice(-count).every(isNoBan);
    if (!stillLast) {
      this.toast.show('The bans stayed not seen', { kind: 'warn', text: 'The draft has moved on since. Aim at a ban to replace it.' });
      return;
    }
    await this.data.updateSeriesGame({ ...now, bans: bans.slice(0, -count), draftStep: from, holding: undefined });
    this.pending.set(null);
    this.restartClock();
  }

  /** Commit the held champion and advance one step. */
  // ---- Filling the draft automatically ------------------------------------
  //
  // Test aids, not shortcuts for a real draft. Reaching the interesting part of
  // this screen means clicking through ten bans first, and doing that by hand
  // every time is the reason a layout bug survives to a match night.
  //
  // Both drive `confirmPending` rather than writing the board themselves. The
  // free-form controls once edited the board without moving `draftStep` and
  // left the draft a step ahead of itself; anything that fills the board has to
  // go through the same door a person does.

  protected readonly autoFilling = signal(false);

  /**
   * A champion to put in the next slot.
   *
   * Prefers one that fits a seat still open, so an auto-filled board looks like
   * a draft rather than five supports. Falls back to anything legal, because
   * for a test the point is to arrive at a full board.
   */
  private autoChoice(game: SeriesGame, action: 'ban' | 'pick'): string | null {
    // The sequence's own closed list, bans made included (17 Sep 2026): `unavailableFor(game, 'ban')` leaves
    // them out for the free-form picker's sake, and Skip bans banned Akshan twice in Paradox Requiem game 1.
    const blocked = blockedSet(this.sequenceUnavailable(game));
    const pool = this.champs
      .champions()
      .map((c) => c.name)
      .filter((name) => !blocked.has(normalizeChampion(name)));
    if (!pool.length) return null;

    if (action === 'pick') {
      const taken = this.pickSlots(game, this.sideOfStep(game)).map((s) => s.champion);
      const fits = pool.filter((name) => seatFor(name, taken));
      if (fits.length) return fits[Math.floor(Math.random() * fits.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Run the sequence forward on its own.
   *
   * `'bans'` stops at the first pick, which is the one that matters: bans are
   * the slow part and the part nobody is testing. `'end'` fills the rest.
   */
  protected async autoAdvance(game: SeriesGame, until: 'bans' | 'end'): Promise<void> {
    const series = this.draftSeries();
    if (this.autoFilling() || !series || !this.aidsShown(series)) return;
    this.autoFilling.set(true);
    try {
      // Bounded by the sequence length: a step that refuses to advance would
      // otherwise spin here forever with the board half filled.
      for (let guard = 0; guard < 40; guard += 1) {
        const live = this.current(game);
        const step = this.step(live);
        if (!step) break;
        if (until === 'bans' && step.action !== 'ban') break;

        const champ = this.autoChoice(live, step.action);
        if (!champ) break;

        const before = positionOf(live);
        this.pending.set(champ);
        await this.confirmPending(live);
        if (positionOf(this.current(game)) === before) break;
      }
    } finally {
      this.pending.set(null);
      this.autoFilling.set(false);
    }
  }

  protected async confirmPending(game: SeriesGame): Promise<void> {
    const champ = this.pending();
    if (!champ || this.committing()) return;

    // Everything below reads the live game, never the template's snapshot.
    const live = this.current(game);
    const step = this.step(live);
    if (!step) return;
    // Refuse rather than advance with nothing stored — or with a not-seen ban, held on a ban step another editor
    // has since confirmed, about to land in a seat.
    if (this.confirmBlockedReason(live)) return;

    this.committing.set(true);
    try {
      const next = positionOf(live) + 1;

      if (step.action === 'ban') {
        const bans = [...(live.bans ?? []), champ];
        await this.data.updateSeriesGame({ ...live, bans, draftStep: next, holding: undefined });
      } else {
        const side = this.sideOfStep(live);
        const seat = this.pendingSeat(live);
        const picks = [...((side === 'our' ? live.ourChampions : live.theirChampions) ?? [])];
        const at = seat ? this.roles.indexOf(seat) : picks.findIndex((c) => !c);
        if (at >= 0) {
          while (picks.length <= at) picks.push('');
          picks[at] = champ;
        }
        await this.data.updateSeriesGame({
          ...live,
          ...(side === 'our' ? { ourChampions: picks } : { theirChampions: picks }),
          pickLog: [...(live.pickLog ?? []), champ],
          draftStep: next,
          holding: undefined
        });
      }
      // Only clear the hold that was just confirmed. A drafter who clicks the
      // next champion while this write is still in flight has already replaced
      // the hold, and clearing it here threw that click away.
      if (this.pending() === champ) this.pending.set(null);
      // Every pick puts the wall back to All: the chip was for the seat just
      // filled, and the next seat is the sequence's to name (asked 6 Sep 2026).
      this.wall()?.chooseLane(null);
      this.restartClock();
    } finally {
      this.committing.set(false);
    }
  }

  /**
   * Wipe the draft and start again, side included.
   *
   * Undo walks back one step at a time, which is right for a misclick and
   * wrong for "we set this up against the wrong opponent" or a scrim restart.
   * Confirmed because it throws away every ban and pick in the game.
   */
  protected async resetDraft(game: SeriesGame): Promise<void> {
    const live = this.current(game);
    const drafted = (live.bans ?? []).length
      + [...(live.ourChampions ?? []), ...(live.theirChampions ?? [])].filter(Boolean).length;
    if (drafted && !(await this.confirm.ask({ title: `Clear game ${live.gameNumber}?`, body: `All ${drafted} bans and picks go, and the draft starts again from the side choice.`, confirmLabel: 'Clear the draft', danger: true }))) return;

    await this.data.updateSeriesGame({
      ...live,
      bans: undefined,
      ourChampions: [],
      theirChampions: [],
      ourSide: undefined,
      draftStep: undefined,
      holding: undefined,
      advice: undefined,
      pickLog: undefined
    });
    this.pending.set(null);
  }

  /** Step back one, for a misclick that was already confirmed. */
  protected async undoStep(game: SeriesGame): Promise<void> {
    if (this.committing()) return;
    const live = this.current(game);
    const position = positionOf(live);
    if (position <= 0) return;
    const previous = stepAt(position - 1);
    if (!previous) return;
    // A ban comes back without asking; a pick is a decision someone made.
    const target = undoTarget(live);
    if (target?.action === 'pick' && target.champion && !(await this.confirm.ask({ title: `Undo the last pick, ${target.champion}?`, confirmLabel: 'Undo pick' }))) return;

    const patch: Partial<SeriesGame> = { draftStep: position - 1, holding: undefined };
    if (previous.action === 'ban') {
      patch.bans = (live.bans ?? []).slice(0, -1);
    } else {
      const side = previous.team === live.ourSide ? 'our' : 'their';
      const picks = [...((side === 'our' ? live.ourChampions : live.theirChampions) ?? [])];
      // The most recent pick, by the log the confirm keeps. Seats are keyed by
      // role, so "the highest filled seat" took the wrong champion whenever
      // the last pick landed in an earlier seat — Top after Support, say.
      // Games drafted before the log existed fall back to that old guess.
      const log = [...(live.pickLog ?? [])];
      const last = log.pop();
      let at = last ? picks.findIndex((c) => c && normalizeChampion(c) === normalizeChampion(last)) : -1;
      if (at < 0) {
        for (let i = picks.length - 1; i >= 0; i--) {
          if (picks[i]) { at = i; break; }
        }
      }
      if (at >= 0) picks[at] = '';
      patch.pickLog = log;
      Object.assign(patch, side === 'our' ? { ourChampions: picks } : { theirChampions: picks });
    }
    await this.data.updateSeriesGame({ ...live, ...patch });
    this.pending.set(null);
    this.restartClock();
  }

  /**
   * Unavailable set for whichever action the sequence is on.
   *
   * Bans already made are included here, unlike in the free-form board. There
   * the ban picker owns its own list and clicking a banned champion takes it
   * back off; in sequence order there is no taking off — a confirmed ban is
   * spent — so leaving them clickable let the same champion be banned ten
   * times over, which is exactly what happened the first time this ran.
   */
  protected sequenceUnavailable(game: SeriesGame): string[] {
    return sequenceClosed(game, this.burnedBefore(game.seriesId, game.gameNumber));
  }

  /**
   * Why the held pick cannot be confirmed, or null when it can.
   *
   * The only real case is a side whose five seats are already full — from an
   * earlier free-form edit, say. Advancing anyway would drop the pick silently
   * and leave the draft a step further on with nothing to show for it.
   */
  protected isCommitting(): boolean {
    return this.committing();
  }

  /**
   * Whether the twenty-step sequence is running this game.
   *
   * While it is, the free-form controls have to stand down. They edit picks and
   * bans without touching `draftStep`, so clearing a seat mid-draft removed a
   * champion and left the sequence a step further on than the board — which is
   * how a game reached the second ban phase showing five picks instead of six.
   * Undo is the way back, because it moves both together.
   */
  /** One side's five ban slots. Logic lives in draft-sequence, where it is tested. */
  protected bansOf(game: SeriesGame, side: DraftSide): (string | null)[] {
    return bansForTeam(game.bans ?? [], side, game.ourSide);
  }

  protected sequenceActive(game: SeriesGame): boolean {
    return !!game.ourSide && !isComplete(positionOf(game));
  }

  protected confirmBlockedReason(game: SeriesGame): string | null {
    const step = this.step(game);
    const held = this.pending();
    if (!held || !step) return null;
    if (isNoBan(held)) return step.action === 'ban' ? null : 'Not seen is for a ban. Cancel it and hold a champion.';
    if (step.action !== 'pick') return null;
    if (this.pendingSeat(game)) return null;
    const side = this.sideOfStep(game) === 'our' ? this.teamName() : (this.draftSeries()?.opponent ?? 'They');
    return `${side} already have five champions — clear a seat first.`;
  }

  // ---- What to pick next -------------------------------------------------
  //
  // Not a win rate. Ours would come from 159 games where a draft tool's comes
  // from millions, so a synthesised percentage would be noise with a decimal
  // point. These answer from our own record instead: which comps a champion
  // keeps reachable, and what the picks so far are short of.

  /** Traits for one side's picks, joined on the Data Dragon id. */
  private traitsForSide(game: SeriesGame, side: DraftSide): ChampionTraits[] {
    const index = indexTraits(this.data.championTraits());
    const out: ChampionTraits[] = [];
    for (const slot of this.pickSlots(game, side)) {
      if (!slot.champion) continue;
      const traits = traitsFor(index, this.champs.resolve(slot.champion)?.id);
      if (traits) out.push(traits);
    }
    return out;
  }

  /**
   * What their draft is telling us. The only enemy-aware thing on this panel:
   * the win rates above are blind to their picks, because our record against
   * any one champion is three or four games.
   */
  protected theirRead(game: SeriesGame): DraftRead[] {
    return enemyRead(this.traitsForSide(game, 'their'));
  }
  /**
   * What the held champion would do, for the confirm row.
   *
   * The moment before committing is when the number is worth reading — after
   * it, the pick is made and the figure is history. Reuses the same weighting
   * as the panel so the two can never disagree.
   */
  protected pendingAdvice(game: SeriesGame): ChampionSuggestion | null {
    const champ = this.pending();
    const seat = this.pendingSeat(game);
    if (!champ || !seat) return null;
    // Seat-aware on the held champion itself (20 Sep 2026): a comp that names it as a fallback is one
    // this pick keeps, and the line used to read "in no comp of ours" over a comp we were about to play.
    const found = suggestForLane(seat, [champ], this.compAvailability(game.seriesId), (comp, lane) =>
      this.seatIfTaken(comp, lane, champ)
    );
    return found[0] ?? null;
  }
  /** Where we stand now, across every comp still reachable. */
  protected standing(game: SeriesGame) {
    return currentStanding(this.compAvailability(game.seriesId));
  }

  /**
   * What the standing is actually counting.
   *
   * It is not the team's whole record, and reads as a stuck number without
   * that said: by game two of a fearless series the burn has closed most comps,
   * so a total of 168 games across the books can present as 30 here. The count
   * shrinking through a draft is the number working, not failing.
   */
  protected standingNote(game: SeriesGame): string {
    const all = this.compAvailability(game.seriesId);
    const playable = all.filter((c) => c.playable).length;
    const burned = this.burnedBeforeCount(game);
    const banned = blockedSet(game.bans).size;

    const parts = [
      `Across the ${playable} of ${all.length} comps still reachable`,
      burned ? `${burned} champions burned earlier in this series` : '',
      banned ? `${banned} banned this game` : ''
    ].filter(Boolean);

    return `${parts[0]}. ${parts.slice(1).join(', ') || 'Nothing burned or banned yet'}. It falls as a draft narrows.`;
  }

  /**
   * A win rate as one of seven bands either side of even.
   *
   * Bands rather than a continuous colour: a draft is read at a glance, and a
   * smooth ramp makes 54% and 58% indistinguishable when the difference is the
   * whole point. Even sits at 50 and the tint grows from there.
   */
  protected winRateBand(rate: number | undefined): string {
    if (rate === undefined) return '';
    if (rate >= 80) return 'wr-good-3';
    if (rate >= 65) return 'wr-good-2';
    if (rate > 50) return 'wr-good-1';
    if (rate === 50) return 'wr-even';
    if (rate > 35) return 'wr-poor-1';
    if (rate > 20) return 'wr-poor-2';
    return 'wr-poor-3';
  }

  /**
   * How a pick would move us, in points, against where we stand.
   *
   * Takes the whole suggestion rather than just the percentage, because whether
   * the movement is worth stating depends on how many games are behind it — a
   * "+25" off two games is a claim the data cannot make. The projection still
   * shows; only the arrow is withheld.
   */
  protected swing(game: SeriesGame, suggestion: ChampionSuggestion): number | undefined {
    return swingOf(suggestion.projected, this.standing(game).rate, suggestion.games);
  }
  /**
   * How a champion does in solo queue at large, or nothing while the crawl is
   * too shallow to say.
   *
   * Shown *beside* our own record rather than blended into it. They answer
   * different questions — ours is "how has this gone for us" over tens of
   * games, this is "how does this champion do at all" over tens of thousands —
   * and averaging them would destroy the only interesting thing about having
   * both, which is where they disagree.
   */
  protected soloRate(champion: string): ChampionRate | undefined {
    return this.stats.rate(champion);
  }

  protected soloNote(champion: string): string {
    const r = this.stats.rate(champion);
    if (!r) return 'Not enough solo queue games collected yet.';
    const where = r.combined
      ? `patches ${previousPatch(this.stats.patch())}-${this.stats.patch()}`
      : `patch ${this.stats.patch()}`;
    return `${r.winRate}% over ${r.games.toLocaleString()} solo queue games on ${where}.`;
  }

  /**
   * Their champion in the lane being advised, once they have taken one.
   *
   * Read off the seat rather than the pick order, because a flex pick moves
   * seats mid-draft: their Jayce may be filed at Top or Mid depending on what
   * came after it, and a matchup filed under the wrong lane is worse than none.
   */
  protected enemyAt(game: SeriesGame, lane: Role): string {
    return this.pickSlots(game, 'their').find((s) => s.role === lane)?.champion ?? '';
  }

  /**
   * Our champion's record into theirs in this lane, from the collected data.
   *
   * The one genuinely enemy-aware number on the panel. Everything above it
   * answers "what does this keep open for us"; this answers "given what they
   * have taken, does this lane still want it". Absent far more often than
   * present — a lane has 4,096 possible pairings and only the busiest have the
   * two hundred games the floor asks for — and absent is the correct rendering,
   * not a gap to be filled with a thinner number.
   */
  protected matchupRate(game: SeriesGame, champion: string): MatchupRate | undefined {
    const lane = this.suggestLane(game);
    if (!lane) return undefined;
    const theirs = this.enemyAt(game, lane);
    return theirs ? this.matchups.rate(lane, champion, theirs) : undefined;
  }

  /** The chip shows the margin in whole points; the tip keeps the decimal. */
  protected wholeMargin(m: MatchupRate): number {
    return Math.round(m.margin);
  }

  protected matchupNote(game: SeriesGame, champion: string): string {
    const lane = this.suggestLane(game);
    const theirs = lane ? this.enemyAt(game, lane) : '';
    if (!theirs) return 'No matchup: they have not picked in this lane yet.';

    const r = this.matchupRate(game, champion);
    if (!r) {
      return `Not enough games collected for ${champion} into ${theirs} to be worth quoting.`;
    }
    const where = r.combined
      ? `patches ${previousPatch(this.stats.patch())}-${this.stats.patch()}`
      : `patch ${this.stats.patch()}`;
    const thin = r.thin ? ` Thin: about ${r.margin} points either way, so read it as a lean, not a verdict.` : '';
    return `${champion} into ${theirs}: ${r.winRate}% over ${r.games.toLocaleString()} games on ${where}.${thin}`;
  }

  /**
   * Comps shown as pills on a suggestion row.
   *
   * Capped, because a champion in six of our comps produced a row six comps
   * wide and pushed the win rate — the thing being read — off the edge. Best
   * record first, so the ones cut are the ones least worth the space.
   */
  private readonly COMPS_SHOWN = 3;

  protected shownComps(s: ChampionSuggestion): readonly CompFit[] {
    return s.comps.slice(0, this.COMPS_SHOWN);
  }

  protected moreComps(s: ChampionSuggestion): number {
    return Math.max(s.comps.length - this.COMPS_SHOWN, 0);
  }

  /**
   * The comp's shape as a glyph.
   *
   * Derived from its five champions rather than stored, so every comp has one
   * without anybody choosing it, and two comps that play alike look alike —
   * which is the only thing an icon on a pill can usefully say. A comp too
   * incomplete to classify gets the neutral mark, not a guess.
   */
  protected compIcon(c: CompFit): string {
    return IDENTITY_ICON[this.compIdentity(c)];
  }

  /** The name lives here now that the pill carries an icon and a number. */
  protected compNote(c: CompFit): string {
    const shape = IDENTITY_LABEL[this.compIdentity(c)];
    const record = c.games
      ? `${c.winRate}% over ${c.games} ${c.games === 1 ? 'game' : 'games'}`
      : 'never played';
    return `${c.name} — ${shape} — ${record}`;
  }

  private compIdentity(c: CompFit): CompIdentity {
    const source = this.data.comps().find((comp) => comp.id === c.id);
    if (!source) return 'unclear';

    // Joined on the Data Dragon id, the same way traitsForSide does it — the
    // traits are keyed by id and the comp lines carry display names, and the
    // two differ for exactly the champions that break silently (FiddleSticks).
    //
    // Deliberately the PRIORITY five and not the seats' fallbacks (20 Sep 2026):
    // a comp's identity, damage profile, face and expectation all read its first
    // choice, so the glyph on a pill stays the comp's own shape rather than
    // changing under the reader because a board burned one champion. What the
    // board would field now is `seatBest`, and only the popup and the advisor
    // ask that.
    const index = indexTraits(this.data.championTraits());
    const traits: ChampionTraits[] = [];
    for (const role of this.roles) {
      const champion = this.ui.parseCompLine(source.picks[role] ?? '').champion;
      if (!champion) continue;
      const found = traitsFor(index, this.champs.resolve(champion)?.id);
      if (found) traits.push(found);
    }
    return classifyComp(traits);
  }

  protected moreNote(s: ChampionSuggestion): string {
    return s.comps
      .slice(this.COMPS_SHOWN)
      .map((c) => this.compNote(c))
      .join('\n');
  }

  // ---- The advisor --------------------------------------------------------
  //
  // Everything the panels above already show, weighed at once by a model on
  // the backend, answered in three ranked champions with a sentence each. It
  // only ranks: the candidates it may name are built here, already legal for
  // the step, and the backend drops anything outside them.

  protected readonly advisor = inject(DraftAdvisorService);
  /** The stored answer for this game, if one has been asked. */
  protected adviceOf(game: SeriesGame): SavedDraftAdvice | null {
    return this.current(game).advice ?? null;
  }

  protected readonly adviceError = signal('');
  /** The step the advice was given for, so a stale answer says so. */

  protected adviceIsStale(game: SeriesGame): boolean {
    const saved = this.adviceOf(game);
    return !!saved && saved.step !== positionOf(this.current(game));
  }

  /** How many champions the advisor may choose from. */
  private readonly ADVISOR_CANDIDATES = 60;

  /**
   * The champions the advisor may name for this step.
   *
   * For our pick: what fits the seat, our player's own pool and the comps
   * still reachable first, then the rest of the lane. For a ban: what the
   * opponents play and what has beaten them, plus their likely next seat's
   * pool. Everything is already filtered for the burn, the bans and the
   * board, so the model cannot suggest a champion that cannot be taken.
   */
  private advisorCandidates(game: SeriesGame, action: 'ban' | 'pick', seat: Role | null): string[] {
    const blocked = blockedSet(this.sequenceUnavailable(game));
    const legal = (name: string) => !!name && !blocked.has(normalizeChampion(name));
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      const key = normalizeChampion(name);
      if (!legal(name) || seen.has(key) || out.length >= this.ADVISOR_CANDIDATES) return;
      seen.add(key);
      out.push(name);
    };

    if (action === 'pick') {
      // One seat if it was chosen, else every seat we still have to fill, so
      // the list carries each open seat's pool and comp picks rather than the
      // champion wall in alphabetical order.
      const seats: Role[] = seat
        ? [seat]
        : this.pickSlots(game, 'our').filter((s) => !s.champion).map((s) => s.role);
      for (const s of seats) {
        const ourPlayer = this.data.starters().find((p) => p.role === s);
        for (const champ of ourPlayer?.top3 ?? []) add(champ);
      }
      // Every champion the seat can still field, not only its priority (20 Sep 2026): with Nautilus
      // banned the model may still name Leona, which is the moment a fallback is worth having.
      for (const comp of this.draftPlayable(game)) {
        for (const s of seats) {
          const seatRow = comp.seats.find((row) => row.role === s);
          for (const option of seatRow?.options ?? []) add(option.champion);
        }
      }
      for (const champ of this.champs.champions().map((c) => c.name)) {
        if (seats.some((s) => playsRole(champ, s))) add(champ);
      }
    } else {
      for (const player of starters(this.draftSeries()?.opponentPlayers ?? [])) {
        for (const rec of poolFor(player)) add(rec.champion);
        for (const rec of countersFor(player)) add(rec.champion);
        for (const champ of player.recentChampions ?? []) add(champ);
      }
      // Their comps' answers to ours: the champions our own comps fear.
      for (const comp of this.draftPlayable(game)) {
        const source = this.data.comps().find((c) => c.id === comp.id);
        for (const champ of source?.bans ?? []) add(champ);
      }
    }
    return out;
  }

  /**
   * Ask on our turn without being asked. The answer took eight seconds after
   * the click and was stale two steps later (5 Sep 2026); fired the moment
   * their pick lands it is usually waiting before the drafter looks. Once per
   * step per tab, only while editing, only on our own turn, and never when
   * the game already carries an answer for this step — a reload mid-draft
   * reads the saved one instead of paying for it again. Two editors' tabs
   * can still both ask on the same step; that costs a few cents, not a turn.
   */
  private readonly wall = viewChild(ChampionGridComponent);

  /**
   * The search box takes the cursor whenever the step moves, so an action
   * can be typed: three letters and Enter. Only while editing and only
   * while the sequence runs; a watcher's tab has nothing to type.
   */
  private readonly focusOnStep = effect(() => {
    const game = this.draftGame();
    const editing = this.auth.editing();
    const step = game?.draftStep ?? -1;
    untracked(() => {
      if (!game || !editing || step < 0 || !this.sequenceActive(game)) return;
      setTimeout(() => this.wall()?.focusSearch(), 0);
    });
  });

  /** A shared link to a game that has since been removed lands on the live one — and says so. */
  private saidGoneFor = '';
  private readonly gameGone = effect(() => {
    const wanted = this.pickedGameId();
    const series = this.draftSeries();
    if (!wanted || !series) return;
    const games = this.gamesFor(series.id);
    untracked(() => {
      if (!games.length || games.some((g) => g.id === wanted) || this.saidGoneFor === wanted) return;
      this.saidGoneFor = wanted;
      const shown = this.draftGame();
      this.toast.show('That game is no longer in this series', {
        kind: 'warn',
        text: shown ? `Showing game ${shown.gameNumber} instead.` : 'Nothing to show yet.'
      });
    });
  });

  private lastAutoAsked = '';
  private readonly autoAsk = effect(() => {
    const game = this.draftGame();
    const editing = this.auth.editing();
    // Tracked on purpose: when an answer for an earlier step is still in
    // flight, this runs again the moment it lands and asks for the current
    // one. "Skip bans" used to leave a ban answer on a pick step for good.
    const busy = this.advisor.busy();
    // Admin → Settings decides whether this fires at all; off by default.
    const wanted = this.data.settings().autoAdvisor === true;
    if (!game || !wanted) return;
    const step = positionOf(game);
    untracked(() => {
      if (!editing || !this.sequenceActive(game) || !this.isOurTurn(game)) return;
      if (game.advice?.step === step || busy) return;
      const key = `${game.id}:${step}`;
      if (this.lastAutoAsked === key) return;
      this.lastAutoAsked = key;
      void this.askAdvisor(game);
    });
  });

  protected async askAdvisor(game: SeriesGame): Promise<void> {
    if (this.advisor.busy()) return;
    // The block scrolls inside a fixed frame; an answer read halfway down
    // last time should not leave the next one starting halfway down.
    this.host.nativeElement.querySelector('.advice-block.is-advisor')?.scrollTo({ top: 0 });
    const live = this.current(game);
    const step = this.step(live);
    const action = step?.action ?? 'pick';
    const turn = step ? (this.isOurTurn(live) ? 'our' : 'their') : 'our';
    // Only an explicit seat fixes the seat: a held champion, a lane chip, or a
    // slot being aimed at. With none of those the model chooses the seat too,
    // from every seat still open — the old fallback took the first empty seat
    // in Top-to-Support order, which asked for a jungler when the board was
    // asking for a counter to their ADC.
    const seat = action === 'pick' && turn === 'our'
      ? (this.pendingSeat(live) ?? this.explicitSeat())
      : null;
    const candidates = this.advisorCandidates(live, action, seat);
    if (!candidates.length) {
      this.adviceError.set('Nothing left to choose from for this step.');
      return;
    }

    const series = this.draftSeries();
    const theirs = starters(series?.opponentPlayers ?? []);
    const pickMap = (side: DraftSide) =>
      Object.fromEntries(this.pickSlots(live, side).filter((s) => s.champion).map((s) => [s.role, s.champion]));

    const soloRates: Record<string, number> = {};
    for (const champ of candidates) {
      const r = this.stats.rate(champ);
      if (r) soloRates[champ] = r.winRate;
    }
    const enemy = seat ? this.enemyAt(live, seat) : '';
    const matchups = seat && enemy
      ? candidates
          .map((champ) => {
            const r = this.matchups.rate(seat, champ, enemy);
            return r ? { ours: champ, theirs: enemy, winRate: r.winRate, games: r.games } : null;
          })
          .filter((m): m is NonNullable<typeof m> => !!m)
      : [];

    const request = {
      teamName: this.teamName(),
      opponent: series?.opponent ?? 'Them',
      action,
      turn,
      stepNumber: positionOf(live) + 1,
      ourSide: live.ourSide ?? null,
      seat,
      ourPicks: pickMap('our'),
      theirPicks: pickMap('their'),
      // A ban nobody saw is not a champion the model should weigh (17 Sep 2026).
      bans: (live.bans ?? []).filter((c) => c && !isNoBan(c)),
      burned: this.burnedBefore(live.seriesId, live.gameNumber),
      ourRoster: this.data.starters().map((p) => ({ name: p.name, role: p.role, pool: (p.top3 ?? []).slice(0, 10) })),
      theirRoster: theirs.map((p) => ({
        name: p.name,
        role: p.role,
        rank: p.soloRank ?? p.rank,
        pool: poolFor(p).map((r) => r.champion),
        records: poolFor(p).filter((r) => r.games > 0),
        counters: countersFor(p).map((r) => r.champion),
        mastery: (p.mastery ?? []).slice(0, 8)
      })),
      // The five it would field on this board, not the five it was written with (20 Sep 2026): a comp
      // playing its fallback used to be sent as "Nautilus, playable: true, blocked: [Nautilus]",
      // which contradicts itself. `blocked` still lists every champion of the comp that is gone.
      // A seat with nothing left keeps its written priority rather than dropping out, so the list is
      // one champion a seat either way: a broken comp sending four names for a five-seat game read as
      // a four-champion comp, and nothing said the two missing names had been one seat.
      comps: this.draftComps(live).map((c) => ({
        name: c.name,
        champions: c.seats.map((s) => s.best || s.options[0]?.champion || '').filter(Boolean),
        winRate: c.winRate,
        games: c.games,
        playable: c.playable,
        blocked: c.blocked
      })),
      lanes: this.readableLanes(live).map((r) => ({ lane: r.lane, verdict: r.verdict, score: r.score, reasons: r.reasons.slice(0, 3) })),
      candidates,
      soloRates,
      matchups,
      notes: (series?.notes ?? '').slice(0, 1500) || undefined
    };

    this.adviceError.set('');
    try {
      const answer = await this.advisor.ask(request);
      // Re-read the game: the board may have moved in the seconds the model
      // took, and the answer must not carry a stale board back over it.
      const now = this.current(game);
      await this.data.updateSeriesGame({
        ...now,
        advice: { ...answer, step: positionOf(live), action, askedAt: new Date().toISOString() }
      });
    } catch (error) {
      this.adviceError.set(error instanceof Error ? error.message : 'The advisor could not answer.');
    }
  }

  /** Take an advised champion the same way a click on the wall does. */
  protected takeAdvice(game: SeriesGame, champion: string): void {
    if (this.sequenceActive(game)) {
      this.proposeFromSequence(champion);
    } else {
      this.gridPick(game, champion);
    }
  }

  // ---- The lanes ----------------------------------------------------------
  //
  // A draft is two lists of five; a game is five matchups. This gathers what
  // the app knows about each — the collected matchup rate, both champions'
  // solo queue rates, whether each player actually plays the pick, and the
  // traits — and hands it to `readLanes`, which is pure and tested. Shown to
  // everyone on the link, not only the editor: it is what a watching teammate
  // is there to talk about.

  protected laneReads(game: SeriesGame): LaneRead[] {
    const index = indexTraits(this.data.championTraits());
    const ourSlots = this.pickSlots(game, 'our');
    const theirSlots = this.pickSlots(game, 'their');
    const theirRoster = starters(this.draftSeries()?.opponentPlayers ?? []);

    const seats: SeatInput[] = this.roles.map((role, i) => {
      const ours = ourSlots[i].champion;
      const theirs = theirSlots[i].champion;
      const matchup = ours && theirs ? this.matchups.rate(role, ours, theirs) : undefined;

      // Our roster carries a pool without counts: first entry is the main.
      const ourPlayer = this.data.starters().find((p) => p.role === role);
      const ourPool = ourPlayer?.top3 ?? [];
      const ourAt = ours ? ourPool.findIndex((c) => normalizeChampion(c) === normalizeChampion(ours)) : -1;
      const ourComfort = !ourPlayer || !ours
        ? undefined
        : ourAt < 0
          ? { level: 'none' as const }
          : { level: ourAt === 0 ? ('main' as const) : ('pool' as const) };

      const theirPlayer = theirRoster.find((p) => p.role === role);
      const theirPool = theirPlayer ? poolFor(theirPlayer) : [];
      const theirAt = theirs ? theirPool.findIndex((c) => normalizeChampion(c.champion) === normalizeChampion(theirs)) : -1;
      const theirComfort = theirs && theirPlayer
        ? comfortOf(theirAt >= 0 ? theirPool[theirAt] : undefined, theirAt, theirPool.length > 0)
        : undefined;

      return {
        role,
        ours,
        theirs,
        matchup: matchup ? { winRate: matchup.winRate, games: matchup.games } : undefined,
        ourSolo: ours ? this.stats.rate(ours)?.winRate : undefined,
        theirSolo: theirs ? this.stats.rate(theirs)?.winRate : undefined,
        ourComfort,
        theirComfort,
        ourTraits: ours ? traitsFor(index, this.champs.resolve(ours)?.id) ?? undefined : undefined,
        theirTraits: theirs ? traitsFor(index, this.champs.resolve(theirs)?.id) ?? undefined : undefined
      };
    });
    return readLanes(seats);
  }

  /** Lanes with something to say, for the panel. */
  protected readableLanes(game: SeriesGame): LaneRead[] {
    return this.laneReads(game).filter((r) => r.verdict !== 'unknown');
  }

  protected lanePlan(game: SeriesGame): GamePlan {
    return gamePlan(this.laneReads(game));
  }

  /** The verdict of the lane a seat belongs to, for tinting the map tokens. */
  protected laneVerdict(game: SeriesGame, role: Role): LaneVerdict {
    const lane = role === 'ADC' || role === 'Support' ? 'Bot' : role;
    return this.laneReads(game).find((r) => r.lane === lane)?.verdict ?? 'unknown';
  }

  protected laneNote(read: LaneRead): string {
    const head = `${read.verdict === 'strong' ? 'Ours' : read.verdict === 'weak' ? 'Theirs' : 'Even'} by ${Math.abs(read.score)} points, ${read.confidence} confidence.`;
    return read.reasons.length ? `${head}\n${read.reasons.join('\n')}` : head;
  }

  /** What our picks are short of. Empty while there is too little to judge. */
  protected gaps(game: SeriesGame): CompGaps {
    return compGaps(this.traitsForSide(game, 'our'));
  }

  /**
   * Champions worth the seat being drafted, from the comps still reachable.
   * Capped at six: a longer list is read as a ranking rather than a shortlist.
   */
  protected suggestions(game: SeriesGame): ChampionSuggestion[] {
    const lane = this.suggestLane(game);
    if (!lane) return [];
    const blocked = blockedSet(this.unavailableFor(game, 'pick'));
    const candidates = this.champs.champions()
      .map((c) => c.name)
      .filter((name) => !blocked.has(normalizeChampion(name)));
    // One champion a seat, and it is the one that seat would field now: with the priority banned the
    // comp's record travels to its fallback instead of vanishing from the shortlist (20 Sep 2026).
    // One champion a comp a seat also means a comp can never be counted twice behind one suggestion.
    const fromComps = suggestForLane(lane, candidates, this.compAvailability(game.seriesId), (comp, seat) =>
      this.seatBest(comp, seat)
    );
    // The advisor's picks for this seat and the seat's own pool join the comp
    // champions, so the champion being argued for has its matchup on the
    // board even when no comp of ours fields it: Tristana into Kai'Sa was the
    // advisor's answer and missing from this list (6 Sep 2026).
    const advised = (this.adviceOf(game)?.picks ?? [])
      .filter((p) => !p.seat || p.seat === lane)
      .map((p) => p.champion);
    const pool = this.data.starters().find((p) => p.role === lane)?.top3 ?? [];
    const seen = new Set(fromComps.map((s) => normalizeChampion(s.champion)));
    const extras: ChampionSuggestion[] = [];
    for (const name of [...advised, ...pool]) {
      const real = candidates.find((c) => normalizeChampion(c) === normalizeChampion(name));
      if (!real || seen.has(normalizeChampion(real))) continue;
      seen.add(normalizeChampion(real));
      extras.push({ champion: real, comps: [], games: 0 });
    }
    // Advised first, then by the matchup the row leads with; with nothing of
    // theirs in the lane yet the comp order stands.
    const theirs = this.enemyAt(game, lane);
    const advisedSet = new Set(advised.map(normalizeChampion));
    const matchup = (s: ChampionSuggestion) =>
      theirs ? this.matchups.rate(lane, s.champion, theirs)?.winRate ?? -1 : -1;
    return [...fromComps, ...extras]
      .sort((a, b) => {
        const aa = advisedSet.has(normalizeChampion(a.champion));
        const bb = advisedSet.has(normalizeChampion(b.champion));
        if (aa !== bb) return aa ? -1 : 1;
        return matchup(b) - matchup(a);
      })
      .slice(0, 8);
  }

  /** Our own record on this champion, into their pick in this lane when we have met it. */
  protected ownRecord(game: SeriesGame, champion: string): OwnRecord | undefined {
    const lane = this.suggestLane(game);
    const enemy = lane ? this.enemyAt(game, lane) : '';
    return ownRecord(champion, enemy, this.data.compAnalysis()?.games ?? [], this.data.seriesGames());
  }

  /**
   * The lane the wall is currently showing. The advice follows the chips rather
   * than the aimed seat: being told about Jungle while looking at a wall of
   * mid laners is worse than being told nothing.
   */
  protected readonly shownLane = signal<Role | null>(null);

  /** The seat the advice is about. */
  protected suggestLane(game: SeriesGame): Role | null {
    const chip = this.shownLane();
    if (chip) return chip;
    const aimed = this.target();
    if (aimed.kind === 'pick') return this.roles[aimed.index];
    // Nothing filtered and nothing aimed: advise on the first seat still empty.
    const empty = this.pickSlots(game, 'our').find((s) => !s.champion);
    return empty ? empty.role : null;
  }

  /** A seat someone has actually chosen — a lane chip or an aimed slot — or none. */
  private explicitSeat(): Role | null {
    // A chip on a seat we have already filled is left over from the last
    // pick, not a choice for this one: with Nautilus locked the Support chip
    // had the advisor naming a second support (6 Sep 2026).
    const chip = this.shownLane();
    if (chip && this.ourSeatOpen(chip)) return chip;
    const aimed = this.target();
    return aimed.kind === 'pick' ? this.roles[aimed.index] : null;
  }

  private ourSeatOpen(role: Role): boolean {
    const game = this.draftGame();
    if (!game) return true;
    return !this.pickSlots(this.current(game), 'our').find((s) => s.role === role)?.champion;
  }

  /** The seat's lane, so the grid narrows itself without anyone filtering. */
  protected gridLane(): Role | null {
    const aimed = this.target();
    return aimed.kind === 'pick' ? this.roles[aimed.index] : null;
  }

  /** What the grid is currently pointed at, for the hint above it. */
  protected targetLabel(game: SeriesGame): string {
    const aimed = this.target();
    if (aimed.kind === 'ban') {
      // Say which ban the click fills while one was not seen (17 Sep 2026), since that is where it lands.
      const bans = game.bans ?? [];
      const unseen = bans.findIndex(isNoBan);
      if (unseen >= 0) {
        const place = banPlaceWords(unseen, game.ourSide);
        return place ? `${place}, not seen` : 'the not-seen ban';
      }
      return `Bans — ${bans.length} of ${MAX_BANS}`;
    }
    const side = aimed.side === 'our' ? this.teamName() : this.draftSeries()?.opponent ?? 'Opponent';
    return `${side} — ${this.roles[aimed.index]}`;
  }

  /** The game being drafted or played: the first without a result yet. */
  protected isLiveGame(game: SeriesGame): boolean {
    const games = this.gamesFor(game.seriesId);
    return games.find((g) => g.win === undefined)?.id === game.id;
  }

}


/** Whether this browser asked for the draft room's test aids. */
function readDevAids(): boolean {
  try {
    if (new URLSearchParams(location.search).get('dev') === '1') localStorage.setItem('bom-dev-aids', '1');
    return localStorage.getItem('bom-dev-aids') === '1';
  } catch {
    return false;
  }
}
