import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OpponentPlayer, Role, Scrim, ScrimOpponent, ScrimPlayer } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { OpponentScoutService } from '../../services/opponent-scout.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { looksLikeFiveOnFive, matchIdFromFilename, parseReplay } from '../../core/replay-parse';
import { noteLines } from '../../core/note-lines';
import { parseRiotIds } from '../../core/riot-id';
import {
  appendToRoster,
  banCandidates,
  bench,
  countersAreForSeat,
  countersFor,
  orderedRoster,
  poolFor,
  poolIsForSeat,
  queueRows,
  masteryLabel,
  masteryOf,
  rateBand,
  rateOf,
  recentForSeat,
  recentHidden,
  reseatOpponent,
  setSubstitute,
  starters,
  scoutedAgo
} from '../../core/opponent-view';
import { OpponentHistoryService } from '../../services/opponent-history.service';
import { ScrimGroup, groupScrims, slugOpponent } from './scrim-groups';

/**
 * Scrims, imported from replay files and grouped by who they were against.
 *
 * Custom games never enter the Riot API — queueId 0 never appears in a match
 * list and `matches/{id}` answers 404 even when the id is known — so before
 * this, every scrim the team played was invisible to the app. Scrims are where
 * they actually practise for the tournament, which made it the largest hole in
 * the data.
 *
 * A flat list of games answered "what did we play" and nothing else. Folding
 * them by opponent is what turns the page into a history — how often we have
 * met a team, how it has gone — and gives the notes, target bans and scouted
 * roster that a tournament series already carries somewhere to live for a
 * practice partner. Same panel, same scouting, same data shape; the only
 * difference is that a scrim opponent has no bracket to hang off.
 *
 * Everything is parsed in the browser. The file never leaves the machine, and
 * only the scoreboard is stored — a twenty-megabyte replay reduces to about a
 * kilobyte of counters.
 */
@Component({
  selector: 'app-scrims',
  imports: [FormsModule, RouterLink, TooltipDirective, ChampionPickerComponent, ChampionChipComponent, ChampionFilterComponent],
  templateUrl: './scrims.component.html'
})
export class ScrimsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  protected readonly filter = inject(ChampionFilterService);
  private readonly history = inject(OpponentHistoryService);
  protected readonly scout = inject(OpponentScoutService);

  protected readonly importing = signal(false);
  protected readonly importNote = signal('');

  /** Names already on the page, so a team you have played before is one pick. */
  protected readonly knownOpponents = computed(() =>
    this.groups().map((g) => g.name).filter((n) => n && n !== 'Unnamed opponent')
  );
  /** Files that produced nothing, so a silent skip is still reported. */
  protected readonly skipped = signal<string[]>([]);

  /** Which scrim scoreboards are expanded. */
  protected readonly openId = signal<string>('');

  /** Our own name, so a scoreboard says who is who rather than Blue and Red. */
  protected readonly teamName = computed(() => this.data.settings().teamName || 'Us');

  protected readonly noteLines = noteLines;
  protected readonly roles: readonly Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

  // ---- Grouped by opponent ------------------------------------------------

  /**
   * Every team on the page: the ones we have played, and the ones we are
   * about to.
   *
   * Scrims fold by opponent, most recent first. In front of them go the
   * opponents that exist only as a record — added by hand to prep before the
   * games happen — with no scrims yet. Prep comes first because a team you are
   * about to play is the reason you opened the page; once their replays are
   * imported under the same name they fold into that same group and it moves
   * into the played list on its own.
   */
  protected readonly groups = computed<ScrimGroup[]>(() => {
    const records = new Map(this.data.scrimOpponents().map((o) => [o.id, o]));
    // The name somebody typed when prepping beats whatever was typed on a
    // replay: "Elysion Esports" was deliberate, "elysion esports" on a file at
    // midnight was not, and the record is the one that carries the notes.
    // The shared champion filter narrows to the replays that champion was in,
    // on either side — a scrim where they played it against us counts too.
    const scrims = this.data.scrims().filter((s) => this.filter.passes(s.players.map((p) => p.champion)));
    const played = groupScrims(scrims, (scrim) => this.won(scrim)).map((g) => ({
      ...g,
      name: records.get(g.id)?.name || g.name
    }));
    const seen = new Set(played.map((g) => g.id));
    const prepping: ScrimGroup[] = this.data
      .scrimOpponents()
      .filter((o) => !seen.has(o.id))
      .sort((a, b) => b.order - a.order)
      .map((o) => ({ id: o.id, name: o.name, scrims: [], wins: 0, losses: 0, unknown: 0, lastPlayed: '' }));
    // A team still being prepped has no replays to match, so it steps aside
    // while a champion is being asked about.
    return this.filter.active() ? played : [...prepping, ...played];
  });

  protected readonly matchedScrims = computed(() => this.groups().reduce((n, g) => n + g.scrims.length, 0));

  // ---- Prepping for a scrim ---------------------------------------------
  //
  // The replays come after the games; the scouting has to come before. So an
  // opponent can be added by name alone, scouted, and the replays dropped in
  // afterwards under the same name — which folds them into the record that
  // already exists.

  protected readonly newOpponentName = signal('');

  protected addOpponent(): void {
    const name = this.newOpponentName().trim();
    if (!name) return;
    const id = slugOpponent(name);
    const existing = this.data.scrimOpponents().find((o) => o.id === id);
    if (!existing) {
      void this.data.saveScrimOpponent({ id, name, order: this.data.scrimOpponents().length });
    }
    this.newOpponentName.set('');
    // Open it, whether it was just created or was already there under another
    // spelling — either way, this is the one they want to work on now.
    const next = new Set(this.openGroups() ?? []);
    next.add(id);
    this.openGroups.set(next);
  }

  /**
   * Which opponent panels are open.
   *
   * The most recent one opens itself: the team you scrimmed last night is the
   * one you came to the page to look at. The rest stay folded so a season of
   * practice partners does not become a wall.
   */
  private readonly openGroups = signal<ReadonlySet<string> | null>(null);

  protected isGroupOpen(group: ScrimGroup): boolean {
    const open = this.openGroups();
    if (open) return open.has(group.id);
    return this.groups()[0]?.id === group.id;
  }

  protected toggleGroup(group: ScrimGroup): void {
    const current = this.openGroups() ?? new Set(this.groups()[0] ? [this.groups()[0].id] : []);
    const next = new Set(current);
    next.has(group.id) ? next.delete(group.id) : next.add(group.id);
    this.openGroups.set(next);
  }

  /**
   * What we know about this opponent, or an empty record ready to be written.
   *
   * There is no "add opponent" step. The record comes into being the first time
   * a note, a ban or a roster is saved against the group, keyed by the same slug
   * the group uses — so it is found again next time without anyone linking it.
   */
  protected opponentFor(group: ScrimGroup): ScrimOpponent {
    const stored = this.data.scrimOpponents().find((o) => o.id === group.id);
    if (stored) return stored;

    // Nothing saved for them here yet — but a team scouted for a tournament
    // series under the same name is the same team, so start from that rather
    // than asking for the link a second time. Read-only until something is
    // saved against the scrim record, at which point that record takes over.
    const series = this.data.tournamentSeries().find((s) => slugOpponent(s.opponent) === group.id);
    return {
      id: group.id,
      name: group.name,
      order: this.data.scrimOpponents().length,
      ...(series
        ? { opponentPlayers: series.opponentPlayers, bans: series.bans, notes: series.notes }
        : {})
    };
  }

  /** A single Name#TAG or op.gg link to add to a roster already in place. */
  protected readonly playerPaste = signal('');

  /**
   * Add one or more players without replacing the roster — the sub who was not
   * in the multi-link, or the name that was missed. Skips anyone already there.
   */
  protected addPlayer(group: ScrimGroup): void {
    const roster = appendToRoster(parseRiotIds(this.playerPaste()), this.opponentFor(group).opponentPlayers ?? []);
    if (roster.length === (this.opponentFor(group).opponentPlayers ?? []).length) return;
    this.playerPaste.set('');
    this.patchOpponent(group, { opponentPlayers: roster });
  }

  protected patchOpponent(group: ScrimGroup, patch: Partial<ScrimOpponent>): void {
    void this.data.saveScrimOpponent({ ...this.opponentFor(group), ...patch });
  }

  protected setOpponentBans(group: ScrimGroup, bans: string[]): void {
    this.patchOpponent(group, { bans: bans.length ? bans : undefined });
  }

  /** The champions a ban would actually hurt, across their five. */
  protected readonly banCandidates = banCandidates;

  protected isTargetBan(group: ScrimGroup, champion: string): boolean {
    return (this.opponentFor(group).bans ?? []).some((b) => b.toLowerCase() === champion.toLowerCase());
  }

  /** One click from the ban board to the target-ban list, without duplicates. */
  /** A board card toggles: one click adds the target ban, the next removes it. */
  protected toggleTargetBan(group: ScrimGroup, champion: string): void {
    const bans = this.opponentFor(group).bans ?? [];
    this.setOpponentBans(
      group,
      this.isTargetBan(group, champion) ? bans.filter((b) => !(b.replace(/[^a-z0-9]/gi, '').toLowerCase() === champion.replace(/[^a-z0-9]/gi, '').toLowerCase())) : [...bans, champion]
    );
  }

  /** Whether there is anything worth showing in the panel when not editing. */
  protected hasPrep(group: ScrimGroup): boolean {
    const o = this.opponentFor(group);
    return !!(o.notes || o.bans?.length || o.opponentPlayers?.length);
  }

  /**
   * The last time this opponent was scrimmed, as a day.
   *
   * Sits in the summary so a glance down the page says who is recent and who
   * is months stale, which is most of what a history is for.
   */
  protected lastPlayed(group: ScrimGroup): string {
    return group.lastPlayed ? this.ui.formatDay(group.lastPlayed) : '';
  }

  // ---- Their roster -------------------------------------------------------
  //
  // The same setup as a tournament series: paste an op.gg multi-link or a list
  // of Riot IDs, then scout them through Riot. Only the text of a pasted URL is
  // read — the site is never requested.

  protected readonly rosterPaste = signal('');
  protected readonly pasteOpenFor = signal<string>('');

  protected togglePaste(id: string): void {
    this.pasteOpenFor.set(this.pasteOpenFor() === id ? '' : id);
  }

  protected applyRoster(group: ScrimGroup): void {
    const roster = this.scout.fromPaste(this.rosterPaste(), this.opponentFor(group).opponentPlayers ?? []);
    if (!roster.length) return;
    this.rosterPaste.set('');
    this.pasteOpenFor.set('');
    this.patchOpponent(group, { opponentPlayers: roster });
  }

  protected scoutOpponents(group: ScrimGroup): void {
    void this.scout.scoutScrimOpponent(this.opponentFor(group));
  }

  protected setOpponentRole(group: ScrimGroup, player: OpponentPlayer, role: Role): void {
    const roster = reseatOpponent(this.opponentFor(group).opponentPlayers ?? [], player, role);
    if (roster) this.patchOpponent(group, { opponentPlayers: roster });
  }

// ---- As a team: their games together lately ---------------------------

  /** Held on the service, so the button reads busy from any page. */
  protected readonly historyBusy = this.history.busy;
  protected readonly historyError = signal('');

  protected async fetchHistory(group: ScrimGroup): Promise<void> {
    this.historyError.set('');
    try {
      const teamHistory = await this.history.load(starters(this.opponentFor(group).opponentPlayers ?? []), { key: group.id, label: group.name });
      this.patchOpponent(group, { teamHistory });
    } catch (error) {
      this.historyError.set(error instanceof Error ? error.message : 'Their match history could not be loaded.');
    }
  }

  protected setOpponentSub(group: ScrimGroup, player: OpponentPlayer, sub: boolean): void {
    const roster = setSubstitute(this.opponentFor(group).opponentPlayers ?? [], player, sub);
    if (roster) this.patchOpponent(group, { opponentPlayers: roster });
  }

  protected roster(group: ScrimGroup): OpponentPlayer[] {
    return starters(this.opponentFor(group).opponentPlayers ?? []);
  }

  protected bench(group: ScrimGroup): OpponentPlayer[] {
    return bench(this.opponentFor(group).opponentPlayers ?? []);
  }

  protected scoutedAt(group: ScrimGroup): string {
    return scoutedAgo(this.opponentFor(group).opponentPlayers ?? []);
  }

  // Pure table helpers, shared with the tournament plan.
  protected readonly poolFor = poolFor;
  protected readonly masteryOf = masteryOf;
  protected readonly masteryLabel = masteryLabel;
  protected readonly countersFor = countersFor;
  protected readonly poolIsForSeat = poolIsForSeat;
  protected readonly countersAreForSeat = countersAreForSeat;
  protected readonly queueRows = queueRows;
  protected readonly recentForSeat = recentForSeat;
  protected readonly recentHidden = recentHidden;
  protected readonly rateOf = rateOf;
  protected readonly rateBand = rateBand;

  // ---- One scrim ----------------------------------------------------------

  /**
   * What to call one side of a scrim.
   *
   * Once we know which side we were on, both sides have a name: ours from
   * settings and theirs from whatever the scrim was labelled. Blue and Red
   * are the fallback, not the default — a scoreboard of ten strangers is
   * hard enough to read without the teams being colours.
   */
  protected teamLabel(scrim: Scrim, team: 100 | 200): string {
    const side = this.ourSide(scrim);
    const colour = team === 100 ? 'blue' : 'red';
    if (!side) return team === 100 ? 'Blue' : 'Red';
    if (side === colour) return this.teamName();
    return scrim.opponent?.trim() || (team === 100 ? 'Blue' : 'Red');
  }

  protected toggle(id: string): void {
    this.openId.set(this.openId() === id ? '' : id);
  }

  /**
   * Our roster, by Riot ID, for spotting which side is ours.
   *
   * Matching on the Riot ID rather than the champion, because both teams pick
   * from the same pool and a scrim against a team that mirrors a pick would put
   * us on both sides.
   */
  private readonly ourIds = computed(() => {
    const ids = new Set<string>();
    for (const player of this.data.players()) {
      const tag = player.profile?.riotTag?.replace(/^#/, '') ?? '';
      if (player.name) ids.add(`${player.name}#${tag}`.toLowerCase());
    }
    return ids;
  });

  /** Which side we were on: stored if someone said, else read off the roster. */
  protected ourSide(scrim: Scrim): 'blue' | 'red' | null {
    if (scrim.ourSide) return scrim.ourSide;

    const ours = this.ourIds();
    const mine = (team: number) =>
      scrim.players.filter((p) => p.team === team && ours.has(`${p.name}#${p.tag}`.toLowerCase())).length;

    const blue = mine(100);
    const red = mine(200);
    if (blue === red) return null; // A tie is not an answer; leave it unsaid.
    return blue > red ? 'blue' : 'red';
  }

  protected won(scrim: Scrim): boolean | null {
    const side = this.ourSide(scrim);
    if (!side) return null;
    return side === 'blue' ? scrim.blueWon : !scrim.blueWon;
  }

  /**
   * One side, in lane order rather than the order the replay listed them.
   *
   * A scoreboard is read top-to-support; replay order is arbitrary, so the
   * two teams did not even line up with each other row by row.
   */
  protected side(scrim: Scrim, team: 100 | 200): ScrimPlayer[] {
    const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
    return scrim.players
      .filter((p) => p.team === team)
      .sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position));
  }

  /** Riot names the lanes; the app speaks in roles, and so does everyone. */
  protected lane(position: string): string {
    return (
      { TOP: 'TOP', JUNGLE: 'JGL', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUP' }[position] ?? '—'
    );
  }

  /** The fight scoreline. The one number that says how the game went. */
  protected teamKills(scrim: Scrim, team: 100 | 200): number {
    return this.side(scrim, team).reduce((n, p) => n + p.kills, 0);
  }

  private teamGold(scrim: Scrim, team: 100 | 200): number {
    return this.side(scrim, team).reduce((n, p) => n + p.gold, 0);
  }

  /**
   * Gold difference from one side's point of view.
   *
   * End-of-game only — the replay carries no timeline — so it says how far
   * apart the teams finished, not when the gap opened. Still the quickest read
   * on whether a loss was close or not.
   */
  protected goldDiff(scrim: Scrim, team: 100 | 200): number {
    const other = team === 100 ? 200 : 100;
    return this.teamGold(scrim, team) - this.teamGold(scrim, other);
  }

  /**
   * The objectives one side took, as chips worth showing.
   *
   * Only what happened: a side with no barons says nothing about barons rather
   * than showing a zero, because five zeroes on a row hide the one number that
   * matters. firstBlood and firstTower are never included — the replay does
   * not record them, so a false there means unknown, not no.
   */
  protected objectives(scrim: Scrim, team: 100 | 200): { icon: string; count: number; label: string }[] {
    const side = team === 100 ? scrim.objectives?.blue : scrim.objectives?.red;
    if (!side) return [];
    return [
      { icon: 'local_fire_department', count: side.dragons, label: 'dragons' },
      { icon: 'pest_control', count: side.barons, label: 'barons' },
      { icon: 'flutter_dash', count: side.heralds, label: 'heralds' },
      { icon: 'bug_report', count: side.grubs, label: 'voidgrubs' },
      { icon: 'castle', count: side.towers, label: 'towers' },
      { icon: 'door_front', count: side.inhibitors, label: 'inhibitors' }
    ].filter((o) => o.count > 0);
  }

  protected isOurs(player: ScrimPlayer): boolean {
    return this.ourIds().has(`${player.name}#${player.tag}`.toLowerCase());
  }

  protected duration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected kda(p: ScrimPlayer): string {
    return `${p.kills}/${p.deaths}/${p.assists}`;
  }

  /**
   * Thousands, since raw damage numbers are five digits and unreadable.
   *
   * Measured on magnitude, not on the value: a gold difference is signed, and
   * testing `value >= 1000` left every deficit as a raw "-12200" beside a
   * tidy "+12.2k" on the other side of the same game.
   */
  protected k(value: number): string {
    const size = Math.abs(value);
    if (size < 1000) return String(value);
    return `${value < 0 ? '-' : ''}${(size / 1000).toFixed(1)}k`;
  }

  protected setOpponent(scrim: Scrim, opponent: string): void {
    void this.data.saveScrim({ ...scrim, opponent });
  }

  protected setNote(scrim: Scrim, note: string): void {
    void this.data.saveScrim({ ...scrim, note });
  }

  /**
   * Delete a team: every replay in the group and, if one exists, the record
   * carrying their notes, bans and roster. One confirm that says which.
   */
  protected async removeOpponent(group: ScrimGroup): Promise<void> {
    const n = group.scrims.length;
    const record = this.data.scrimOpponents().find((o) => o.id === group.id);
    const parts = [
      n ? n + (n === 1 ? ' replay' : ' replays') : '',
      record ? 'their notes, bans and roster' : ''
    ].filter(Boolean);
    const what = parts.length ? 'This removes ' + parts.join(' and ') + '.' : '';
    if (!confirm('Delete ' + group.name + '? ' + what)) return;
    for (const scrim of group.scrims) await this.data.deleteScrim(scrim.id);
    if (record) await this.data.deleteScrimOpponent(record.id);
  }

  protected async remove(scrim: Scrim): Promise<void> {
    const when = this.ui.formatDay(scrim.playedOn);
    if (!confirm('Delete the scrim on ' + when + (scrim.opponent ? ' against ' + scrim.opponent : '') + '?')) return;
    await this.data.deleteScrim(scrim.id);
  }

  // ---- Importing ----------------------------------------------------------

  /**
   * Read dropped or chosen replay files.
   *
   * Sequential and awaited rather than fired in parallel: each file is twenty
   * megabytes, and reading ten at once is how a browser tab runs out of memory
   * on a laptop. Anything unreadable is named rather than dropped in silence,
   * because a folder always has a stray file in it and "nothing happened" is
   * the worst possible answer to a drag-and-drop.
   */
  protected async importFiles(files: FileList | null, opponent: string): Promise<void> {
    if (!files?.length || this.importing()) return;

    this.importing.set(true);
    this.skipped.set([]);
    const failed: string[] = [];
    let saved = 0;

    try {
      for (const file of Array.from(files)) {
        this.importNote.set(`Reading ${file.name}…`);

        const id = matchIdFromFilename(file.name);
        if (!id) {
          failed.push(`${file.name} — no match id in the filename`);
          continue;
        }

        const game = parseReplay(await file.arrayBuffer());
        if (!game) {
          failed.push(`${file.name} — not a readable replay`);
          continue;
        }
        if (!looksLikeFiveOnFive(game)) {
          failed.push(`${file.name} — not a full 5v5`);
          continue;
        }

        await this.data.saveScrim({
          id,
          opponent: opponent || undefined,
          // The replay knows how long the game ran but never when it started,
          // so the file's own timestamp is the closest thing to a date. It is
          // a few minutes late, which matters to nobody.
          playedOn: new Date(file.lastModified).toISOString(),
          durationSec: game.durationSec,
          blueWon: game.blueWon,
          surrendered: game.surrendered,
          players: game.players.map((p) => ({ ...p })),
          objectives: { blue: { ...game.objectives.blue }, red: { ...game.objectives.red } },
          order: this.data.scrims().length + saved
        });
        saved += 1;
      }
    } finally {
      this.importing.set(false);
      const against = opponent;
      this.importNote.set(
        saved
          ? `Imported ${saved} ${saved === 1 ? 'scrim' : 'scrims'}${against ? ` against ${against}` : ''}.`
          : 'Nothing imported.'
      );
      this.skipped.set(failed);
    }
  }


  // ---- Importing into a team's own panel ----------------------------------
  //
  // The flow people actually follow is prep → scout → import *here*, in the
  // panel they are already looking at. A single "Against" field at the top of
  // the page was too far from that: files dropped with it empty filed under
  // "Unnamed opponent", which is exactly what happened the first time it was
  // used. Each panel now takes its own replays and names them itself.

  /** Which team's drop zone a drag is over, for the highlight. */
  protected readonly dragTarget = signal<string>('');

  protected onGroupDragOver(event: DragEvent, group: ScrimGroup): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragTarget.set(group.id);
  }

  protected onGroupDrop(event: DragEvent, group: ScrimGroup): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragTarget.set('');
    void this.importFiles(event.dataTransfer?.files ?? null, group.name);
  }

  /** Where the unnamed scrims should have gone. */
  protected readonly reassignTo = signal('');

  /**
   * File every scrim in a group under a different team.
   *
   * For the games that landed in "Unnamed opponent" before the per-panel drop
   * zone existed, and for a batch named wrongly. Written one scrim at a time;
   * they re-group on their own as each save lands.
   */
  protected async reassign(group: ScrimGroup): Promise<void> {
    const name = this.reassignTo().trim();
    if (!name) return;
    for (const scrim of group.scrims) {
      await this.data.saveScrim({ ...scrim, opponent: name });
    }
    this.reassignTo.set('');
  }

}
