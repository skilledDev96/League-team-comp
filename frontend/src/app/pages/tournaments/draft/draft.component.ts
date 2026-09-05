import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionTraits, OpponentPlayer, Role, SeriesGame, TournamentSeries } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { ChampionDataService } from '../../../services/champion-data.service';
import { ChampionGridComponent } from '../../../shared/champion-grid.component';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import {
  blockedSet,
  CompAvailability,
  compAvailability,
  normalizeChampion,
  PoolPressure,
  poolPressure
} from '../draft.util';
import {
  banTeamAt,
  bansForTeam,
  describeStep,
  DraftStep,
  draftProgress,
  isComplete,
  lastPickOfPhase,
  picksLeftInPhase,
  seatFor,
  stepAt
} from '../draft-sequence';
import {
  BanSuggestion,
  banSuggestions,
  ChampionSuggestion,
  CompFit,
  CompGaps,
  compGaps,
  compsUsing,
  currentStanding,
  DraftRead,
  enemyRead,
  suggestForLane,
  swingOf
} from '../draft-advice';
import { indexTraits, traitsFor } from '../../../shared/comp-board.util';
import { CompIdentity, IDENTITY_ICON, IDENTITY_LABEL, classifyComp } from '../../../core/comp-identity';
import { ChampionRate, ChampionStatsService, previousPatch } from '../../../services/champion-stats.service';
import { MatchupRate, MatchupStatsService } from '../../../services/matchup-stats.service';
import { TournamentContextService } from '../tournament-context.service';
import { ToastService } from '../../../services/toast.service';

/** Which team a draft slot belongs to. */
type DraftSide = 'our' | 'their';

/** Where the next champion clicked in the grid lands. */
type DraftTarget =
  | { kind: 'ban' }
  | { kind: 'pick'; side: DraftSide; index: number };

/** Fearless series run ten bans a game, same as the client. */
const MAX_BANS = 10;

/**
 * Burned champions shown in the confirm-slot strip.
 *
 * Forty is a full Bo5 — in practice, all of them. Capping at ten was the wrong
 * instinct: under fearless the burned list *is* the thing being tracked, so
 * hiding half of it behind a "+10" put the answer one hover away at exactly the
 * moment it is needed. The row scrolls inside its own box instead, which keeps
 * the slot height fixed without dropping anything.
 */
const BURN_STRIP_MAX = 40;

/**
 * One game, full width, for use while the draft is actually happening: bans and
 * picks as they land, and what still survives the fearless burn.
 */
@Component({
  selector: 'app-tournament-draft',
  imports: [
    FormsModule,
    ChampionGridComponent,
    ChampionPickerComponent,
    TooltipDirective
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

  private readonly ctx = inject(TournamentContextService);

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

  /** The series being drafted: whatever was picked, else the first live one. */
  protected draftSeries(): TournamentSeries | undefined {
    const list = this.seriesList();
    return (
      list.find((s) => s.id === this.pickedSeriesId()) ??
      list.find((s) => this.gamesFor(s.id).some((g) => g.win === undefined)) ??
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

  protected selectDraftGame(gameId: string): void {
    this.pickedGameId.set(gameId);
    this.heldPick.set(null);
  }

  /** Bo3 means three games; there is nothing to draft beyond that. */
  protected canAddDraftGame(series: TournamentSeries): boolean {
    return this.gamesFor(series.id).length < series.bestOf;
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
    if (existing.length >= series.bestOf) return;
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

  /** A comp's picks by role, for the expanded row. */
  protected compLineup(compId: string): { role: Role; champion: string }[] {
    const comp = this.data.comps().find((c) => c.id === compId);
    if (!comp) return [];
    return this.roles.map((role) => ({
      role,
      champion: this.ui.parseCompLine(comp.picks[role] ?? '').champion
    }));
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
  protected removeDraftGame(game: SeriesGame): void {
    const drafted = (game.bans ?? []).length
      + [...(game.ourChampions ?? []), ...(game.theirChampions ?? [])].filter(Boolean).length;
    const what = drafted ? ` and the ${drafted} bans and picks drafted into it` : '';
    if (!confirm(`Remove game ${game.gameNumber}${what}?`)) return;
    this.pickedGameId.set('');
    void this.data.deleteSeriesGame(game.id);
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
      this.data.players().map((p) => ({ name: p.name, role: p.role, pool: p.top3 ?? [] })),
      blocked
    );
  }

  protected burnedBeforeCount(game: SeriesGame): number {
    return this.burnedBefore(game.seriesId, game.gameNumber).length;
  }

  /**
   * What the series has already spent, for the strip in the confirm slot.
   *
   * Capped, because game three of a best-of-five burns twenty champions and a
   * row that wide pushes the bans it sits beside off the edge — the one thing
   * this strip exists to prevent. The overflow count carries the rest, and the
   * full list is still on the board below.
   */
  protected burnedIcons(game: SeriesGame): string[] {
    return this.burnedBefore(game.seriesId, game.gameNumber).slice(0, BURN_STRIP_MAX);
  }

  protected moreBurned(game: SeriesGame): number {
    return Math.max(0, this.burnedBeforeCount(game) - BURN_STRIP_MAX);
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
    return new Set((game.bans ?? []).filter(Boolean).map((c) => normalizeChampion(c)));
  }

  protected gridPick(game: SeriesGame, name: string): void {
    const aimed = this.target();

    if (aimed.kind === 'ban') {
      const bans = [...(game.bans ?? [])];
      const at = bans.findIndex((b) => normalizeChampion(b) === normalizeChampion(name));
      if (at >= 0) bans.splice(at, 1);
      else if (bans.length < MAX_BANS) bans.push(name);
      this.setGameBans(game, bans);
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
      (live.draftStep ?? 0) === 0 &&
      !(live.bans ?? []).some(Boolean) &&
      !(live.ourChampions ?? []).some(Boolean) &&
      !(live.theirChampions ?? []).some(Boolean)
    );
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
    const closing = lastPickOfPhase(game.draftStep ?? 0);
    if (!closing || !game.ourSide) return null;
    return closing === game.ourSide;
  }

  protected picksLeft(game: SeriesGame): number {
    return picksLeftInPhase(game.draftStep ?? 0);
  }

  /**
   * Comps of ours that a champion belongs to — the cost of banning it.
   *
   * At ban time the useful question inverts: not "does this help us" but "does
   * banning it cost us". A ban is permanent for the whole series under
   * fearless, so banning a champion three of our comps depend on spends one of
   * their bans for them.
   */
  protected banCost(game: SeriesGame, champion: string): string[] {
    return compsUsing(
      champion,
      this.compAvailability(game.seriesId),
      (comp, lane) => {
        const source = this.data.comps().find((c) => c.id === comp.id);
        return source ? this.ui.parseCompLine(source.picks[lane] ?? '').champion : '';
      },
      this.roles
    );
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
      (champ) => this.banCost(game, champ)
    ).slice(0, 5);
  }

  protected step(game: SeriesGame): DraftStep | null {
    return stepAt(game.draftStep ?? 0);
  }

  protected sequenceDone(game: SeriesGame): boolean {
    return isComplete(game.draftStep ?? 0);
  }

  protected progress(game: SeriesGame): number {
    return draftProgress(game.draftStep ?? 0);
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
    if (!champ || !step || step.action !== 'pick') return null;

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
    this.pending.set(name);
    this.writeHold(name);
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
    const blocked = blockedSet(this.unavailableFor(game, action));
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
    if (this.autoFilling()) return;
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

        const before = live.draftStep ?? 0;
        this.pending.set(champ);
        await this.confirmPending(live);
        if ((this.current(game).draftStep ?? 0) === before) break;
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
    // Refuse rather than advance with nothing stored.
    if (this.confirmBlockedReason(live)) return;

    this.committing.set(true);
    try {
      const next = (live.draftStep ?? 0) + 1;

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
          draftStep: next,
          holding: undefined
        });
      }
      this.pending.set(null);
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
    if (drafted && !confirm(`Clear all ${drafted} bans and picks from game ${live.gameNumber}?`)) return;

    await this.data.updateSeriesGame({
      ...live,
      bans: undefined,
      ourChampions: [],
      theirChampions: [],
      ourSide: undefined,
      draftStep: undefined,
      holding: undefined
    });
    this.pending.set(null);
  }

  /** Step back one, for a misclick that was already confirmed. */
  protected async undoStep(game: SeriesGame): Promise<void> {
    if (this.committing()) return;
    const live = this.current(game);
    const position = live.draftStep ?? 0;
    if (position <= 0) return;
    const previous = stepAt(position - 1);
    if (!previous) return;

    const patch: Partial<SeriesGame> = { draftStep: position - 1, holding: undefined };
    if (previous.action === 'ban') {
      patch.bans = (live.bans ?? []).slice(0, -1);
    } else {
      const side = previous.team === live.ourSide ? 'our' : 'their';
      const picks = [...((side === 'our' ? live.ourChampions : live.theirChampions) ?? [])];
      // Undo the last filled seat rather than the last index: seats are keyed by
      // role, so the most recent pick is not necessarily the highest index.
      for (let i = picks.length - 1; i >= 0; i--) {
        if (picks[i]) { picks[i] = ''; break; }
      }
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
    const step = this.step(game);
    const base = this.unavailableFor(game, step?.action === 'ban' ? 'ban' : 'pick');
    return step?.action === 'ban' ? [...base, ...(game.bans ?? [])] : base;
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
    return !!game.ourSide && !isComplete(game.draftStep ?? 0);
  }

  protected confirmBlockedReason(game: SeriesGame): string | null {
    const step = this.step(game);
    if (!this.pending() || !step || step.action !== 'pick') return null;
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
    const found = suggestForLane(seat, [champ], this.compAvailability(game.seriesId), (comp, lane) => {
      const source = this.data.comps().find((c) => c.id === comp.id);
      return source ? this.ui.parseCompLine(source.picks[lane] ?? '').champion : '';
    });
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
    const banned = (game.bans ?? []).filter(Boolean).length;

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
    return `${champion} into ${theirs}: ${r.winRate}% over ${r.games.toLocaleString()} games on ${where}.`;
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
    return suggestForLane(lane, candidates, this.compAvailability(game.seriesId), (comp, seat) => {
      const source = this.data.comps().find((c) => c.id === comp.id);
      return source ? this.ui.parseCompLine(source.picks[seat] ?? '').champion : '';
    }).slice(0, 6);
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

  /** The seat's lane, so the grid narrows itself without anyone filtering. */
  protected gridLane(): Role | null {
    const aimed = this.target();
    return aimed.kind === 'pick' ? this.roles[aimed.index] : null;
  }

  /** What the grid is currently pointed at, for the hint above it. */
  protected targetLabel(game: SeriesGame): string {
    const aimed = this.target();
    if (aimed.kind === 'ban') {
      return `Bans — ${(game.bans ?? []).length} of ${MAX_BANS}`;
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
