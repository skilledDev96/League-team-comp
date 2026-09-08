import { inject, Injectable, signal } from '@angular/core';
import { Player, Role } from '../models/team.models';
import { newUid, PlayerDraft, slugifyName, splitList, toPlayerDraft } from '../pages/admin/admin-drafts';
import { PlayerEnrichmentService } from './player-enrichment.service';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

/**
 * One editor for a player, wherever it is opened from.
 *
 * A player used to be edited on four screens with different labels for the
 * same flags (8 Sep 2026): identity and pool in Admin, the bench and second
 * seats on the roster cards, the pool again on the scouting view, the Riot
 * refresh on the profile. This holds the one save path — the draft shape,
 * the autosave, the Riot refresh, the hand-edited stamp — and Admin's panel,
 * the drawer on the profile and the toggles on the cards all go through it.
 */
@Injectable({ providedIn: 'root' })
export class PlayerEditorService {
  private readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly toast = inject(ToastService);

  /** The player open in the drawer, as a draft; null when the drawer is closed. */
  readonly drawerDraft = signal<PlayerDraft | null>(null);
  /** Which player is being refreshed from Riot right now, by draft key. */
  readonly enrichingKey = signal<string | null>(null);

  // ---- The drawer ---------------------------------------------------------

  open(playerId: string): void {
    const player = this.data.players().find((p) => p.id === playerId);
    if (!player) return;
    this.drawerDraft.set(toPlayerDraft(player));
  }

  close(): void {
    this.drawerDraft.set(null);
  }

  // ---- Draft helpers -------------------------------------------------------

  blankDraft(overrides: Partial<PlayerDraft> = {}): PlayerDraft {
    return {
      uid: newUid(),
      id: '',
      name: '',
      role: 'Top',
      secondaryRoles: [],
      sub: false,
      curated: false,
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
  }

  listOf(value: string): string[] {
    return splitList(value);
  }

  toggleSecondaryRole(draft: PlayerDraft, role: Role): void {
    draft.secondaryRoles = draft.secondaryRoles.includes(role)
      ? draft.secondaryRoles.filter((r) => r !== role)
      : [...draft.secondaryRoles, role];
  }

  enrichmentKey(draft: PlayerDraft): string {
    const name = draft.name.trim().toLowerCase();
    return draft.id || (name ? `new-${name}` : `new-${draft.uid}`);
  }

  autoFillSlugs(draft: PlayerDraft): void {
    const baseName = slugifyName(draft.name);
    const tag = draft.riotTag.trim();
    if (!baseName) return;
    if (!draft.opggSlug.trim()) draft.opggSlug = tag ? `${draft.name.trim()}-${tag}` : draft.name.trim();
    if (!draft.mobalyticsSlug.trim()) draft.mobalyticsSlug = tag ? `${baseName}-${tag.toLowerCase()}` : baseName;
  }

  // ---- Riot ------------------------------------------------------------------

  /** Re-read the player from Riot into the draft. Returns the line to show. */
  async refreshFromRiot(draft: PlayerDraft): Promise<string> {
    const playerName = draft.name.trim();
    if (!playerName) return 'Add a player name first.';
    this.autoFillSlugs(draft);
    const key = this.enrichmentKey(draft);
    if (this.enrichingKey() === key) return '';
    this.enrichingKey.set(key);
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
      if (enriched.role) draft.role = enriched.role;
      if (enriched.top3?.length) draft.top3 = this.enrichment.mergeChampionPool(splitList(draft.top3), enriched.top3).join(', ');
      if (enriched.bans?.length) draft.bans = enriched.bans.join(', ');
      if (enriched.iconUrl) draft.icon = enriched.iconUrl;
      draft.queueStats = enriched.queueStats;
      return enriched.source === 'provider'
        ? `Profile filled from ${enriched.provider}.`
        : `Couldn't fetch live Riot data: ${enriched.provider.replace(/^template-fallback:\s*/, '')}`;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to read the player from Riot.';
    } finally {
      this.enrichingKey.set(null);
    }
  }

  // ---- Saving ----------------------------------------------------------------

  private readonly autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Save a moment after the last change. Existing players only: a new one
   * has no name yet and is committed by its own Add step. One timer per
   * draft, so typing in two panels cannot save the wrong one.
   */
  autosave(draft: PlayerDraft): void {
    if (!draft.id) return;
    const pending = this.autosaveTimers.get(draft.uid);
    if (pending) clearTimeout(pending);
    this.autosaveTimers.set(
      draft.uid,
      setTimeout(() => {
        this.autosaveTimers.delete(draft.uid);
        void this.save(draft, { quiet: true });
      }, 900)
    );
  }

  /** Writes the draft. Returns the line to show, or '' when nothing needs saying. */
  async save(draft: PlayerDraft, options: { quiet?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
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
      sub: draft.sub || undefined,
      // Saved by hand: the refresh keeps this player's text, pool and bans.
      curated: true,
      icon: draft.icon.trim() || undefined,
      playstyle: draft.playstyle.trim() || undefined,
      strengths: splitList(draft.strengths),
      weaknesses: splitList(draft.weaknesses),
      top3: splitList(draft.top3),
      bans: splitList(draft.bans),
      queueStats: draft.queueStats,
      profile
    };
    if (!base.name) return { ok: false, message: 'Player name is required.' };
    if (draft.id) {
      const existing = this.data.players().find((p) => p.id === draft.id);
      // The save replaces the document, so carry the refresh stamp across.
      await this.data.updatePlayer({ ...base, id: draft.id, order: existing?.order ?? 0, refreshedAt: existing?.refreshedAt });
      this.handEditedToast(existing, base.name);
      draft.curated = true;
    } else {
      await this.data.createPlayer(base);
    }
    return { ok: true, message: options.quiet ? `Saved ${base.name}` : `Saved ${base.name}.` };
  }

  /**
   * A one-field change from a toggle on a card or a table: the bench flag,
   * a second seat. Same stamp, same toast, no draft.
   */
  async patch(player: Player, patch: Partial<Player>): Promise<void> {
    await this.data.updatePlayer({ ...player, ...patch, curated: true });
    this.handEditedToast(player, player.name);
  }

  /** Say so the moment a player becomes hand-edited, because it changes what the morning refresh does. */
  private handEditedToast(before: Player | undefined, name: string): void {
    if (before?.curated) return;
    this.toast.show(`${name} is now hand-edited`, {
      text: 'The morning refresh keeps this player’s text, pool and bans from now on. “Refresh this player from Riot” pulls Riot’s again.',
      kind: 'info',
      timeout: 7000
    });
  }
}
