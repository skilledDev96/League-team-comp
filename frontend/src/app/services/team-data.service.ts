import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { getAuthInstance, getDb, isFirebaseConfigured } from '../core/firebase';
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
  SelfScout, TeamIdentity,
  Scrim,
  ScrimOpponent,
  RefreshLog,
  DraftEvent,
  GameReview,
  PracticeGame,
  FilmChoice,
  FilmCommitment,
  FilmNotes
} from '../models/team.models';
import { normalizeEmail } from '../core/access';
import { AuthService } from './auth.service';
import { describeGameChange } from '../core/draft-diff';
import { ClientError } from '../core/error-reporting';

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
  | 'practiceGames'
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
  /** Our five as a scout sees us; null until someone runs the scout. */
  readonly selfScout = signal<SelfScout | null>(null);
  readonly compAnalysis = signal<CompAnalysis | null>(null);
  readonly tournaments = signal<Tournament[]>([]);
  readonly tournamentSeries = signal<TournamentSeries[]>([]);
  readonly seriesGames = signal<SeriesGame[]>([]);
  readonly matchNotes = signal<MatchNote[]>([]);
  /** Games placed under a comp by hand, keyed by match. */
  readonly compOverrides = signal<CompOverride[]>([]);
  /** Games tagged as messing around, keyed by match; Patterns leaves them out. */
  readonly practiceGames = signal<PracticeGame[]>([]);
  readonly practiceSet = computed(() => new Set(this.practiceGames().map((p) => p.matchId)));
  /** Written reviews, one per game; only the review function writes these. */
  readonly gameReviews = signal<GameReview[]>([]);
  private readonly reviewMap = computed(() => new Map(this.gameReviews().map((r) => [r.matchId, r])));

  /** Take a review down. The function writes them; an editor may remove one that no longer says anything true. */
  async deleteGameReview(matchId: string): Promise<void> {
    this.gameReviews.set(this.gameReviews().filter((r) => r.matchId !== matchId));
    if (this.mode !== 'firebase') return;
    const db = getDb();
    if (db) await deleteDoc(doc(db, 'gameReviews', matchId));
  }

  reviewFor(matchId: string | undefined): GameReview | undefined {
    return matchId ? this.reviewMap().get(matchId) : undefined;
  }

  // ---- The film room ----------------------------------------------------
  //
  // The team's side of a film (9 Sep 2026): what we committed to and the
  // notes on a moment or a death. One document per game in each collection,
  // written by editors with a merge so two people picking at once both
  // land. Firebase-only, like the reviews: local mode keeps them in memory
  // for the session and nothing else, so they stay out of the seed and the
  // localStorage copy.

  private readonly auth = inject(AuthService);

  /** The team's pick on the first work-on, one per game. */
  readonly filmCommitments = signal<FilmCommitment[]>([]);
  private readonly commitmentMap = computed(() => new Map(this.filmCommitments().map((c) => [c.matchId, c])));
  /** The team's notes on a film, one document per game. */
  readonly filmNotes = signal<FilmNotes[]>([]);
  private readonly notesMap = computed(() => new Map(this.filmNotes().map((n) => [n.matchId, n])));

  commitmentFor(matchId: string | undefined): FilmCommitment | undefined {
    return matchId ? this.commitmentMap().get(matchId) : undefined;
  }

  notesFor(matchId: string | undefined): FilmNotes | undefined {
    return matchId ? this.notesMap().get(matchId) : undefined;
  }

  /** What the team chose: the majority of the picks, ties to the first option. */
  teamChoice(c: FilmCommitment): FilmChoice {
    const counts: Record<FilmChoice, number> = { a: 0, b: 0, commit: 0 };
    for (const choice of Object.values(c.by)) counts[choice] = (counts[choice] ?? 0) + 1;
    if (counts.commit > counts.a && counts.commit > counts.b) return 'commit';
    return counts.b > counts.a ? 'b' : 'a';
  }

  /**
   * Record this person's pick on a game's first work-on; the text and options
   * are kept as they read when the pick was made. When the stored sentence
   * differs from this one a re-review changed it, so the old picks were on
   * another question: the document starts over with just this pick.
   */
  async commitTo(matchId: string, text: string, options: [string, string] | undefined, choice: FilmChoice): Promise<void> {
    const key = this.emailKey();
    const current = this.commitmentFor(matchId);
    const reset = !!current && current.text !== text;
    const next: FilmCommitment = {
      matchId,
      text,
      ...(options && { options }),
      by: { ...(reset ? {} : (current?.by ?? {})), [key]: choice }
    };
    this.filmCommitments.set([...this.filmCommitments().filter((c) => c.matchId !== matchId), next]);
    if (this.mode !== 'firebase') return;
    const db = getDb();
    if (!db) return;
    const ref = doc(db, 'filmCommitments', matchId);
    if (reset) await setDoc(ref, next);
    else await setDoc(ref, { matchId, text, ...(options && { options }), by: { [key]: choice } }, { merge: true });
  }

  /** One line on a moment ("m:<index>") or a death ("d:<minute>:<seat>"); an empty text takes the note down. */
  async saveFilmNote(matchId: string, key: string, text: string): Promise<void> {
    const trimmed = text.trim();
    const by = this.emailKey();
    const at = new Date().toISOString();
    const current = this.notesFor(matchId);
    const notes = { ...(current?.notes ?? {}) };
    if (trimmed) notes[key] = { text: trimmed, by, at };
    else delete notes[key];
    this.filmNotes.set([...this.filmNotes().filter((n) => n.matchId !== matchId), { matchId, notes }]);
    if (this.mode !== 'firebase') return;
    const db = getDb();
    if (!db) return;
    await setDoc(doc(db, 'filmNotes', matchId), { matchId, notes: { [key]: trimmed ? { text: trimmed, by, at } : deleteField() } }, { merge: true });
  }

  /** The signed-in email, lowercased, as the key a person's pick or note is stored under. */
  private emailKey(): string {
    return normalizeEmail(this.auth.userEmail() ?? getAuthInstance()?.currentUser?.email) || 'unknown';
  }
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
    this.selfScout.set(data.selfScout ?? null);
    this.tournaments.set([...(data.tournaments ?? [])].sort((a, b) => a.order - b.order));
    this.tournamentSeries.set([...(data.tournamentSeries ?? [])].sort((a, b) => a.order - b.order));
    this.seriesGames.set([...(data.seriesGames ?? [])].sort((a, b) => a.order - b.order));
    this.matchNotes.set([...(data.matchNotes ?? [])]);
    this.compOverrides.set([...(data.compOverrides ?? [])]);
    this.practiceGames.set([...(data.practiceGames ?? [])]);
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
      practiceGames: this.practiceGames(),
      compAnalysis: this.compAnalysis() ?? undefined,
      selfScout: this.selfScout() ?? undefined,
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
    onSnapshot(collection(db, 'practiceGames'), (snap) => {
      this.practiceGames.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PracticeGame, 'id'>) })));
    });
    onSnapshot(collection(db, 'gameReviews'), (snap) => {
      this.gameReviews.set(snap.docs.map((d) => d.data() as GameReview).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)));
    });
    onSnapshot(collection(db, 'filmCommitments'), (snap) => {
      this.filmCommitments.set(snap.docs.map((d) => ({ ...(d.data() as FilmCommitment), matchId: d.id, by: (d.data() as FilmCommitment).by ?? {} })));
    });
    onSnapshot(collection(db, 'filmNotes'), (snap) => {
      this.filmNotes.set(snap.docs.map((d) => ({ ...(d.data() as FilmNotes), matchId: d.id, notes: (d.data() as FilmNotes).notes ?? {} })));
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
    onSnapshot(doc(db, 'meta', 'selfScout'), (d) => {
      this.selfScout.set((d.data() as SelfScout) ?? null);
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

  async createFillIn(data: Omit<FillIn, 'id' | 'order'>): Promise<string> {
    const fill: FillIn = { ...data, id: this.newId('fill'), order: this.nextOrder(this.fillIns()) };
    await this.persistUpsert('fillIns', this.fillIns, fill);
    return fill.id;
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

  /** Tag a game as messing around, or take the tag off. Serious is the absence of a tag. */
  setPractice(matchId: string, on: boolean): Promise<void> {
    const tagged = this.practiceGames().some((p) => p.matchId === matchId);
    if (on === tagged) return Promise.resolve();
    if (!on) return this.persistRemove('practiceGames', this.practiceGames, matchId);
    const tag: PracticeGame = { id: matchId, matchId, practice: true, order: 0 };
    return this.persistUpsert('practiceGames', this.practiceGames, tag);
  }

  isPractice(matchId: string | undefined): boolean {
    return !!matchId && this.practiceSet().has(matchId);
  }

  /** The shape the analysis request wants: matchId -> compId. */
  compOverrideMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const entry of this.compOverrides()) map[entry.matchId] = entry.compId;
    return map;
  }

  async createTournament(data: Omit<Tournament, 'id' | 'order'>): Promise<string> {
    const entity: Tournament = { ...data, id: this.newId('tournament'), order: this.nextOrder(this.tournaments()) };
    await this.persistUpsert('tournaments', this.tournaments, entity);
    return entity.id;
  }

  updateTournament(entity: Tournament): Promise<void> {
    return this.persistUpsert('tournaments', this.tournaments, entity);
  }

  deleteTournament(id: string): Promise<void> {
    return this.persistRemove('tournaments', this.tournaments, id);
  }

  async createSeries(data: Omit<TournamentSeries, 'id' | 'order'>): Promise<string> {
    const entity: TournamentSeries = { ...data, id: this.newId('series'), order: this.nextOrder(this.tournamentSeries()) };
    await this.persistUpsert('tournamentSeries', this.tournamentSeries, entity);
    return entity.id;
  }

  updateSeries(entity: TournamentSeries): Promise<void> {
    return this.persistUpsert('tournamentSeries', this.tournamentSeries, entity);
  }

  deleteSeries(id: string): Promise<void> {
    return this.persistRemove('tournamentSeries', this.tournamentSeries, id);
  }

  async createSeriesGame(data: Omit<SeriesGame, 'id' | 'order'>): Promise<string> {
    const entity: SeriesGame = { ...data, id: this.newId('game'), order: this.nextOrder(this.seriesGames()) };
    await this.persistUpsert('seriesGames', this.seriesGames, entity);
    return entity.id;
  }

  async updateSeriesGame(entity: SeriesGame): Promise<void> {
    const before = this.seriesGames().find((g) => g.id === entity.id);
    await this.persistUpsert('seriesGames', this.seriesGames, entity);
    void this.logDraftEvent(before, entity);
  }

  /**
   * Every change to a game, in words, so "something went wrong in the draft"
   * can be read back the next morning. Diffed here because this is the one
   * place every page's write passes through; a hold-only change is skipped.
   * Never awaited by the caller and never allowed to fail the write.
   */
  private async logDraftEvent(before: SeriesGame | undefined, after: SeriesGame): Promise<void> {
    if (this.mode !== 'firebase') return;
    const changes = describeGameChange(before, after);
    if (!changes.length) return;
    const db = getDb();
    if (!db) return;
    const at = new Date();
    const id = `${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)}-${after.id.slice(-6)}`;
    const event: Omit<DraftEvent, 'id'> = {
      at: at.toISOString(),
      by: getAuthInstance()?.currentUser?.email ?? 'unknown',
      seriesId: after.seriesId,
      gameId: after.id,
      gameNumber: after.gameNumber,
      stepBefore: before?.draftStep ?? 0,
      stepAfter: after.draftStep ?? 0,
      changes: changes.map((c) => c.note),
      kinds: changes.map((c) => c.kind),
      board: {
        ...(after.ourSide ? { ourSide: after.ourSide } : {}),
        bans: (after.bans ?? []).filter(Boolean),
        ourChampions: after.ourChampions ?? [],
        theirChampions: after.theirChampions ?? []
      }
    };
    try {
      await setDoc(doc(db, 'draftEvents', id), stripUndefined(event as unknown as Record<string, unknown>));
    } catch (error) {
      console.warn('Draft log write failed', error);
    }
  }

  /** The latest draft events, newest first. One read, for the admin page. */
  async loadDraftEvents(count = 200): Promise<DraftEvent[]> {
    const db = this.mode === 'firebase' ? getDb() : null;
    if (!db) return [];
    const snap = await getDocs(query(collection(db, 'draftEvents'), orderBy('at', 'desc'), limit(count)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DraftEvent, 'id'>) }));
  }

  /** Errors browsers reported, newest first. One read, for the admin page. */
  async loadClientErrors(count = 50): Promise<ClientError[]> {
    const db = this.mode === 'firebase' ? getDb() : null;
    if (!db) return [];
    const snap = await getDocs(query(collection(db, 'clientErrors'), orderBy('at', 'desc'), limit(count)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClientError, 'id'>) }));
  }

  deleteSeriesGame(id: string): Promise<void> {
    return this.persistRemove('seriesGames', this.seriesGames, id);
  }

  /** Returns the new comp's id, so a page can open it. */
  async createComp(data: Omit<Comp, 'id' | 'order'>): Promise<string> {
    const comp: Comp = { ...data, id: this.newId('comp'), order: this.nextOrder(this.comps()) };
    await this.persistUpsert('comps', this.comps, comp);
    return comp.id;
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

  /** Written after each player the scout reads, so an interrupted scout keeps what it got. */
  async saveSelfScout(scout: SelfScout): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (db) await setDoc(doc(db, 'meta', 'selfScout'), stripUndefined(scout as unknown as Record<string, unknown>));
    } else {
      this.selfScout.set(scout);
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
