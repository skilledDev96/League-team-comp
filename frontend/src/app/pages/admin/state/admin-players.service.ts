import { computed, inject, Injectable, signal } from '@angular/core';
import { formatRiotId } from '../../../core/riot-id';
import { Player, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { OpponentScoutService } from '../../../services/opponent-scout.service';
import { PlayerEditorService } from '../../../services/player-editor.service';
import { RosterImportPreview, RosterImportRow, RosterImportService } from '../../../services/roster-import.service';
import { TeamDataService } from '../../../services/team-data.service';
import { PlayerDraft, toPlayerDraft } from '../admin-drafts';
import { AdminShellService } from './admin-shell.service';
import { ConfirmService } from '../../../services/confirm.service';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The line under the paste box: what the paste would do, before anything is
 * written. "5 players read: Alpha#EUW to Top, …; 2 already on the roster;
 * 1 line skipped, no tag or a repeat." Empty when nothing parsed, since the
 * planner's refusal says that on its own line.
 */
export function importPreviewLine(preview: RosterImportPreview): string {
  if (!preview.ids.length) return '';
  const parts: string[] = [];
  if (preview.creates.length) {
    const seats = preview.creates.map((c) => `${formatRiotId(c.id)} to ${c.player.role}${c.player.sub ? ' (sub)' : ''}`);
    parts.push(`${plural(preview.creates.length, 'player', 'players')} read: ${seats.join(', ')}`);
  } else {
    parts.push('Nothing new to add');
  }
  if (preview.skips.length) parts.push(`${preview.skips.length} already on the roster`);
  if (preview.dropped) parts.push(`${plural(preview.dropped, 'line', 'lines')} skipped, no tag or a repeat`);
  return `${parts.join('; ')}.`;
}

/** The Import pill's label: the count it would add, or plain "Import players" while there is nothing to count. */
export function importLabel(preview: RosterImportPreview): string {
  return preview.creates.length ? `Import ${plural(preview.creates.length, 'player', 'players')}` : 'Import players';
}

/**
 * Why "Seat by Riot's roles" is off, or null when the service allows it: the
 * pill only makes sense once all five starters came from this import and Riot
 * put them in five different seats, and a disabled pill with no reason is a
 * mechanism that silently does nothing.
 */
export function reseatReason(rows: readonly RosterImportRow[], importing: boolean, allowed: boolean): string | null {
  if (allowed) return null;
  if (importing) return 'Wait for the import to finish.';
  const starters = rows.filter((r) => !r.sub && r.state !== 'skipped');
  if (starters.some((r) => r.state === 'failed' || r.state === 'pending' || r.state === 'reading')) {
    return 'Every starter has to be read from Riot first; Retry is on the row.';
  }
  if (starters.filter((r) => r.state === 'done').length !== 5) {
    return 'Only when all five starters came from this import and were read from Riot.';
  }
  return 'Riot sees two of them in the same seat, so there is no seating to copy.';
}

/**
 * The player editor's Admin side: the roster drafts, the add-player dialog
 * and the delete. The form, the autosave and the Riot refresh live in
 * `PlayerEditorService`, shared with the drawer on the profile and the
 * roster cards (8 Sep 2026), so a player is edited the same way everywhere.
 *
 * The third way to add (27 Sep 2026): paste the team's op.gg multi-link and
 * `RosterImportService` writes them all. Only the paste is read here; the
 * preview under the box is the planner's answer, and the import itself runs
 * in the root service so it survives leaving the page.
 */
@Injectable()
export class AdminPlayersService {
  private readonly data = inject(TeamDataService);
  private readonly confirm = inject(ConfirmService);
  private readonly auth = inject(AuthService);
  private readonly editor = inject(PlayerEditorService);
  private readonly shell = inject(AdminShellService);
  private readonly scout = inject(OpponentScoutService);
  /** Public: the tab reads its progress, rows and blocker straight off the service. */
  readonly importer = inject(RosterImportService);

  private flash(message: string): void {
    this.shell.flash(message);
  }

  readonly playerDrafts = signal<PlayerDraft[]>([]);

  /** Called by the context when Firestore first reports the roster. */
  load(players: Player[]): void {
    this.playerDrafts.set(players.map((p) => toPlayerDraft(p)));
  }

  /**
   * Called on every later roster change. Panels that are closed take the
   * server's version; the one being edited keeps its edits. Loading once and
   * never again meant a save from another tab, another device or the morning
   * job stayed invisible here until a reload — and a stale panel saved over
   * it, which read as "the champions are not saving" (5 Sep 2026).
   */
  follow(players: Player[]): void {
    const open = this.openPlayer();
    this.playerDrafts.update((list) => {
      const current = new Map(list.map((d) => [d.id, d] as const));
      const synced = players.map((p) => {
        const mine = current.get(p.id);
        if (mine && open && mine.uid === open.uid) return mine;
        const fresh = toPlayerDraft(p);
        return mine ? { ...fresh, uid: mine.uid } : fresh;
      });
      // Unsaved new players have no id yet; keep them where they are.
      return [...synced, ...list.filter((d) => !d.id)];
    });
  }

  readonly enrichingPlayerId = this.editor.enrichingKey;

  readonly openPlayer = signal<PlayerDraft | null>(null);
  readonly highlightedPlayer = signal<PlayerDraft | null>(null);

  // Group player drafts by role for the editor (Top, Jungle, Mid, ADC, Support).
  readonly playersByRole = computed(() => {
    const drafts = this.playerDrafts();
    return ROLES.map((role) => ({ role, drafts: drafts.filter((d) => d.role === role) })).filter(
      (group) => group.drafts.length > 0
    );
  });

  readonly showAddPlayerDialog = signal(false);
  readonly addPlayerMode = signal<'choose' | 'summoner' | 'link'>('choose');
  readonly newPlayerSummoner = signal('');
  readonly newPlayerTag = signal('EUW');
  readonly newPlayerRegion = signal('euw');

  // ---- The op.gg multi-link import ---------------------------------------

  /** The paste. Kept across a cancelled question, so nobody pastes twice. */
  readonly importPaste = signal('');
  /** What the paste would do against the roster as it is now; reactive to both. */
  readonly importPreview = computed(() => this.importer.preview(this.importPaste()));
  readonly importLine = computed(() => importPreviewLine(this.importPreview()));
  readonly importLabel = computed(() => importLabel(this.importPreview()));
  readonly reseatReason = computed(() => reseatReason(this.importer.rows(), this.importer.importing(), this.importer.riotSeats() !== null));
  /** The self-scout runs under the id the Roster's report uses. */
  readonly scoutBusy = computed(() => this.scout.scouting() === 'us');

  isPlayerOpen(draft: PlayerDraft): boolean {
    return this.openPlayer() === draft;
  }

  togglePlayer(draft: PlayerDraft): void {
    this.openPlayer.set(this.openPlayer() === draft ? null : draft);
  }

  toggleSecondaryRole(draft: PlayerDraft, role: Role): void {
    this.editor.toggleSecondaryRole(draft, role);
  }

  isPlayerHighlighted(draft: PlayerDraft): boolean {
    return this.highlightedPlayer() === draft;
  }

  autoFillPlayerSlugs(draft: PlayerDraft): void {
    this.editor.autoFillSlugs(draft);
  }

  enrichmentKey(draft: PlayerDraft): string {
    return this.editor.enrichmentKey(draft);
  }

  async autoFillPlayerInsights(draft: PlayerDraft): Promise<void> {
    const message = await this.editor.refreshFromRiot(draft);
    if (message) this.flash(message);
  }

  // ---- Adding ------------------------------------------------------------

  openAddPlayerDialog(): void {
    this.addPlayerMode.set('choose');
    this.newPlayerSummoner.set('');
    this.newPlayerTag.set('EUW');
    this.newPlayerRegion.set('euw');
    this.showAddPlayerDialog.set(true);
  }

  closeAddPlayerDialog(): void {
    this.showAddPlayerDialog.set(false);
  }

  chooseAutofillAdd(): void {
    this.addPlayerMode.set('summoner');
  }

  chooseLinkAdd(): void {
    this.addPlayerMode.set('link');
  }

  /** The deep link from the Roster's empty poster (`/admin?tab=players&import=1`): straight to the paste. */
  openImport(): void {
    this.shell.activeTab.set('players');
    this.addPlayerMode.set('link');
    this.showAddPlayerDialog.set(true);
  }

  /**
   * Hand the paste to the importer. The dialog closes first: the importer asks
   * its own question through ConfirmService when the roster is not empty, and
   * two modals at once is one too many. A refusal (a running job, nothing
   * readable, the cap, everyone already here) goes on the status line.
   */
  async startImport(): Promise<void> {
    const text = this.importPaste();
    this.showAddPlayerDialog.set(false);
    const before = this.importer.createdIds();
    const reason = await this.importer.run(text);
    if (reason) {
      this.flash(reason);
      return;
    }
    // A run that started replaces createdIds; a cancelled question leaves it, and the paste, alone.
    if (this.importer.createdIds() !== before) {
      this.importPaste.set('');
      this.shell.requestResync();
    }
  }

  async retryImport(row: RosterImportRow): Promise<void> {
    const reason = await this.importer.retry(row);
    if (reason) this.flash(reason);
  }

  /**
   * The Open pill on a result row: the player's panel, opened and lit the way a deep link lights it.
   * The results card shows on Admin › Teams too (27 Sep 2026, Stage 3), so the Players tab is opened
   * first; on Players that is where it already is.
   */
  openImported(row: RosterImportRow): void {
    const draft = row.playerId ? this.playerDrafts().find((d) => d.id === row.playerId) : undefined;
    if (!draft) {
      this.flash('That player is not on the roster any more.');
      return;
    }
    this.shell.activeTab.set('players');
    this.openPlayer.set(draft);
    this.highlightedPlayer.set(draft);
    setTimeout(() => this.highlightedPlayer.set(null), 2400);
    this.shell.scrollToCard(`player-${draft.uid}`);
  }

  async reseatByRiot(): Promise<void> {
    await this.importer.reseatByRiot();
  }

  /** The same call as the Roster report's "Scout us from Riot" button. */
  async scoutUs(): Promise<void> {
    await this.scout.scoutOurselves(this.data.players(), this.data.settings().teamName || 'us');
  }

  addPlayerManually(): void {
    this.showAddPlayerDialog.set(false);
    this.insertPlayerDraft({});
  }

  async confirmAutofillAdd(): Promise<void> {
    const summonerName = this.newPlayerSummoner().trim();
    if (!summonerName) {
      this.flash('Enter a summoner name to autofill.');
      return;
    }
    const riotTag = this.newPlayerTag().trim() || 'EUW';
    const region = this.newPlayerRegion().trim() || 'euw';

    this.showAddPlayerDialog.set(false);
    const draft = this.insertPlayerDraft({ name: summonerName, riotTag, region });
    await this.autoFillPlayerInsights(draft);
  }

  private insertPlayerDraft(overrides: Partial<PlayerDraft>): PlayerDraft {
    this.shell.activeTab.set('players');
    const draft = this.editor.blankDraft(overrides);
    this.playerDrafts.update((list) => [...list, draft]);
    this.openPlayer.set(draft);
    this.shell.scrollToCard(`player-${draft.uid}`);
    return draft;
  }

  // ---- Saving and deleting ---------------------------------------------

  autosave(draft: PlayerDraft): void {
    this.editor.autosave(draft);
  }

  async savePlayer(draft: PlayerDraft): Promise<void> {
    const wasNew = !draft.id;
    const result = await this.editor.save(draft);
    this.flash(result.message);
    if (result.ok && wasNew) this.shell.requestResync();
  }

  async deletePlayer(draft: PlayerDraft): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can delete players.');
      return;
    }
    if (!draft.id) {
      this.playerDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!(await this.confirm.ask({ title: `Delete player ${draft.name}?`, confirmLabel: 'Delete player', danger: true }))) {
      return;
    }
    await this.data.deletePlayer(draft.id);
    this.playerDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.name}.`);
  }
}
