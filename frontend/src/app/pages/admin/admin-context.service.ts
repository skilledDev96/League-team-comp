import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AccessEntry, AccessRole, Comp, CompPicks, FillIn, Player, ROLES, Role, Tournament } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { AdminPlayersService } from './state/admin-players.service';
import { AdminShellService } from './state/admin-shell.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { BUILD_SHA } from '../../build-info';
import {
  AccessDraft,
  CompDraft,
  EditorTab,
  emptyPicks,
  FillInDraft,
  newUid,
  normalizeEmailValue,
  PlayerDraft,
  slugifyName,
  splitList,
  toFillInDraft,
  toPlayerDraft,
  TournamentDraft,
  toTournamentDraft
} from './admin-drafts';

/**
 * Everything the admin tabs share: the working drafts, the CRUD that saves
 * them, and which tab is open.
 *
 * Provided by AdminComponent rather than in root, so the drafts are discarded
 * when you leave the page — the same lifetime they had when this was one
 * component.
 */
@Injectable()
export class AdminContextService {
  readonly auth = inject(AuthService);
  readonly data = inject(TeamDataService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly route = inject(ActivatedRoute);
  readonly roles = ROLES;
  readonly accessRoles: AccessRole[] = ['admin', 'contributor', 'viewer'];

  readonly teamName = signal('');
  readonly fillInDrafts = signal<FillInDraft[]>([]);
  readonly compDrafts = signal<CompDraft[]>([]);
  readonly accessDrafts = signal<AccessDraft[]>([]);
  readonly tournamentDrafts = signal<TournamentDraft[]>([]);
  /** Guards against a second Save landing before the created id comes back. */
  readonly savingTournament = signal(false);
  private readonly shell = inject(AdminShellService);
  private readonly players = inject(AdminPlayersService);

  readonly activeTab = this.shell.activeTab;

  readonly status = this.shell.status;

  // The player editor, re-exposed so the tab templates read unchanged.
  readonly playerDrafts = this.players.playerDrafts;
  readonly enrichingPlayerId = this.players.enrichingPlayerId;
  readonly openPlayer = this.players.openPlayer;
  readonly highlightedPlayer = this.players.highlightedPlayer;
  readonly playersByRole = this.players.playersByRole;
  readonly showAddPlayerDialog = this.players.showAddPlayerDialog;
  readonly addPlayerMode = this.players.addPlayerMode;
  readonly newPlayerSummoner = this.players.newPlayerSummoner;
  readonly newPlayerTag = this.players.newPlayerTag;
  readonly newPlayerRegion = this.players.newPlayerRegion;
  readonly isPlayerOpen = (d: PlayerDraft) => this.players.isPlayerOpen(d);
  readonly togglePlayer = (d: PlayerDraft) => this.players.togglePlayer(d);
  readonly toggleSecondaryRole = (d: PlayerDraft, r: Role) => this.players.toggleSecondaryRole(d, r);
  readonly isPlayerHighlighted = (d: PlayerDraft) => this.players.isPlayerHighlighted(d);
  readonly autoFillPlayerSlugs = (d: PlayerDraft) => this.players.autoFillPlayerSlugs(d);
  readonly enrichmentKey = (d: PlayerDraft) => this.players.enrichmentKey(d);
  readonly autoFillPlayerInsights = (d: PlayerDraft) => this.players.autoFillPlayerInsights(d);
  readonly openAddPlayerDialog = () => this.players.openAddPlayerDialog();
  readonly closeAddPlayerDialog = () => this.players.closeAddPlayerDialog();
  readonly chooseAutofillAdd = () => this.players.chooseAutofillAdd();
  readonly addPlayerManually = () => this.players.addPlayerManually();
  readonly confirmAutofillAdd = () => this.players.confirmAutofillAdd();
  readonly savePlayer = (d: PlayerDraft) => this.players.savePlayer(d);
  readonly deletePlayer = (d: PlayerDraft) => this.players.deletePlayer(d);

  // Accordion: only one player panel open at a time to reduce clutter.

  private initialized = false;
  private lastResync = 0;

  constructor() {
    effect(() => {
      const players = this.data.players();
      const fillIns = this.data.fillIns();
      const comps = this.data.comps();
      const accessEntries = this.data.accessEntries();
      const resync = this.shell.resyncToken();
      if (!this.data.ready() || (this.initialized && resync === this.lastResync)) {
        return;
      }
      this.initialized = true;
      this.lastResync = resync;
      this.teamName.set(this.data.settings().teamName);
      this.players.load(players);
      this.fillInDrafts.set(fillIns.map((f) => toFillInDraft(f)));
      this.compDrafts.set(comps.map((c) => ({ id: c.id, name: c.name, picks: { ...c.picks } })));
      this.accessDrafts.set(accessEntries.map((entry) => ({ ...entry })));
      this.tournamentDrafts.set(this.data.tournaments().map((t) => toTournamentDraft(t)));
      this.applyRouteFocus();
    });

    // After the first load, the player panels follow the live roster.
    effect(() => {
      const players = this.data.players();
      if (!this.initialized) return;
      untracked(() => this.players.follow(players));
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

    // Query params can change while already on /admin (jumping to a tab from a
    // link elsewhere), and a snapshot read would miss that.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.initialized) {
        this.applyRouteFocus();
      }
    });

    effect(() => {
      const canManageUsers = this.auth.canManageUsers();
      const currentTab = this.activeTab();
      if (!canManageUsers && (currentTab === 'settings' || currentTab === 'access' || currentTab === 'diagnostics')) {
        this.activeTab.set('players');
      }
    });
  }


  // ---- Diagnostics (admin only) ----------------------------------------

  // Pipeline audit of the last analysis pass. A silent drop shows up here as a
  // non-zero reason instead of a missing game.
  readonly funnelStages = computed(() => {
    const f = this.data.compAnalysis()?.funnel;
    if (!f) return [];
    return [
      { label: 'Candidate matches', value: f.candidates },
      { label: 'Served from cache', value: f.servedFromCache },
      { label: 'Fetched from Riot', value: f.fetchedFromRiot },
      { label: 'Re-fetched (self-heal)', value: f.selfHealed },
      { label: 'Passed team minimum', value: f.passedTeamMin },
      { label: 'Attributed to a comp', value: f.attributedToComp }
    ];
  });

  readonly funnelDrops = computed(() => {
    const d = this.data.compAnalysis()?.funnel?.dropped;
    if (!d) return [];
    return [
      { label: 'Fetch failed', value: d.fetch_failed },
      { label: 'Over fetch budget', value: d.budget_exhausted },
      { label: 'No roster in match', value: d.no_roster_in_match },
      { label: 'Below team minimum', value: d.below_team_min }
    ].filter((r) => r.value > 0);
  });

  // Functions need a manual deploy while the frontend auto-deploys, so drift
  // here is the visible form of "did my function actually go out?".
  readonly frontendSha = BUILD_SHA;
  readonly backendSha = computed(() => this.data.compAnalysis()?.backendSha ?? '');
  readonly shaMismatch = computed(() => {
    const back = this.backendSha();
    return Boolean(back) && back !== BUILD_SHA;
  });

  readonly analysisGeneratedAt = computed(() => this.data.compAnalysis()?.generatedAt ?? '');
  addTournamentDraft(): void {
    this.tournamentDrafts.update((list) => [
      ...list,
      { id: '', name: '', organiser: '', division: '', format: '', startDate: '', endDate: '', notes: '', active: false }
    ]);
  }

  async saveTournament(draft: TournamentDraft): Promise<void> {
    const name = draft.name.trim();
    if (!name) {
      this.flash('Tournament name is required.');
      return;
    }
    if (this.savingTournament()) {
      return;
    }
    this.savingTournament.set(true);
    try {
      await this.persistTournament(draft, name);
    } finally {
      this.savingTournament.set(false);
    }
  }

  private async persistTournament(draft: TournamentDraft, name: string): Promise<void> {
    const base = {
      name,
      organiser: draft.organiser.trim() || undefined,
      division: draft.division.trim() || undefined,
      format: draft.format.trim() || undefined,
      startDate: draft.startDate.trim() || undefined,
      endDate: draft.endDate.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      active: draft.active
    };
    if (draft.id) {
      const existing = this.data.tournaments().find((t) => t.id === draft.id);
      await this.data.updateTournament({ ...existing, ...base, id: draft.id, order: existing?.order ?? 0 });
    } else {
      await this.data.createTournament(base);
      // Drop the blank draft. It still has an empty id, so leaving it in place
      // means a second Save would create a duplicate rather than update.
      this.tournamentDrafts.update((list) => list.filter((d) => d !== draft));
      this.initialized = false;
    }
    // Only one tournament should read as current.
    if (draft.active) {
      for (const other of this.data.tournaments()) {
        if (other.id !== draft.id && other.active) {
          await this.data.updateTournament({ ...other, active: false });
        }
      }
    }
    this.flash('Saved ' + name + '.');
  }

  async deleteTournament(draft: TournamentDraft): Promise<void> {
    if (!draft.id) {
      this.tournamentDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm('Delete ' + draft.name + '? Its series and games go too.')) {
      return;
    }
    const series = this.data.tournamentSeries().filter((s) => s.tournamentId === draft.id);
    for (const s of series) {
      for (const g of this.data.seriesGames().filter((game) => game.seriesId === s.id)) {
        await this.data.deleteSeriesGame(g.id);
      }
      await this.data.deleteSeries(s.id);
    }
    await this.data.deleteTournament(draft.id);
    this.tournamentDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash('Deleted ' + draft.name + '.');
  }

  /** Comma-separated draft text -> list, for the champion picker. */
  listOf(value: string): string[] {
    return (value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  private flash(message: string): void {
    this.shell.flash(message);
  }

  // ---- Settings ---------------------------------------------------------

  openTab(tab: EditorTab): void {
    if (!this.auth.canManageUsers() && (tab === 'settings' || tab === 'access' || tab === 'diagnostics')) {
      this.activeTab.set('players');
      return;
    }
    this.activeTab.set(tab);
  }

  private scrollToCard(id: string): void {
    this.shell.scrollToCard(id);
  }

  /** Deep links from elsewhere in the app open a tab and focus one row. */
  private applyRouteFocus(): void {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    if (tab === 'settings' || tab === 'players' || tab === 'fillins' || tab === 'comps' || tab === 'tournaments' || tab === 'access' || tab === 'diagnostics') {
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
      // Preserve category / notes / game plan / bans set via inline editing on
      // the Comps page — updateComp does a full replace, so spread existing first.
      await this.data.updateComp({
        ...(existing ?? {}),
        id: draft.id,
        name,
        picks: draft.picks,
        order: existing?.order ?? 0
      });
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
