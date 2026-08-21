import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Comp, CompPicks, FillIn, Player, ROLES, Role, AccessRole, AccessEntry } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

interface PlayerDraft {
  uid: string;
  id: string;
  name: string;
  role: Role;
  icon: string;
  playstyle: string;
  strengths: string;
  weaknesses: string;
  top3: string;
  bans: string;
  region: string;
  opggSlug: string;
  riotTag: string;
  mobalyticsSlug: string;
  queueStats?: Player['queueStats'];
}

interface FillInDraft {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string;
  note: string;
  icon: string;
  region: string;
  mobalyticsSlug: string;
}

interface CompDraft {
  id: string;
  name: string;
  picks: CompPicks;
}

interface AccessDraft {
  email: string;
  role: AccessRole;
  active: boolean;
}

type EditorTab = 'settings' | 'players' | 'fillins' | 'comps' | 'access';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeEmailValue(value: string): string {
  return value.trim().toLowerCase();
}

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function emptyPicks(): CompPicks {
  return { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };
}

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, PlayerAvatarComponent, OverflowMenuComponent],
  templateUrl: './admin.component.html'
})
export class AdminComponent {
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly route = inject(ActivatedRoute);
  protected readonly roles = ROLES;
  protected readonly accessRoles: AccessRole[] = ['admin', 'contributor', 'viewer'];

  protected readonly teamName = signal('');
  protected readonly playerDrafts = signal<PlayerDraft[]>([]);
  protected readonly fillInDrafts = signal<FillInDraft[]>([]);
  protected readonly compDrafts = signal<CompDraft[]>([]);
  protected readonly accessDrafts = signal<AccessDraft[]>([]);
  protected readonly activeTab = signal<EditorTab>('players');
  protected readonly enrichingPlayerId = signal<string | null>(null);
  protected readonly status = signal('');

  // Accordion: only one player panel open at a time to reduce clutter.
  protected readonly openPlayer = signal<PlayerDraft | null>(null);
  protected readonly highlightedPlayer = signal<PlayerDraft | null>(null);

  // Group player drafts by role for the editor (Top, Jungle, Mid, ADC, Support).
  protected readonly playersByRole = computed(() => {
    const drafts = this.playerDrafts();
    return ROLES.map((role) => ({ role, drafts: drafts.filter((d) => d.role === role) })).filter(
      (group) => group.drafts.length > 0
    );
  });

  protected readonly showAddPlayerDialog = signal(false);
  protected readonly addPlayerMode = signal<'choose' | 'summoner'>('choose');
  protected readonly newPlayerSummoner = signal('');
  protected readonly newPlayerTag = signal('EUW');
  protected readonly newPlayerRegion = signal('euw');

  private initialized = false;

  constructor() {
    effect(() => {
      const players = this.data.players();
      const fillIns = this.data.fillIns();
      const comps = this.data.comps();
      const accessEntries = this.data.accessEntries();
      if (!this.data.ready() || this.initialized) {
        return;
      }
      this.initialized = true;
      this.teamName.set(this.data.settings().teamName);
      this.playerDrafts.set(players.map((p) => this.toPlayerDraft(p)));
      this.fillInDrafts.set(fillIns.map((f) => this.toFillInDraft(f)));
      this.compDrafts.set(comps.map((c) => ({ id: c.id, name: c.name, picks: { ...c.picks } })));
      this.accessDrafts.set(accessEntries.map((entry) => ({ ...entry })));
      this.applyRouteFocus();
    });

    effect(() => {
      if (!this.auth.canManageUsers() || !this.data.ready()) {
        return;
      }
      const accessEntries = this.data.accessEntries();
      if (accessEntries.length > 0 && this.accessDrafts().length === 0) {
        this.accessDrafts.set(accessEntries.map((entry) => ({ ...entry })));
      }
    });

    effect(() => {
      const canManageUsers = this.auth.canManageUsers();
      const currentTab = this.activeTab();
      if (!canManageUsers && (currentTab === 'settings' || currentTab === 'access')) {
        this.activeTab.set('players');
      }
    });
  }

  private toPlayerDraft(p: Player): PlayerDraft {
    return {
      uid: this.newUid(),
      id: p.id,
      name: p.name,
      role: p.role,
      icon: p.icon ?? '',
      playstyle: p.playstyle ?? '',
      strengths: p.strengths.join(', '),
      weaknesses: p.weaknesses.join(', '),
      top3: p.top3.join(', '),
      bans: p.bans.join(', '),
      region: p.profile?.region ?? 'euw',
      opggSlug: p.profile?.opggSlug ?? '',
      riotTag: p.profile?.riotTag ?? '',
      mobalyticsSlug: p.profile?.mobalyticsSlug ?? '',
      queueStats: p.queueStats
    };
  }

  private newUid(): string {
    return (crypto as Crypto).randomUUID?.() ?? `uid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private toFillInDraft(f: FillIn): FillInDraft {
    return {
      id: f.id,
      summoner: f.summoner,
      status: f.status,
      preferredRoles: f.preferredRoles.join(', '),
      note: f.note ?? '',
      icon: f.icon ?? '',
      region: f.profile?.region ?? 'euw',
      mobalyticsSlug: f.profile?.mobalyticsSlug ?? ''
    };
  }

  private flash(message: string): void {
    this.status.set(message);
    setTimeout(() => this.status.set(''), 2500);
  }

  // ---- Settings ---------------------------------------------------------

  protected openTab(tab: EditorTab): void {
    if (!this.auth.canManageUsers() && (tab === 'settings' || tab === 'access')) {
      this.activeTab.set('players');
      return;
    }
    this.activeTab.set(tab);
  }

  private scrollToCard(id: string): void {
    setTimeout(() => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  protected isPlayerOpen(draft: PlayerDraft): boolean {
    return this.openPlayer() === draft;
  }

  protected togglePlayer(draft: PlayerDraft): void {
    this.openPlayer.set(this.openPlayer() === draft ? null : draft);
  }

  protected isPlayerHighlighted(draft: PlayerDraft): boolean {
    return this.highlightedPlayer() === draft;
  }

  private applyRouteFocus(): void {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    if (tab === 'settings' || tab === 'players' || tab === 'fillins' || tab === 'comps' || tab === 'access') {
      this.openTab(tab);
    }

    const playerId = params.get('playerId');
    if (playerId) {
      const draft = this.playerDrafts().find((d) => d.id === playerId);
      if (draft) {
        this.openPlayer.set(draft);
        this.highlightedPlayer.set(draft);
        setTimeout(() => this.highlightedPlayer.set(null), 2400);
        this.scrollToCard(`player-${draft.uid}`);
      }
    }

    const fillInId = params.get('fillInId');
    if (fillInId) {
      const idx = this.fillInDrafts().findIndex((d) => d.id === fillInId);
      if (idx >= 0) this.scrollToCard(`fillin-draft-${idx}`);
    }

    const compId = params.get('compId');
    if (compId) {
      const idx = this.compDrafts().findIndex((d) => d.id === compId);
      if (idx >= 0) this.scrollToCard(`comp-draft-${idx}`);
    }
  }

  async saveSettings(): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can edit team settings.');
      return;
    }
    await this.data.updateSettings({ teamName: this.teamName().trim() || 'Bom Squad' });
    this.flash('Team name saved.');
  }

  protected autoFillPlayerSlugs(draft: PlayerDraft): void {
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

  protected enrichmentKey(draft: PlayerDraft): string {
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
        draft.top3 = enriched.top3.join(', ');
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

  protected openAddPlayerDialog(): void {
    this.addPlayerMode.set('choose');
    this.newPlayerSummoner.set('');
    this.newPlayerTag.set('EUW');
    this.newPlayerRegion.set('euw');
    this.showAddPlayerDialog.set(true);
  }

  protected closeAddPlayerDialog(): void {
    this.showAddPlayerDialog.set(false);
  }

  protected chooseAutofillAdd(): void {
    this.addPlayerMode.set('summoner');
  }

  protected addPlayerManually(): void {
    this.showAddPlayerDialog.set(false);
    this.insertPlayerDraft({});
  }

  protected async confirmAutofillAdd(): Promise<void> {
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
    this.openTab('players');
    const draft: PlayerDraft = {
      uid: this.newUid(),
      id: '',
      name: '',
      role: 'Top',
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
    this.scrollToCard(`player-${draft.uid}`);
    return draft;
  }

  async savePlayer(draft: PlayerDraft): Promise<void> {
    const profile = {
      region: draft.region.trim() || 'euw',
      opggSlug: draft.opggSlug.trim(),
      riotTag: draft.riotTag.trim(),
      mobalyticsSlug: draft.mobalyticsSlug.trim()
    };
    const base = {
      name: draft.name.trim(),
      role: draft.role,
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
      this.initialized = false;
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

  // ---- Fill-ins ---------------------------------------------------------

  addFillIn(): void {
    this.openTab('fillins');
    this.fillInDrafts.update((list) => [
      ...list,
      { id: '', summoner: '', status: 'provisional', preferredRoles: '', note: '', icon: '', region: 'euw', mobalyticsSlug: '' }
    ]);
  }

  async saveFillIn(draft: FillInDraft): Promise<void> {
    const base = {
      summoner: draft.summoner.trim(),
      status: draft.status.trim() || 'provisional',
      preferredRoles: splitList(draft.preferredRoles),
      note: draft.note.trim() || undefined,
      icon: draft.icon.trim() || undefined,
      profile: { region: draft.region.trim() || 'euw', mobalyticsSlug: draft.mobalyticsSlug.trim() }
    };
    if (!base.summoner) {
      this.flash('Summoner name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.fillIns().find((f) => f.id === draft.id);
      await this.data.updateFillIn({ ...base, id: draft.id, order: existing?.order ?? 0 });
    } else {
      await this.data.createFillIn(base);
      this.initialized = false;
    }
    this.flash(`Saved ${base.summoner}.`);
  }

  async deleteFillIn(draft: FillInDraft): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can delete fill-ins.');
      return;
    }
    if (!draft.id) {
      this.fillInDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete fill-in ${draft.summoner}?`)) {
      return;
    }
    await this.data.deleteFillIn(draft.id);
    this.fillInDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.summoner}.`);
  }

  // ---- Comps ------------------------------------------------------------

  addComp(): void {
    this.openTab('comps');
    this.compDrafts.update((list) => [...list, { id: '', name: '', picks: emptyPicks() }]);
  }

  async saveComp(draft: CompDraft): Promise<void> {
    const name = draft.name.trim();
    if (!name) {
      this.flash('Comp name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.comps().find((c) => c.id === draft.id);
      await this.data.updateComp({ id: draft.id, name, picks: draft.picks, order: existing?.order ?? 0 });
    } else {
      await this.data.createComp({ name, picks: draft.picks } as Omit<Comp, 'id' | 'order'>);
      this.initialized = false;
    }
    this.flash(`Saved ${name}.`);
  }

  async deleteComp(draft: CompDraft): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can delete comps.');
      return;
    }
    if (!draft.id) {
      this.compDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete comp ${draft.name}?`)) {
      return;
    }
    await this.data.deleteComp(draft.id);
    this.compDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.name}.`);
  }

  // ---- Access entries --------------------------------------------------

  addAccessEntry(): void {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can manage access.');
      return;
    }
    this.openTab('access');
    this.accessDrafts.update((list) => [
      ...list,
      { email: '', role: 'viewer', active: true }
    ]);
  }

  async saveAccessEntry(draft: AccessDraft): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can manage access.');
      return;
    }
    const email = normalizeEmailValue(draft.email);
    if (!email) {
      this.flash('Email is required.');
      return;
    }
    draft.email = email;

    const base: AccessEntry = {
      email,
      role: draft.role,
      active: draft.active
    };

    const existing = this.data.accessEntries().find((entry) => normalizeEmailValue(entry.email) === email);
    if (existing) {
      await this.data.updateAccessEntry(base);
      this.accessDrafts.update((list) => list.map((item) => (normalizeEmailValue(item.email) === email ? { ...base } : item)));
    } else {
      await this.data.createAccessEntry(base);
      this.accessDrafts.update((list) => [...list.filter((item) => normalizeEmailValue(item.email) !== email), { ...base }].sort((a, b) => a.email.localeCompare(b.email)));
    }
    this.flash(`Saved ${email}.`);
  }

  async deleteAccessEntry(draft: AccessDraft): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can manage access.');
      return;
    }
    const email = normalizeEmailValue(draft.email);
    if (!email) {
      this.accessDrafts.update((list) => list.filter((item) => item !== draft));
      return;
    }
    if (!confirm(`Delete access entry for ${email}?`)) {
      return;
    }
    await this.data.deleteAccessEntry(email);
    this.accessDrafts.update((list) => list.filter((item) => item.email.trim().toLowerCase() !== email));
    this.flash(`Deleted ${email}.`);
  }

  // ---- Maintenance ------------------------------------------------------

  async seed(): Promise<void> {
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can seed the database.');
      return;
    }
    try {
      await this.data.seedFirestore();
      this.flash('Firestore seeded from starter data.');
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Seed failed.');
    }
  }

  resetLocal(): void {
    if (!confirm('Reset local data back to the original starter roster?')) {
      return;
    }
    this.data.resetLocal();
    this.initialized = false;
    this.flash('Local data reset.');
  }
}
