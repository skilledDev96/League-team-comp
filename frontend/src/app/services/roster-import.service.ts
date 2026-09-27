import { Injectable, computed, inject, signal } from '@angular/core';
import { isFirebaseConfigured } from '../core/firebase';
import { RiotId, formatRiotId, parseRiotIds } from '../core/riot-id';
import {
  FailureKind,
  RosterImportPlan,
  applyEnrichment,
  failureReason,
  planRosterImport,
  seatSuggestion,
  seatsFromDetected
} from '../core/roster-import';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { Player, Role } from '../models/team.models';
import { ActivityHandle, ActivityService } from './activity.service';
import { AuthService } from './auth.service';
import { ConfirmService } from './confirm.service';
import { OpponentScoutService, SECONDS_PER_PLAYER } from './opponent-scout.service';
import { PlayerEnrichmentService } from './player-enrichment.service';
import { RefreshService } from './refresh.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService, resetOnTeamChange, teamChangedNotice } from './team-scope.service';
import { ToastService } from './toast.service';

/**
 * The roster importer (27 Sep 2026, the lead: paste an op.gg multi-link and have
 * the app populate itself). A root service, so a run survives the page that
 * started it, like OpponentScoutService and RefreshService.
 *
 * Two phases. Phase 1 writes a skeleton player per Riot ID through
 * TeamDataService.createPlayer, so the roster is on screen within a second and
 * an interrupted import keeps what it made. Phase 2 reads each player from Riot
 * one at a time through the same enrichPlayer the roster refresh uses: one slot,
 * sequential, saved after each player, because five in parallel is five 429s
 * and no data. The live player is re-read before every write, since
 * persistUpsert writes the whole document (the morning job's own lesson).
 *
 * What it never does: write template text (enrichPlayer answers 200 with a role
 * template on any failure, and the reason lives in `provider`; a template on a
 * real person's row is worse than an empty one), touch a player it did not
 * create, fetch op.gg (only the pasted text is read, in core/riot-id.ts) or send
 * anything to the model provider. Nor does it write to a team it did not start on
 * (27 Sep 2026, Stage 3c): the active team is captured when a run starts and
 * checked before every write, and a run the team moved under stops there, says so,
 * and leaves what already landed where it landed.
 */

export type RosterImportState = 'pending' | 'reading' | 'done' | 'failed' | 'withdrawn' | 'skipped';

export interface RosterImportRow {
  id: RiotId;
  /**
   * The player document this row made; absent for a skipped row, when the skeleton
   * was never written, or once the row withdrew it (the Open pill reads this, and a
   * pill whose only outcome is "not on the roster any more" is a mechanism that
   * silently does nothing).
   */
  playerId?: string;
  seat: Role;
  sub: boolean;
  state: RosterImportState;
  /** Why the row is skipped, failed or withdrawn, in words for the row. */
  reason?: string;
  /** What kind of failure, so a results card can say "the key" once rather than on five rows. */
  kind?: FailureKind;
  /** The seat Riot sees a starter in when it is not the one they hold. A suggestion; never written by the import. */
  suggestion?: Role;
}

export interface RosterImportPreview extends RosterImportPlan {
  /** Every Riot ID read from the paste, in paste order. */
  ids: RiotId[];
  /** Entries of the paste the parser could not read: a name with no tag, or the same Riot ID twice. */
  dropped: number;
}

/** How long the finish toast holds its Undo pill: longer than the 6.5 s default, since the import took minutes. */
const UNDO_WINDOW_MS = 15000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const rowKey = (id: RiotId) => formatRiotId(id).toLowerCase();

/**
 * How many entries of a paste the parser dropped, for the preview line ("1 line
 * skipped, no tag"). Counted the way parseRiotIds splits the text: a multi-link's
 * summoners, else summoner pages, else lines and commas. A typed name with no
 * tag is dropped by design (guessing a tag can scout a stranger on another
 * region), and so is a repeat.
 */
export function unreadEntries(text: string, found: number): number {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 0;
  const multi = trimmed.match(/multisearch\/[a-z]+\?summoners=([^\s&]+)/i);
  let entries: number;
  if (multi) {
    // A stray percent sign is not percent-encoding and decodeURIComponent throws on
    // it; the raw list still splits on its commas, which is all the count needs.
    let list = multi[1];
    try {
      list = decodeURIComponent(multi[1]);
    } catch {
      // Counted as typed.
    }
    entries = list.split(',').filter((part) => part.trim()).length;
  } else {
    const pages = [...trimmed.matchAll(/summoners?\/[a-z]+\/[^/\s?#]+/gi)].length;
    entries = pages || trimmed.split(/[\n,;]+/).filter((part) => part.trim()).length;
  }
  return Math.max(0, entries - found);
}

@Injectable({ providedIn: 'root' })
export class RosterImportService {
  private readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly activity = inject(ActivityService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly scout = inject(OpponentScoutService);
  private readonly refresh = inject(RefreshService);
  private readonly scope = inject(TeamScopeService);

  readonly importing = signal(false);
  readonly progress = signal('');
  /** Players read and players to read, for a bar rather than a spinner. */
  readonly done = signal(0);
  readonly total = signal(0);
  /** The scout's estimate, for the same reason: a minute a player is the rate limit, not a slow implementation. */
  readonly secondsLeft = computed(() => Math.max(this.total() - this.done(), 0) * SECONDS_PER_PLAYER);
  /** One row per Riot ID in the paste, in paste order, for the results card. */
  readonly rows = signal<readonly RosterImportRow[]>([]);
  /** Every player id this run created, withdrawn ones included; Undo deletes those still present. */
  readonly createdIds = signal<readonly string[]>([]);
  /** The team the last run created them on; Undo checks the app is still on it before it deletes. */
  private createdOn = DEFAULT_TEAM_ID;

  /**
   * Why an import cannot start right now, or null. Named, because a silent
   * refusal is how a run "just never came back": a scout, a player refresh and
   * the analysis all spend the same hundred Riot calls per two minutes, and the
   * board is where they announce themselves (the scout and the refreshes refuse
   * while this runs, the other way round).
   */
  readonly blocker = computed<string | null>(() => {
    if (!this.auth.canEdit()) return 'Only an editor can import a roster.';
    if (this.importing() || this.activity.has('Importing roster')) return 'An import is already running; wait for it to finish.';
    if (this.scout.scouting() || this.activity.has('Scouting')) return 'Wait for the scout to finish; it spends the same Riot calls.';
    if (this.refresh.playersRunning() || this.activity.has('Refreshing player data')) {
      return 'Wait for the player refresh to finish; it spends the same Riot calls.';
    }
    if (this.refresh.anyRunning() || this.activity.has('Refreshing match analysis')) {
      return 'Wait for the analysis refresh to finish; it spends the same Riot calls.';
    }
    return null;
  });
  readonly canStart = computed(() => this.blocker() === null);

  /**
   * The seats "Seat by Riot's roles" would write: one per starter, only when
   * all five starters were read and Riot put them in five different seats.
   */
  readonly riotSeats = computed(() =>
    seatsFromDetected(
      this.rows()
        .filter((r) => r.playerId && r.state !== 'skipped')
        .map((r) => ({
          playerId: r.playerId!,
          sub: r.sub,
          detected: r.state === 'done' ? (r.suggestion ?? r.seat) : undefined
        }))
    )
  );

  constructor() {
    // Rows and created ids belong to the account and the team that made them: sign-out, another
    // account taking over, or a team switch (27 Sep 2026, Stage 3c) empties them, and a run in flight
    // stops at its next step (it checks the email and the team each step). Kept across a switch, the
    // results card would show one team's import on another's Players tab, with Open pills leading to
    // players that are not on it and an Undo with nothing to find.
    resetOnTeamChange(() => {
      this.rows.set([]);
      this.createdIds.set([]);
    });
  }

  /**
   * What a paste would do, against the roster as it is now, or against `existing` when given:
   * Admin › Teams previews a paste for a team that does not exist yet against an empty roster
   * (27 Sep 2026, Stage 3), since the current team's players are not the ones it would join. Only
   * the text is read.
   * Never throws: the dialog reads this from a computed on every keystroke, and a
   * computed that throws rethrows to every reader until its inputs change, so a
   * half-typed "Alpha%2" (decodeURIComponent throws a URIError on a stray percent
   * sign) would stop the paste step updating and land a browser error in Diagnostics.
   */
  preview(text: string, existing: readonly Player[] = this.data.players()): RosterImportPreview {
    try {
      const ids = parseRiotIds(text);
      return { ...planRosterImport({ ids, existing }), ids, dropped: unreadEntries(text, ids.length) };
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      return { ids: [], creates: [], skips: [], dropped: 0, refused: 'That text could not be read. Paste the op.gg link, or one Name#TAG a line.' };
    }
  }

  /**
   * Import the paste. Answers the reason when it will not (a running job, nothing
   * readable, the cap, everyone already here), and null when it ran or the
   * person cancelled the question. The question is asked only when the roster
   * already has players: adding to Bom Squad is a decision, filling an empty
   * team is the point.
   */
  async run(text: string): Promise<string | null> {
    const blocker = this.blocker();
    if (blocker) return blocker;
    let plan = this.preview(text);
    if (plan.refused) return plan.refused;
    if (!plan.creates.length) return this.allSkipped(plan.skips.length);

    const existing = this.data.players().length;
    if (existing) {
      const n = plan.creates.length;
      const skipped = plan.skips.length;
      const ok = await this.confirm.ask({
        title: `Add ${plural(n, 'player', 'players')} to the roster?`,
        body:
          `${plural(existing, 'player is', 'players are')} already here` +
          (skipped ? `; ${plural(skipped, 'in the paste is', 'in the paste are')} already on it and will be skipped` : '') +
          '.',
        confirmLabel: `Add ${plural(n, 'player', 'players')}`
      });
      if (!ok) return null;
      // The dialog does not block the page: a scout may have started, or a
      // teammate added someone, while it was open. Plan again before writing.
      const again = this.blocker();
      if (again) return again;
      plan = this.preview(text);
      if (plan.refused) return plan.refused;
      if (!plan.creates.length) return this.allSkipped(plan.skips.length);
    }

    await this.execute(plan);
    return null;
  }

  /**
   * Read one failed row from Riot again, under the same guards as a run. A row
   * whose skeleton was never written (phase 1 stopped) is written first.
   */
  async retry(row: RosterImportRow): Promise<string | null> {
    const blocker = this.blocker();
    if (blocker) return blocker;
    const key = rowKey(row.id);
    const current = this.rows().find((r) => rowKey(r.id) === key);
    if (!current || current.state !== 'failed') return null;

    const team = this.scope.activeTeamId();
    let stopped = false;
    this.importing.set(true);
    this.total.set(1);
    this.done.set(0);
    try {
      await this.activity.run('Importing roster', async (job) => {
        let target = current;
        if (!target.playerId) {
          const existing = this.data.players();
          const plan = planRosterImport({ ids: [current.id], existing });
          const create = plan.creates[0];
          if (!create) {
            this.patch(key, { state: 'skipped', reason: 'Already on the roster.', kind: undefined });
            return;
          }
          if (plan.refused) {
            this.patch(key, { reason: plan.refused, kind: 'other' });
            return;
          }
          // The planner seats a one-ID paste at Top; the row still knows the seat the
          // original paste gave it, so the skeleton takes that, and goes on the bench
          // only when the row already was, or a starter now holds the seat (the
          // planner's own rule). Without this a retried Mid laner landed at Top.
          const sub = current.sub || existing.some((p) => !p.sub && p.role === current.seat);
          const player = { ...create.player, role: current.seat };
          if (sub) player.sub = true;
          else delete player.sub;
          if (this.teamChanged(team)) {
            stopped = true;
            return;
          }
          const playerId = await this.data.createPlayer(player);
          this.createdIds.update((ids) => [...ids, playerId]);
          this.patch(key, { playerId, seat: current.seat, sub });
          target = { ...target, playerId };
        }
        const line = formatRiotId(current.id);
        this.progress.set(`Reading ${line} from Riot…`);
        job.progress(line);
        stopped = !(await this.readOne(target, team));
        if (!stopped) this.done.set(1);
      });
    } catch {
      // ActivityService.run announced it; the row keeps its state.
    } finally {
      this.clearProgress();
    }
    if (stopped) this.stoppedForTeam();
    return null;
  }

  /**
   * Take off every player this run created that is still on the roster. The
   * Undo of the finish toast, so no second question is asked (the house pattern).
   * Given the ids rather than reading them, so a toast from an earlier run never
   * undoes a later one, and the team they were created on, so an Undo pressed
   * after a switch (the toast outlives the menu) deletes nothing on the team now
   * showing: the ids are the other team's, and a delete would go under this prefix.
   */
  async undo(ids: readonly string[] = this.createdIds(), team = this.createdOn): Promise<number> {
    if (this.importing()) {
      this.toast.show('Wait for the import to finish', { kind: 'info', text: 'Undo takes the players off once it has stopped writing.' });
      return 0;
    }
    if (this.teamChanged(team)) {
      this.stoppedForTeam('the undo');
      return 0;
    }
    const present = ids.filter((id) => this.data.players().some((p) => p.id === id));
    for (const id of present) {
      if (this.teamChanged(team)) {
        this.stoppedForTeam('the undo');
        return 0;
      }
      await this.data.deletePlayer(id);
    }
    this.createdIds.update((list) => list.filter((id) => !ids.includes(id)));
    // A withdrawn row carries no playerId any more, and its player is as gone as the rest.
    this.rows.update((rows) => rows.filter((r) => !(r.playerId && ids.includes(r.playerId)) && r.state !== 'withdrawn'));
    this.toast.show(
      present.length ? `Removed ${plural(present.length, 'player', 'players')}` : 'Nothing to remove',
      present.length
        ? { kind: 'ok', icon: 'check_circle' }
        : { kind: 'info', text: 'The imported players were already taken off.' }
    );
    return present.length;
  }

  /**
   * Seat the starters where Riot sees them, when `riotSeats` allows it. Written
   * without the hand-edited stamp: the morning job keeps refreshing these players.
   */
  async reseatByRiot(): Promise<number> {
    const seats = this.riotSeats();
    if (!seats || this.importing() || !this.auth.canEdit()) return 0;
    const team = this.scope.activeTeamId();
    let moved = 0;
    for (const [playerId, role] of Object.entries(seats)) {
      const fresh = this.data.players().find((p) => p.id === playerId);
      if (!fresh || fresh.role === role) continue;
      if (this.teamChanged(team)) {
        this.stoppedForTeam("seating by Riot's roles");
        return moved;
      }
      await this.data.updatePlayer({ ...fresh, role });
      this.rows.update((rows) => rows.map((r) => (r.playerId === playerId ? { ...r, seat: role, suggestion: undefined } : r)));
      moved += 1;
    }
    this.toast.show(
      moved ? `Seated ${plural(moved, 'player', 'players')} by Riot's roles` : 'Everyone is already in the seat Riot sees them in',
      { kind: 'ok', icon: 'check_circle' }
    );
    return moved;
  }

  /** Whether Riot can be asked at all. Behind a method so a spec can stand in for it (the AuthService pattern). */
  protected riotReachable(): boolean {
    return isFirebaseConfigured();
  }

  private allSkipped(skipped: number): string {
    return skipped === 1
      ? 'That player is already on the roster; nothing to add.'
      : `All ${skipped} are already on the roster; nothing to add.`;
  }

  private async execute(plan: RosterImportPreview): Promise<void> {
    const session = this.auth.userEmail();
    // The team this run writes to, captured once: every write below checks the scope is still on it.
    const team = this.scope.activeTeamId();
    this.rows.set(rowsFor(plan, this.data.players()));
    this.createdIds.set([]);
    this.createdOn = team;
    this.importing.set(true);
    this.total.set(plan.creates.length);
    this.done.set(0);
    let stopped = false;
    try {
      // No `notify` here: the finish toast below is the one notice for this run,
      // with the count and the Undo pill, and two toasts for one event is noise.
      await this.activity.run('Importing roster', async (job) => {
        if (!(await this.createSkeletons(plan, session, team))) {
          stopped = true;
          return;
        }
        if (!(await this.readAll(job, session, team))) stopped = true;
      });
    } catch (error) {
      // ActivityService.run announced it. Every row still waiting fails, with Retry on
      // it: one whose skeleton never landed says so, and one written before the stop
      // was never read, since phase 2 did not run. Left 'pending' it would read
      // "Waiting" for ever with no Retry, and only the morning job would fill it.
      const message = error instanceof Error ? error.message : 'The write failed.';
      this.rows.update((rows) =>
        rows.map((r) => {
          if (r.state !== 'pending') return r;
          return r.playerId
            ? { ...r, state: 'failed', kind: 'other', reason: 'Not read: the import stopped before Riot was asked. Retry reads them.' }
            : { ...r, state: 'failed', kind: 'other', reason: `Not added: ${message}` };
        })
      );
    } finally {
      this.clearProgress();
    }
    if (stopped) {
      // The rows went with the team (the reset in the constructor); the notice is what is left to say.
      this.stoppedForTeam();
      return;
    }
    if (this.auth.userEmail() === session) this.report(team);
  }

  /**
   * Phase 1: every skeleton, in paste order, so the roster is on screen at once. False when the team
   * changed under it, with nothing more written.
   */
  private async createSkeletons(plan: RosterImportPlan, session: string | null, team: string): Promise<boolean> {
    for (const create of plan.creates) {
      if (this.auth.userEmail() !== session) return true;
      if (this.teamChanged(team)) return false;
      const playerId = await this.data.createPlayer(create.player);
      this.createdIds.update((ids) => [...ids, playerId]);
      this.patch(rowKey(create.id), { playerId });
    }
    return true;
  }

  /** Phase 2: one at a time, the scout's queue. False when the team changed under it. */
  private async readAll(job: ActivityHandle, session: string | null, team: string): Promise<boolean> {
    const queue = this.rows().filter((r) => r.state === 'pending' && r.playerId);
    for (const [index, row] of queue.entries()) {
      if (this.auth.userEmail() !== session) return true;
      if (this.teamChanged(team)) return false;
      const line = `${formatRiotId(row.id)} (${index + 1} of ${queue.length})`;
      this.progress.set(`Reading ${line} from Riot…`);
      job.progress(line);
      if (!(await this.readOne(row, team))) return false;
      this.done.update((n) => n + 1);
    }
    return true;
  }

  /**
   * One player from Riot, written on their own document. A failure stays on
   * the row rather than failing the batch: four of five read is worth having.
   * Answers false only when the team changed while Riot was being read, in
   * which case nothing is written: the read is thrown away rather than landed
   * on whichever team is active now.
   */
  private async readOne(row: RosterImportRow, team: string): Promise<boolean> {
    const key = rowKey(row.id);
    const playerId = row.playerId;
    if (!playerId) return true;
    this.patch(key, { state: 'reading', reason: undefined, kind: undefined });

    if (!this.riotReachable()) {
      // Local preview: the skeleton is there, and saying why it stays empty beats a template.
      const local = failureReason('built-in-role-template');
      this.patch(key, { state: 'failed', kind: local.kind, reason: local.text });
      return true;
    }

    try {
      const before = this.data.players().find((p) => p.id === playerId);
      if (!before) {
        this.patch(key, { state: 'withdrawn', playerId: undefined, reason: 'Taken off the roster before Riot was read.' });
        return true;
      }
      // The same body the roster refresh sends, so nothing new is asked of Riot.
      const enriched = await this.enrichment.enrichPlayer({
        summonerName: before.name,
        riotTag: before.profile?.riotTag,
        region: before.profile?.region,
        role: before.role,
        mobalyticsSlug: before.profile?.mobalyticsSlug
      });
      // A minute passed. The team first: `players()` is now the other team's roster, and a write would be too.
      if (this.teamChanged(team)) {
        this.patch(key, { state: 'failed', kind: 'other', reason: 'Not written: the team changed while Riot was being read.' });
        return false;
      }
      // Re-read: updatePlayer writes the whole document.
      const fresh = this.data.players().find((p) => p.id === playerId);
      if (!fresh) {
        this.patch(key, { state: 'withdrawn', playerId: undefined, reason: 'Taken off the roster while Riot was being read.' });
        return true;
      }

      if (enriched.source === 'provider') {
        const starter = !fresh.sub;
        const written = applyEnrichment(fresh, enriched, new Date().toISOString(), { starter });
        await this.data.updatePlayer(written);
        // The seat stays for a starter, and for anyone hand-edited during the read
        // (applyEnrichment keeps a curated player's seat and text); Riot's seat is
        // then a suggestion on the row, never a write.
        const keepsSeat = starter || !!fresh.curated;
        this.patch(key, {
          state: 'done',
          seat: written.role,
          sub: !!written.sub,
          suggestion: keepsSeat ? (seatSuggestion(fresh, enriched) ?? undefined) : undefined
        });
        return true;
      }

      const failure = failureReason(enriched.provider);
      if (failure.kind === 'unknown-id') {
        // One unresolvable Riot ID fails the whole team's analysis (resolveRoster's
        // Promise.all in the functions), so the skeleton goes rather than sit there.
        await this.data.deletePlayer(playerId);
        this.patch(key, {
          state: 'withdrawn',
          playerId: undefined,
          kind: failure.kind,
          reason: `Riot doesn't know ${formatRiotId(row.id)}. Check the tag and paste them again.`
        });
        return true;
      }
      this.patch(key, { state: 'failed', kind: failure.kind, reason: failure.text });
    } catch (error) {
      this.patch(key, { state: 'failed', kind: 'other', reason: error instanceof Error ? error.message : 'Riot could not be read.' });
    }
    return true;
  }

  /** True once the scope has left the team a run started on; every write asks first. */
  private teamChanged(team: string): boolean {
    return this.scope.activeTeamId() !== team;
  }

  /** The one notice for a run the team moved under. */
  private stoppedForTeam(job = 'the roster import'): void {
    const notice = teamChangedNotice(job);
    this.toast.show(notice.title, { kind: 'warn', icon: 'warning', text: notice.text, timeout: 10000 });
  }

  /** The one notice for the run: what landed, what did not, and Undo while it still makes sense, on the team it ran on. */
  private report(team: string): void {
    const rows = this.rows();
    const kept = this.createdIds().filter((id) => this.data.players().some((p) => p.id === id));
    const failed = rows.filter((r) => r.state === 'failed');
    const withdrawn = rows.filter((r) => r.state === 'withdrawn').length;
    const notes: string[] = [];
    const notAdded = failed.filter((r) => !r.playerId).length;
    const unread = failed.length - notAdded;
    if (notAdded) notes.push(`${plural(notAdded, 'player was', 'players were')} not added; Retry is on the row.`);
    if (unread && failed.every((r) => r.kind === 'local')) {
      notes.push('Local preview has no Riot access; the profiles stay empty.');
    } else if (unread) {
      notes.push(`${plural(unread, 'player', 'players')} could not be read from Riot; Retry is on the row.`);
    }
    if (withdrawn) notes.push(`${plural(withdrawn, 'Riot ID', 'Riot IDs')} Riot does not know, taken off again.`);

    if (!kept.length) {
      this.toast.show('Nothing was imported', { kind: 'warn', icon: 'warning', text: notes.join(' ') || undefined, timeout: 10000 });
      return;
    }
    const ids = [...kept];
    const trouble = failed.length > 0 || withdrawn > 0;
    this.toast.show(`Imported ${plural(kept.length, 'player', 'players')}`, {
      kind: trouble ? 'warn' : 'ok',
      icon: trouble ? 'warning' : 'check_circle',
      text: notes.join(' ') || undefined,
      timeout: UNDO_WINDOW_MS,
      action: { label: 'Undo', run: () => void this.undo(ids, team) }
    });
  }

  private patch(key: string, changes: Partial<RosterImportRow>): void {
    this.rows.update((rows) => rows.map((r) => (rowKey(r.id) === key ? { ...r, ...changes } : r)));
  }

  private clearProgress(): void {
    this.importing.set(false);
    this.progress.set('');
    this.done.set(0);
    this.total.set(0);
  }
}

/**
 * The rows of a plan, in paste order: a create is pending, a skip is skipped and
 * shows the seat of the player already here (matched as the planner matches:
 * name#tag, or the name alone when the stored player has no tag).
 */
function rowsFor(plan: RosterImportPreview, existing: readonly Player[]): RosterImportRow[] {
  const creates = new Map(plan.creates.map((c) => [rowKey(c.id), c]));
  const onRoster = (id: RiotId) =>
    existing.find((p) => {
      const tag = p.profile?.riotTag?.trim();
      return tag ? `${p.name.trim()}#${tag}`.toLowerCase() === rowKey(id) : p.name.trim().toLowerCase() === id.name.trim().toLowerCase();
    });
  return plan.ids.map((id) => {
    const create = creates.get(rowKey(id));
    if (create) return { id, seat: create.player.role, sub: !!create.player.sub, state: 'pending' };
    const here = onRoster(id);
    return { id, seat: here?.role ?? 'Top', sub: !!here?.sub, state: 'skipped', reason: 'Already on the roster.' };
  });
}
