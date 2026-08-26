import { computed, inject, Injectable, signal } from '@angular/core';
import { Player, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { PlayerEnrichmentService } from '../../../services/player-enrichment.service';
import { TeamDataService } from '../../../services/team-data.service';
import { newUid, PlayerDraft, slugifyName, splitList, toPlayerDraft } from '../admin-drafts';
import { AdminShellService } from './admin-shell.service';

/**
 * The player editor: the roster drafts, the add-player dialog, and the Riot
 * autofill that populates a profile from a summoner name.
 *
 * Much the largest of the admin editors, and the only one with a dialog and a
 * remote call of its own, so it lives apart from the rest.
 */
@Injectable()
export class AdminPlayersService {
  private readonly data = inject(TeamDataService);
  private readonly auth = inject(AuthService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly shell = inject(AdminShellService);

  private readonly roles = ROLES;

  private flash(message: string): void {
    this.shell.flash(message);
  }

  readonly playerDrafts = signal<PlayerDraft[]>([]);

  /** Called by the context when Firestore first reports the roster. */
  load(players: Player[]): void {
    this.playerDrafts.set(players.map((p) => toPlayerDraft(p)));
  }

  readonly enrichingPlayerId = signal<string | null>(null);

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
    draft.secondaryRoles = draft.secondaryRoles.includes(role)
      ? draft.secondaryRoles.filter((r) => r !== role)
      : [...draft.secondaryRoles, role];
  }

  isPlayerHighlighted(draft: PlayerDraft): boolean {
    return this.highlightedPlayer() === draft;
  }

  autoFillPlayerSlugs(draft: PlayerDraft): void {
    const baseName = slugifyName(draft.name);
    const tag = draft.riotTag.trim();
    const normalizedTag = tag ? tag.toLowerCase() : '';

    if (!baseName) {
      return;
    }

    if (!draft.opggSlug.trim()) {
      draft.opggSlug = tag ? `${draft.name.trim()}-${tag}` : draft.name.trim();
    }

    if (!draft.mobalyticsSlug.trim()) {
      draft.mobalyticsSlug = normalizedTag ? `${baseName}-${normalizedTag}` : baseName;
    }
  }

  enrichmentKey(draft: PlayerDraft): string {
    const name = draft.name.trim().toLowerCase();
    return draft.id || (name ? `new-${name}` : `new-${this.playerDrafts().indexOf(draft)}`);
  }

  async autoFillPlayerInsights(draft: PlayerDraft): Promise<void> {
    const playerName = draft.name.trim();
    if (!playerName) {
      this.flash('Add a player name first.');
      return;
    }

    this.autoFillPlayerSlugs(draft);

    const loadingKey = this.enrichmentKey(draft);
    if (this.enrichingPlayerId() === loadingKey) {
      return;
    }
    this.enrichingPlayerId.set(loadingKey);
    try {
      const enriched = await this.enrichment.enrichPlayer({
        summonerName: playerName,
        riotTag: draft.riotTag,
        region: draft.region,
        role: draft.role,
        mobalyticsSlug: draft.mobalyticsSlug
      });

      draft.playstyle = enriched.playstyle;
      draft.strengths = enriched.strengths.join(', ');
      draft.weaknesses = enriched.weaknesses.join(', ');
      if (enriched.role) {
        draft.role = enriched.role;
      }
      if (enriched.top3?.length) {
        draft.top3 = this.enrichment.mergeChampionPool(splitList(draft.top3), enriched.top3).join(', ');
      }
      if (enriched.bans?.length) {
        draft.bans = enriched.bans.join(', ');
      }
      if (enriched.iconUrl) {
        draft.icon = enriched.iconUrl;
      }
      draft.queueStats = enriched.queueStats;
      this.flash(enriched.source === 'provider'
        ? `Profile filled from ${enriched.provider}.`
        : `Couldn't fetch live Riot data: ${enriched.provider.replace(/^template-fallback:\s*/, '')}`);
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Failed to enrich profile.');
    } finally {
      this.enrichingPlayerId.set(null);
    }
  }

  // ---- Players ----------------------------------------------------------


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
    const draft: PlayerDraft = {
      uid: newUid(),
      id: '',
      name: '',
      role: 'Top',
      secondaryRoles: [],
      icon: '',
      playstyle: '',
      strengths: '',
      weaknesses: '',
      top3: '',
      bans: '',
      region: 'euw',
      opggSlug: '',
      riotTag: 'EUW',
      mobalyticsSlug: '',
      ...overrides
    };
    this.playerDrafts.update((list) => [...list, draft]);
    this.openPlayer.set(draft);
    this.shell.scrollToCard(`player-${draft.uid}`);
    return draft;
  }


  async savePlayer(draft: PlayerDraft): Promise<void> {
    const profile = {
      region: draft.region.trim() || 'euw',
      opggSlug: draft.opggSlug.trim(),
      riotTag: draft.riotTag.trim(),
      mobalyticsSlug: draft.mobalyticsSlug.trim()
    };
    const secondaryRoles = draft.secondaryRoles.filter((r) => r !== draft.role);
    const base = {
      name: draft.name.trim(),
      role: draft.role,
      secondaryRoles: secondaryRoles.length ? secondaryRoles : undefined,
      icon: draft.icon.trim() || undefined,
      playstyle: draft.playstyle.trim() || undefined,
      strengths: splitList(draft.strengths),
      weaknesses: splitList(draft.weaknesses),
      top3: splitList(draft.top3),
      bans: splitList(draft.bans),
      queueStats: draft.queueStats,
      profile
    };
    if (!base.name) {
      this.flash('Player name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.players().find((p) => p.id === draft.id);
      await this.data.updatePlayer({ ...base, id: draft.id, order: existing?.order ?? 0 });
    } else {
      await this.data.createPlayer(base);
      this.shell.requestResync();
    }
    this.flash(`Saved ${base.name}.`);
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
