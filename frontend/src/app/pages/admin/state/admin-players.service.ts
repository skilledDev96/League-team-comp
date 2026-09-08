import { computed, inject, Injectable, signal } from '@angular/core';
import { Player, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { PlayerEditorService } from '../../../services/player-editor.service';
import { TeamDataService } from '../../../services/team-data.service';
import { PlayerDraft, toPlayerDraft } from '../admin-drafts';
import { AdminShellService } from './admin-shell.service';

/**
 * The player editor's Admin side: the roster drafts, the add-player dialog
 * and the delete. The form, the autosave and the Riot refresh live in
 * `PlayerEditorService`, shared with the drawer on the profile and the
 * roster cards (8 Sep 2026), so a player is edited the same way everywhere.
 */
@Injectable()
export class AdminPlayersService {
  private readonly data = inject(TeamDataService);
  private readonly auth = inject(AuthService);
  private readonly editor = inject(PlayerEditorService);
  private readonly shell = inject(AdminShellService);

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
  readonly addPlayerMode = signal<'choose' | 'summoner'>('choose');
  readonly newPlayerSummoner = signal('');
  readonly newPlayerTag = signal('EUW');
  readonly newPlayerRegion = signal('euw');

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
    if (!confirm(`Delete player ${draft.name}?`)) {
      return;
    }
    await this.data.deletePlayer(draft.id);
    this.playerDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.name}.`);
  }
}
