import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Role, SeriesGame, TournamentSeries } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
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
import { TournamentContextService } from '../tournament-context.service';

/** Which team a draft slot belongs to. */
type DraftSide = 'our' | 'their';

/** Where the next champion clicked in the grid lands. */
type DraftTarget =
  | { kind: 'ban' }
  | { kind: 'pick'; side: DraftSide; index: number };

/** Fearless series run ten bans a game, same as the client. */
const MAX_BANS = 10;

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
export class TournamentDraftComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);

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

  private readonly pickedSeriesId = signal<string>('');
  private readonly pickedGameId = signal<string>('');

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
