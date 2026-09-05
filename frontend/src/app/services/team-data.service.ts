import { Injectable, WritableSignal, computed, signal } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { stripUndefined } from '../core/strip-undefined';
import { SEED_DATA } from '../data/seed-data';
import {
  Comp,
  CompResult,
  Play,
  PainPoint,
  LearnEntry,
  CompAnalysis,
  KeyHealth,
  Tournament,
  TournamentSeries,
  SeriesGame,
  ChampionTraitMap,
  ChampionTraits,
  CompOverride,
  MatchNote,
  AccessEntry,
  FillIn,
  Player,
  ResourceLinks,
  Settings,
  TeamData,
  TeamIdentity,
  Scrim,
  ScrimOpponent,
  RefreshLog
} from '../models/team.models';
import { normalizeEmail } from '../core/access';

const LOCAL_KEY = 'bom-team-data';

type EntityKey =
  | 'players'
  | 'fillIns'
  | 'comps'
  | 'tournaments'
  | 'tournamentSeries'
  | 'seriesGames'
  | 'matchNotes'
  | 'compOverrides'
  | 'compResults'
  | 'scrims'
  | 'scrimOpponents'
  | 'plays'
  | 'painPoints'
  | 'learnEntries';

@Injectable({ providedIn: 'root' })
export class TeamDataService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly players = signal<Player[]>([]);
  /** The five who start: everyone not marked as a sub, in roster order. */
  readonly starters = computed(() => this.players().filter((p) => !p.sub));
  readonly fillIns = signal<FillIn[]>([]);
  readonly comps = signal<Comp[]>([]);
  readonly compResults = signal<CompResult[]>([]);
  readonly scrims = signal<Scrim[]>([]);
  readonly scrimOpponents = signal<ScrimOpponent[]>([]);
  readonly plays = signal<Play[]>([]);
  readonly painPoints = signal<PainPoint[]>([]);
  readonly learnEntries = signal<LearnEntry[]>([]);
  readonly accessEntries = signal<AccessEntry[]>([]);
  readonly teamIdentity = signal<TeamIdentity | null>(null);
  readonly compAnalysis = signal<CompAnalysis | null>(null);
  readonly tournaments = signal<Tournament[]>([]);
  readonly tournamentSeries = signal<TournamentSeries[]>([]);
  readonly seriesGames = signal<SeriesGame[]>([]);
  readonly matchNotes = signal<MatchNote[]>([]);
  /** Games placed under a comp by hand, keyed by match. */
  readonly compOverrides = signal<CompOverride[]>([]);
  /**
   * What each champion is, refreshed weekly by `refreshChampionTraits`.
   * Empty until that has run once; every reader treats absence as "unknown"
   * rather than as a finding.
   */
  readonly championTraits = signal<Record<string, ChampionTraits>>({});

  /** Last Riot API key probe (written by the scheduled health check). */
  readonly keyHealth = signal<KeyHealth | null>(null);
  /** The last morning refresh, so the pages can say when the numbers are from. */
  readonly refreshLog = signal<RefreshLog | null>(null);
  readonly resourceLinks = signal<ResourceLinks>({});
  readonly settings = signal<Settings>({ teamName: '' });
  readonly ready = signal(false);

  constructor() {
    if (this.mode === 'firebase') {
      this.initFirebase();
    } else {
      this.initLocal();
    }
  }

  // ---- Local mode -------------------------------------------------------

  private loadLocalBlob(): TeamData {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      const clone = structuredClone(SEED_DATA);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(clone));
      return clone;
    }
    try {
      return JSON.parse(raw) as TeamData;
    } catch {
      const clone = structuredClone(SEED_DATA);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(clone));
      return clone;
    }
  }

  private pushLocalToSignals(data: TeamData): void {
    this.players.set([...data.players].sort((a, b) => a.order - b.order));
    this.fillIns.set([...data.fillIns].sort((a, b) => a.order - b.order));
    this.comps.set([...data.comps].sort((a, b) => a.order - b.order));
    this.compResults.set([...(data.compResults ?? [])].sort((a, b) => a.order - b.order));
    this.scrims.set([...(data.scrims ?? [])].sort((a, b) => a.order - b.order));
    this.scrimOpponents.set([...(data.scrimOpponents ?? [])].sort((a, b) => a.order - b.order));
    this.plays.set([...(data.plays ?? [])].sort((a, b) => a.order - b.order));
    this.painPoints.set([...(data.painPoints ?? [])].sort((a, b) => a.order - b.order));
    this.learnEntries.set([...(data.learnEntries ?? [])].sort((a, b) => a.order - b.order));
    this.accessEntries.set([{ email: 'ruanhart7@gmail.com', role: 'admin', active: true }]);
    this.teamIdentity.set(data.teamIdentity);
    this.tournaments.set([...(data.tournaments ?? [])].sort((a, b) => a.order - b.order));
    this.tournamentSeries.set([...(data.tournamentSeries ?? [])].sort((a, b) => a.order - b.order));
    this.seriesGames.set([...(data.seriesGames ?? [])].sort((a, b) => a.order - b.order));
    this.matchNotes.set([...(data.matchNotes ?? [])]);
    this.compOverrides.set([...(data.compOverrides ?? [])]);
    this.compAnalysis.set(data.compAnalysis ?? null);
    this.resourceLinks.set(data.resourceLinks);
    this.settings.set(data.settings);
  }

  private initLocal(): void {
    this.pushLocalToSignals(this.loadLocalBlob());
    this.ready.set(true);
  }

  private persistLocal(): void {
    const data: TeamData = {
      settings: this.settings(),
      players: this.players(),
      fillIns: this.fillIns(),
      comps: this.comps(),
      compResults: this.compResults(),
      scrims: this.scrims(),
      scrimOpponents: this.scrimOpponents(),
      plays: this.plays(),
      painPoints: this.painPoints(),
      learnEntries: this.learnEntries(),
      teamIdentity: this.teamIdentity() ?? SEED_DATA.teamIdentity,
      tournaments: this.tournaments(),
      tournamentSeries: this.tournamentSeries(),
      seriesGames: this.seriesGames(),
      matchNotes: this.matchNotes(),
      compOverrides: this.compOverrides(),
      compAnalysis: this.compAnalysis() ?? undefined,
      resourceLinks: this.resourceLinks()
    };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  // ---- Firebase mode ----------------------------------------------------

  private initFirebase(): void {
    const db = getDb();
    if (!db) {
      this.initLocal();
      return;
    }

    onSnapshot(collection(db, 'players'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Player, 'id'>) }));
      this.players.set(list.sort((a, b) => a.order - b.order));
      this.ready.set(true);
    });
    onSnapshot(collection(db, 'fillIns'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FillIn, 'id'>) }));
      this.fillIns.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'comps'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comp, 'id'>) }));
      this.comps.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'scrims'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Scrim, 'id'>) }));
      this.scrims.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'scrimOpponents'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ScrimOpponent, 'id'>) }));
      this.scrimOpponents.set(list.sort((a, b) => a.order - b.order));
    });

    onSnapshot(collection(db, 'compResults'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CompResult, 'id'>) }));
      this.compResults.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'plays'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Play, 'id'>) }));
      this.plays.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'painPoints'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PainPoint, 'id'>) }));
      this.painPoints.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'learnEntries'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LearnEntry, 'id'>) }));
      this.learnEntries.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'tournaments'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) }));
      this.tournaments.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'tournamentSeries'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TournamentSeries, 'id'>) }));
      this.tournamentSeries.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'seriesGames'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SeriesGame, 'id'>) }));
      this.seriesGames.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'matchNotes'), (snap) => {
      this.matchNotes.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchNote, 'id'>) })));
    });
    onSnapshot(collection(db, 'compOverrides'), (snap) => {
      this.compOverrides.set(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CompOverride, 'id'>) }))
      );
    });
    onSnapshot(collection(db, 'access'), (snap) => {
      const list = snap.docs.map((d) => ({
        email: d.id,
        ...(d.data() as Omit<AccessEntry, 'email'>)
      }));
      this.accessEntries.set(list.sort((a, b) => a.email.localeCompare(b.email)));
    });
    onSnapshot(doc(db, 'meta', 'teamIdentity'), (d) => {
      this.teamIdentity.set((d.data() as TeamIdentity) ?? null);
    });
    onSnapshot(doc(db, 'meta', 'refreshLog'), (d) => {
      this.refreshLog.set((d.data() as RefreshLog) ?? null);
    });
    onSnapshot(doc(db, 'meta', 'keyHealth'), (d) => {
      this.keyHealth.set((d.data() as KeyHealth) ?? null);
    });
    onSnapshot(doc(db, 'meta', 'compAnalysis'), (d) => {
      this.compAnalysis.set((d.data() as CompAnalysis) ?? null);
    });
    onSnapshot(doc(db, 'meta', 'championTraits'), (d) => {
      this.championTraits.set((d.data() as ChampionTraitMap)?.traits ?? {});
    });
    onSnapshot(doc(db, 'meta', 'resourceLinks'), (d) => {
      const data = d.data() as { groups?: ResourceLinks } | undefined;
      this.resourceLinks.set(data?.groups ?? {});
    });
    onSnapshot(doc(db, 'meta', 'settings'), (d) => {
      this.settings.set((d.data() as Settings) ?? { teamName: '' });
    });
  }

  /** One-time import of SEED_DATA into Firestore. Safe to run only on an empty project. */
  async seedFirestore(): Promise<void> {
    const db = getDb();
    if (!db) {
      throw new Error('Firebase is not configured.');
    }
    const marker = await getDoc(doc(db, 'meta', 'settings'));
    if (marker.exists()) {
      throw new Error('Firestore already contains data; seeding aborted.');
    }
    const batch = writeBatch(db);
    for (const player of SEED_DATA.players) {
      const { id, ...rest } = player;
      batch.set(doc(db, 'players', id), rest);
    }
    for (const fill of SEED_DATA.fillIns) {
      const { id, ...rest } = fill;
      batch.set(doc(db, 'fillIns', id), rest);
    }
    for (const comp of SEED_DATA.comps) {
      const { id, ...rest } = comp;
      batch.set(doc(db, 'comps', id), rest);
    }
    for (const result of SEED_DATA.compResults) {
      const { id, ...rest } = result;
      batch.set(doc(db, 'compResults', id), rest);
    }
    for (const play of SEED_DATA.plays) {
      const { id, ...rest } = play;
      batch.set(doc(db, 'plays', id), rest);
    }
    for (const pain of SEED_DATA.painPoints) {
      const { id, ...rest } = pain;
      batch.set(doc(db, 'painPoints', id), rest);
    }
    for (const learn of SEED_DATA.learnEntries) {
      const { id, ...rest } = learn;
      batch.set(doc(db, 'learnEntries', id), rest);
    }
    batch.set(doc(db, 'access', 'ruanhart7@gmail.com'), {
      email: 'ruanhart7@gmail.com',
      role: 'admin',
      active: true
    });
    batch.set(doc(db, 'meta', 'teamIdentity'), SEED_DATA.teamIdentity);
    batch.set(doc(db, 'meta', 'resourceLinks'), { groups: SEED_DATA.resourceLinks });
    batch.set(doc(db, 'meta', 'settings'), SEED_DATA.settings);
    await batch.commit();
  }

  // ---- CRUD: generic list entities --------------------------------------

  private nextOrder(list: { order: number }[]): number {
    return list.reduce((max, item) => Math.max(max, item.order), -1) + 1;
  }

  private newId(prefix: string): string {
    const rand = (crypto as Crypto).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    return `${prefix}-${rand.slice(0, 8)}`;
  }

  private async persistUpsert<T extends { id: string; order: number }>(
    key: EntityKey,
    sig: WritableSignal<T[]>,
    entity: T
  ): Promise<void> {
    // The screen first, the network second. A draft action measured about a
    // second from click to screen while it waited for the write (5 Sep 2026),
    // and under a thirty-second clock that is a third of the time to react.
    // The snapshot that follows carries the same document and simply confirms
    // what the screen already shows — and if a tab's listener ever stalls,
    // the drafter still sees their own actions land.
    const current = sig();
    const exists = current.some((item) => item.id === entity.id);
    const next = exists
      ? current.map((item) => (item.id === entity.id ? entity : item))
      : [...current, entity];
    sig.set([...next].sort((a, b) => a.order - b.order));

    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return;
      const { id, ...rest } = entity;
      await setDoc(doc(db, key, id), stripUndefined(rest as Record<string, unknown>));
      return;
    }
    this.persistLocal();
  }

  private async persistRemove<T extends { id: string }>(
    key: EntityKey,
    sig: WritableSignal<T[]>,
    id: string
  ): Promise<void> {
    sig.set(sig().filter((item) => item.id !== id));
    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return;
      await deleteDoc(doc(db, key, id));
      return;
    }
    this.persistLocal();
  }

  // ---- Players ----------------------------------------------------------

  createPlayer(data: Omit<Player, 'id' | 'order'>): Promise<void> {
    const player: Player = { ...data, id: this.newId('player'), order: this.nextOrder(this.players()) };
    return this.persistUpsert('players', this.players, player);
  }

  updatePlayer(player: Player): Promise<void> {
    return this.persistUpsert('players', this.players, player);
  }

  deletePlayer(id: string): Promise<void> {
    return this.persistRemove('players', this.players, id);
  }

  // ---- Fill-ins ---------------------------------------------------------

  createFillIn(data: Omit<FillIn, 'id' | 'order'>): Promise<void> {
    const fill: FillIn = { ...data, id: this.newId('fill'), order: this.nextOrder(this.fillIns()) };
    return this.persistUpsert('fillIns', this.fillIns, fill);
  }

  updateFillIn(fill: FillIn): Promise<void> {
    return this.persistUpsert('fillIns', this.fillIns, fill);
  }

  deleteFillIn(id: string): Promise<void> {
    return this.persistRemove('fillIns', this.fillIns, id);
  }

  // ---- Comps ------------------------------------------------------------

  /** One note per match, so the match id doubles as the document id. */
  saveMatchNote(matchId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return this.deleteMatchNote(matchId);
    }
    const note: MatchNote = { id: matchId, matchId, text: trimmed, order: 0 };
    return this.persistUpsert('matchNotes', this.matchNotes, note);
  }

  deleteMatchNote(matchId: string): Promise<void> {
    if (!this.matchNotes().some((note) => note.id === matchId)) {
      return Promise.resolve();
    }
    return this.persistRemove('matchNotes', this.matchNotes, matchId);
  }

  matchNote(matchId: string): string {
    return this.matchNotes().find((note) => note.matchId === matchId)?.text ?? '';
  }

  /**
   * Place a game under a comp by hand, or clear the override with an empty id.
   *
   * The stats it feeds are computed on the backend, so this write alone changes
   * nothing on screen — the next Refresh on the Analysis page is what applies
   * it. Callers say so rather than leaving the number looking stuck.
   */
  saveCompOverride(matchId: string, compId: string): Promise<void> {
    if (!compId) {
      return this.clearCompOverride(matchId);
    }
    const override: CompOverride = { id: matchId, matchId, compId, order: 0 };
    return this.persistUpsert('compOverrides', this.compOverrides, override);
  }

  clearCompOverride(matchId: string): Promise<void> {
    if (!this.compOverrides().some((entry) => entry.id === matchId)) {
      return Promise.resolve();
    }
    return this.persistRemove('compOverrides', this.compOverrides, matchId);
  }

  compOverride(matchId: string): string {
    return this.compOverrides().find((entry) => entry.matchId === matchId)?.compId ?? '';
  }

  /** The shape the analysis request wants: matchId -> compId. */
  compOverrideMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const entry of this.compOverrides()) map[entry.matchId] = entry.compId;
    return map;
  }

  createTournament(data: Omit<Tournament, 'id' | 'order'>): Promise<void> {
    const entity: Tournament = { ...data, id: this.newId('tournament'), order: this.nextOrder(this.tournaments()) };
    return this.persistUpsert('tournaments', this.tournaments, entity);
  }

  updateTournament(entity: Tournament): Promise<void> {
    return this.persistUpsert('tournaments', this.tournaments, entity);
  }

  deleteTournament(id: string): Promise<void> {
    return this.persistRemove('tournaments', this.tournaments, id);
  }

  createSeries(data: Omit<TournamentSeries, 'id' | 'order'>): Promise<void> {
    const entity: TournamentSeries = { ...data, id: this.newId('series'), order: this.nextOrder(this.tournamentSeries()) };
    return this.persistUpsert('tournamentSeries', this.tournamentSeries, entity);
  }

  updateSeries(entity: TournamentSeries): Promise<void> {
    return this.persistUpsert('tournamentSeries', this.tournamentSeries, entity);
  }

  deleteSeries(id: string): Promise<void> {
    return this.persistRemove('tournamentSeries', this.tournamentSeries, id);
  }

  createSeriesGame(data: Omit<SeriesGame, 'id' | 'order'>): Promise<void> {
    const entity: SeriesGame = { ...data, id: this.newId('game'), order: this.nextOrder(this.seriesGames()) };
    return this.persistUpsert('seriesGames', this.seriesGames, entity);
  }

  updateSeriesGame(entity: SeriesGame): Promise<void> {
    return this.persistUpsert('seriesGames', this.seriesGames, entity);
  }

  deleteSeriesGame(id: string): Promise<void> {
    return this.persistRemove('seriesGames', this.seriesGames, id);
  }

  createComp(data: Omit<Comp, 'id' | 'order'>): Promise<void> {
    const comp: Comp = { ...data, id: this.newId('comp'), order: this.nextOrder(this.comps()) };
    return this.persistUpsert('comps', this.comps, comp);
  }

  updateComp(comp: Comp): Promise<void> {
    return this.persistUpsert('comps', this.comps, comp);
  }

  deleteComp(id: string): Promise<void> {
    return this.persistRemove('comps', this.comps, id);
  }

  // ---- Comp results -----------------------------------------------------

  createCompResult(data: Omit<CompResult, 'id' | 'order'>): Promise<void> {
    const result: CompResult = {
      ...data,
      id: this.newId('result'),
      order: this.nextOrder(this.compResults())
    };
    return this.persistUpsert('compResults', this.compResults, result);
  }

  deleteCompResult(id: string): Promise<void> {
    return this.persistRemove('compResults', this.compResults, id);
  }

  /**
   * Save a scrim, keyed by its own match id.
   *
   * The id comes from the replay filename rather than being generated, so
   * importing the same file twice updates one scrim instead of creating a
   * second — which is the whole point of having a stable identity.
   */
  saveScrim(scrim: Scrim): Promise<void> {
    return this.persistUpsert('scrims', this.scrims, scrim);
  }

  deleteScrim(id: string): Promise<void> {
    return this.persistRemove('scrims', this.scrims, id);
  }

  /**
   * Save what we know about a scrim opponent, keyed by a slug of their name.
   *
   * The id is derived, not generated, so notes written against "MOSS" on one
   * evening and a roster pasted against "MOSS" on another land on the same
   * record without anyone linking them. A new opponent is created the first
   * time anything is saved against them; there is no separate "add" step.
   */
  saveScrimOpponent(opponent: ScrimOpponent): Promise<void> {
    return this.persistUpsert('scrimOpponents', this.scrimOpponents, opponent);
  }

  deleteScrimOpponent(id: string): Promise<void> {
    return this.persistRemove('scrimOpponents', this.scrimOpponents, id);
  }

  // ---- Tactical plays ---------------------------------------------------

  createPlay(data: Omit<Play, 'id' | 'order'>): Promise<void> {
    const play: Play = { ...data, id: this.newId('play'), order: this.nextOrder(this.plays()) };
    return this.persistUpsert('plays', this.plays, play);
  }

  updatePlay(play: Play): Promise<void> {
    return this.persistUpsert('plays', this.plays, play);
  }

  deletePlay(id: string): Promise<void> {
    return this.persistRemove('plays', this.plays, id);
  }

  // ---- Pain points ------------------------------------------------------

  createPainPoint(data: Omit<PainPoint, 'id' | 'order'>): Promise<void> {
    const pain: PainPoint = { ...data, id: this.newId('pain'), order: this.nextOrder(this.painPoints()) };
    return this.persistUpsert('painPoints', this.painPoints, pain);
  }

  updatePainPoint(pain: PainPoint): Promise<void> {
    return this.persistUpsert('painPoints', this.painPoints, pain);
  }

  deletePainPoint(id: string): Promise<void> {
    return this.persistRemove('painPoints', this.painPoints, id);
  }

  // ---- Champs to learn --------------------------------------------------

  createLearnEntry(data: Omit<LearnEntry, 'id' | 'order'>): Promise<void> {
    const entry: LearnEntry = { ...data, id: this.newId('learn'), order: this.nextOrder(this.learnEntries()) };
    return this.persistUpsert('learnEntries', this.learnEntries, entry);
  }

  updateLearnEntry(entry: LearnEntry): Promise<void> {
    return this.persistUpsert('learnEntries', this.learnEntries, entry);
  }

  deleteLearnEntry(id: string): Promise<void> {
    return this.persistRemove('learnEntries', this.learnEntries, id);
  }

  // ---- Access entries --------------------------------------------------

  createAccessEntry(data: Omit<AccessEntry, 'email'> & { email: string }): Promise<void> {
    const email = normalizeEmail(data.email);
    const entry: AccessEntry = {
      email,
      role: data.role,
      active: data.active
    };
    return this.persistAccessUpsert(entry);
  }

  updateAccessEntry(entry: AccessEntry): Promise<void> {
    return this.persistAccessUpsert(entry);
  }

  deleteAccessEntry(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return Promise.resolve();
      return deleteDoc(doc(db, 'access', normalized));
    }
    this.accessEntries.set(this.accessEntries().filter((item) => item.email !== normalized));
    this.persistLocal();
    return Promise.resolve();
  }

  private async persistAccessUpsert(entry: AccessEntry): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return;
      await setDoc(doc(db, 'access', entry.email), {
        role: entry.role,
        active: entry.active
      });
      return;
    }
    const current = this.accessEntries();
    const exists = current.some((item) => item.email === entry.email);
    const next = exists
      ? current.map((item) => (item.email === entry.email ? entry : item))
      : [...current, entry];
    this.accessEntries.set([...next].sort((a, b) => a.email.localeCompare(b.email)));
    this.persistLocal();
  }

  // ---- Meta singletons --------------------------------------------------

  async updateTeamIdentity(identity: TeamIdentity): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (db) await setDoc(doc(db, 'meta', 'teamIdentity'), identity);
    } else {
      this.teamIdentity.set(identity);
      this.persistLocal();
    }
  }

  async updateResourceLinks(groups: ResourceLinks): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (db) await setDoc(doc(db, 'meta', 'resourceLinks'), { groups });
    } else {
      this.resourceLinks.set(groups);
      this.persistLocal();
    }
  }

  async updateSettings(settings: Settings): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (db) await setDoc(doc(db, 'meta', 'settings'), settings);
    } else {
      this.settings.set(settings);
      this.persistLocal();
    }
  }

  /** Restore local-mode data back to the original seed (dev convenience). */
  resetLocal(): void {
    if (this.mode !== 'local') return;
    localStorage.removeItem(LOCAL_KEY);
    this.pushLocalToSignals(this.loadLocalBlob());
  }

  playerByName(name: string): Player | undefined {
    return this.players().find((p) => p.name.toLowerCase() === name.toLowerCase());
  }
}
