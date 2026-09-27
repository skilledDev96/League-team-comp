import { DestroyRef, Injectable, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  FirestoreError,
  Query,
  QuerySnapshot,
  Unsubscribe,
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
  Trophy,
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
  FilmLabDrawing,
  FilmNote,
  FilmNotes
} from '../models/team.models';
import { normalizeEmail } from '../core/access';
import { AuthService } from './auth.service';
import { describeGameChange } from '../core/draft-diff';
import { ClientError, reportClientError } from '../core/error-reporting';
import { rosterIds, scrimSide } from '../pages/games/game-rows';

const LOCAL_KEY = 'bom-team-data';

/** What Download team data saves (17 Sep 2026): the hand-entered collections and singleton docs, stamped. */
export interface TeamDataExport {
  app: 'bom-squad';
  /** The shape's version; bump it when a key changes meaning. */
  version: 1;
  /** ISO. */
  exportedAt: string;
  settings: Settings;
  teamIdentity: TeamIdentity | null;
  resourceLinks: ResourceLinks;
  players: Player[];
  fillIns: FillIn[];
  comps: Comp[];
  compResults: CompResult[];
  compOverrides: CompOverride[];
  practiceGames: PracticeGame[];
  tournaments: Tournament[];
  tournamentSeries: TournamentSeries[];
  seriesGames: SeriesGame[];
  scrims: Scrim[];
  scrimOpponents: ScrimOpponent[];
  matchNotes: MatchNote[];
  filmNotes: FilmNotes[];
  filmCommitments: FilmCommitment[];
  plays: Play[];
  painPoints: PainPoint[];
  learnEntries: LearnEntry[];
  trophies: Trophy[];
  gameReviews: GameReview[];
  accessEntries: AccessEntry[];
}

/**
 * A scrim as Download team data writes it (17 Sep 2026): the other side's Riot ids blanked. A replay file carries
 * all ten names, the app prints theirs nowhere, and the other side is a team name and champions in seats, so a
 * file that leaves the app must not list them either. Their five are the side that is not ours; when neither a
 * stored side nor the roster's names tell which that is, only roster names are kept. An empty name is what a
 * replay that omitted one already holds, so the rest of the app reads the row the same way.
 */
export function scrimForExport(scrim: Scrim, roster: Set<string>): Scrim {
  const side = scrimSide(scrim, roster);
  const ourTeam = side === 'blue' ? 100 : side === 'red' ? 200 : null;
  return {
    ...scrim,
    players: scrim.players.map((p) =>
      (ourTeam !== null ? p.team === ourTeam : roster.has(`${p.name}#${p.tag}`.toLowerCase())) ? p : { ...p, name: '', tag: '' }
    )
  };
}

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
  | 'learnEntries'
  | 'trophies';

@Injectable({ providedIn: 'root' })
export class TeamDataService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly players = signal<Player[]>([]);
  /** The five who start: everyone not marked as a sub, in roster order. */
  readonly starters = computed(() => this.players().filter((p) => !p.sub));
  readonly fillIns = signal<FillIn[]>([]);
  readonly comps = signal<Comp[]>([]);
  readonly compResults = signal<CompResult[]>([]);
  /** Trophies and placings entered by hand, for the home page's cabinet. */
  readonly trophies = signal<Trophy[]>([]);
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

  /**
   * One line on a moment ("m:<index>") or a death ("d:<minute>:<seat>"); an
   * empty text takes the note down. With a drawing from the position lab
   * (Part C, 10 Sep 2026) the note is keyed on the second ("lab:<sec>") and
   * carries the drawing as `lab`, the text being the lab's own reading line;
   * a note without one never gets an empty `lab` key, so an old note and a
   * plain one read the same.
   */
  async saveFilmNote(matchId: string, key: string, text: string, lab?: FilmLabDrawing): Promise<void> {
    const trimmed = text.trim();
    const by = this.emailKey();
    const at = new Date().toISOString();
    const note: FilmNote = lab ? { text: trimmed, by, at, lab } : { text: trimmed, by, at };
    const current = this.notesFor(matchId);
    const notes = { ...(current?.notes ?? {}) };
    if (trimmed) notes[key] = note;
    else delete notes[key];
    this.filmNotes.set([...this.filmNotes().filter((n) => n.matchId !== matchId), { matchId, notes }]);
    if (this.mode !== 'firebase') return;
    const db = getDb();
    if (!db) return;
    await setDoc(doc(db, 'filmNotes', matchId), { matchId, notes: { [key]: trimmed ? note : deleteField() } }, { merge: true });
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
    this.trophies.set([...(data.trophies ?? [])].sort((a, b) => a.order - b.order));
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
    this.gameReviews.set([...(data.gameReviews ?? [])]);
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
      trophies: this.trophies(),
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
      gameReviews: this.gameReviews(),
      selfScout: this.selfScout() ?? undefined,
      resourceLinks: this.resourceLinks()
    };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  }

  /**
   * Everything the team entered by hand, as one plain object, for Download team data on Admin ›
   * Diagnostics (17 Sep 2026). A scrim block went with a mistaken delete on 15 Sep and came back
   * only from a snapshot taken for something else; this is a copy anyone with the page can keep.
   * Read off the signals, so it is what this tab holds at the click, in either mode. The reviews go
   * in because each was a paid call. Left out: the analysis, the champion traits, the self-scout,
   * the key health and the refresh log, which the functions and a Refresh write again; and the other
   * side's Riot ids in the replays (`scrimForExport`), which the app never shows. The scouted rosters
   * on an opponent stay: someone pasted those, and Prep & Draft prints them.
   */
  exportTeamData(): TeamDataExport {
    const roster = rosterIds(this.players());
    return {
      app: 'bom-squad',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings(),
      teamIdentity: this.teamIdentity(),
      resourceLinks: this.resourceLinks(),
      players: this.players(),
      fillIns: this.fillIns(),
      comps: this.comps(),
      compResults: this.compResults(),
      compOverrides: this.compOverrides(),
      practiceGames: this.practiceGames(),
      tournaments: this.tournaments(),
      tournamentSeries: this.tournamentSeries(),
      seriesGames: this.seriesGames(),
      scrims: this.scrims().map((s) => scrimForExport(s, roster)),
      scrimOpponents: this.scrimOpponents(),
      matchNotes: this.matchNotes(),
      filmNotes: this.filmNotes(),
      filmCommitments: this.filmCommitments(),
      plays: this.plays(),
      painPoints: this.painPoints(),
      learnEntries: this.learnEntries(),
      trophies: this.trophies(),
      gameReviews: this.gameReviews(),
      accessEntries: this.accessEntries()
    };
  }

  // ---- Firebase mode ----------------------------------------------------
  //
  // Members-only rules written 26 Sep 2026 (firestore.rules): every document but
  // meta/settings needs a signed-in account with an active access entry. A
  // listen the rules refuse ends for good (Firestore never retries it), and the
  // first listen goes out once Auth has settled its first state — null on the
  // login page. So listeners opened at construction were all refused there, and
  // after sign-in nothing opened them again: `ready` stayed false and the shell
  // sat on "Loading team data…" until a reload.
  //
  // So only meta/settings, which the signed-out shell prints the team name from,
  // opens at construction. Everything else opens when AuthService has let
  // someone in — `userEmail` is set only after its access check — and closes
  // when they leave or another account takes over, with the data emptied so the
  // last account's never lingers in memory and `ready` back to false. The whole
  // access list is an admin's alone, so it opens only while canManageUsers()
  // holds. Every listen carries an error callback: without one the SDK logs a
  // refusal as a console error, which the e2e sweeps fail on, and a refused
  // players listen must still settle `ready` rather than spin for ever.

  /** The unsubscribe of every open member listen, closed together. */
  private readonly memberListeners: Unsubscribe[] = [];
  /** Whose data the member listeners are open for; null while none are. */
  private listeningAs: string | null = null;
  private accessListener: Unsubscribe | null = null;
  private settingsListener: Unsubscribe | null = null;
  /** Bumped every time the member listeners close, so a refusal from a closed set is ignored. */
  private session = 0;
  /** The session a refusal was last reported in: one report a session, however many listens it refused. */
  private refusalReportedIn = -1;
  /** The session a member listen's refusal was last answered in (answerRefusal): one access check a session. */
  private refusalAnsweredIn = -1;

  private initFirebase(): void {
    const db = getDb();
    if (!db) {
      this.initLocal();
      return;
    }

    // Public on purpose (its own block in the rules): the signed-out topbar and footer print the team name.
    this.settingsListener = this.listen(
      doc(db, 'meta', 'settings'),
      (d) => this.settings.set((d.data() as Settings) ?? { teamName: '' }),
      (error) => this.reportRefusal('meta/settings', error)
    );

    // AuthService does not inject this service, so reading its signals here makes no cycle. The work runs
    // untracked: only who is signed in, and whether they manage users, may re-run it.
    effect(() => {
      const email = this.auth.userEmail();
      const admin = email !== null && this.auth.canManageUsers();
      untracked(() => this.followSession(db, email, admin));
    });

    inject(DestroyRef).onDestroy(() => {
      this.closeMemberListeners();
      this.settingsListener?.();
      this.settingsListener = null;
    });
  }

  /** Bring the listeners in line with who is signed in, and whether they may manage users. */
  private followSession(db: Firestore, email: string | null, admin: boolean): void {
    if (email !== this.listeningAs) {
      this.closeMemberListeners();
      if (email) this.openMemberListeners(db, email);
    }
    if (email && admin) {
      if (!this.accessListener) this.openAccessListener(db, email);
    } else if (this.accessListener) {
      this.closeAccessListener();
    }
  }

  private openMemberListeners(db: Firestore, email: string): void {
    this.listeningAs = email;
    const session = this.session;
    const listenList = (name: string, next: (snap: QuerySnapshot) => void) =>
      this.memberListeners.push(this.listen(collection(db, name), next, this.onRefused(name, session, email)));
    const listenMeta = (id: string, next: (snap: DocumentSnapshot) => void) =>
      this.memberListeners.push(this.listen(doc(db, 'meta', id), next, this.onRefused(`meta/${id}`, session, email)));

    listenList('players', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Player, 'id'>) }));
      this.players.set(list.sort((a, b) => a.order - b.order));
      this.ready.set(true);
    });
    listenList('fillIns', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FillIn, 'id'>) }));
      this.fillIns.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('comps', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comp, 'id'>) }));
      this.comps.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('scrims', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Scrim, 'id'>) }));
      this.scrims.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('scrimOpponents', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ScrimOpponent, 'id'>) }));
      this.scrimOpponents.set(list.sort((a, b) => a.order - b.order));
    });

    listenList('compResults', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CompResult, 'id'>) }));
      this.compResults.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('plays', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Play, 'id'>) }));
      this.plays.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('painPoints', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PainPoint, 'id'>) }));
      this.painPoints.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('learnEntries', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LearnEntry, 'id'>) }));
      this.learnEntries.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('trophies', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Trophy, 'id'>) }));
      this.trophies.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('tournaments', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) }));
      this.tournaments.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('tournamentSeries', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TournamentSeries, 'id'>) }));
      this.tournamentSeries.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('seriesGames', (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SeriesGame, 'id'>) }));
      this.seriesGames.set(list.sort((a, b) => a.order - b.order));
    });
    listenList('matchNotes', (snap) => {
      this.matchNotes.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchNote, 'id'>) })));
    });
    listenList('compOverrides', (snap) => {
      this.compOverrides.set(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CompOverride, 'id'>) }))
      );
    });
    listenList('practiceGames', (snap) => {
      this.practiceGames.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PracticeGame, 'id'>) })));
    });
    listenList('gameReviews', (snap) => {
      this.gameReviews.set(snap.docs.map((d) => d.data() as GameReview).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)));
    });
    listenList('filmCommitments', (snap) => {
      this.filmCommitments.set(snap.docs.map((d) => ({ ...(d.data() as FilmCommitment), matchId: d.id, by: (d.data() as FilmCommitment).by ?? {} })));
    });
    listenList('filmNotes', (snap) => {
      this.filmNotes.set(snap.docs.map((d) => ({ ...(d.data() as FilmNotes), matchId: d.id, notes: (d.data() as FilmNotes).notes ?? {} })));
    });
    listenMeta('teamIdentity', (d) => {
      this.teamIdentity.set((d.data() as TeamIdentity) ?? null);
    });
    listenMeta('selfScout', (d) => {
      this.selfScout.set((d.data() as SelfScout) ?? null);
    });
    listenMeta('refreshLog', (d) => {
      this.refreshLog.set((d.data() as RefreshLog) ?? null);
    });
    listenMeta('keyHealth', (d) => {
      this.keyHealth.set((d.data() as KeyHealth) ?? null);
    });
    listenMeta('compAnalysis', (d) => {
      this.compAnalysis.set((d.data() as CompAnalysis) ?? null);
    });
    listenMeta('championTraits', (d) => {
      this.championTraits.set((d.data() as ChampionTraitMap)?.traits ?? {});
    });
    listenMeta('resourceLinks', (d) => {
      const data = d.data() as { groups?: ResourceLinks } | undefined;
      this.resourceLinks.set(data?.groups ?? {});
    });
  }

  /** The whole access list, for Admin › Access and Download team data: an admin's alone under the rules. */
  private openAccessListener(db: Firestore, email: string): void {
    this.accessListener = this.listen(
      collection(db, 'access'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          email: d.id,
          ...(d.data() as Omit<AccessEntry, 'email'>)
        }));
        this.accessEntries.set(list.sort((a, b) => a.email.localeCompare(b.email)));
      },
      this.onRefused('access', this.session, email)
    );
  }

  private closeAccessListener(): void {
    this.accessListener?.();
    this.accessListener = null;
    this.accessEntries.set([]);
  }

  /** Close every member listen, empty what they held and say the data is not ready. meta/settings stays open. */
  private closeMemberListeners(): void {
    for (const stop of this.memberListeners.splice(0)) stop();
    this.closeAccessListener();
    this.listeningAs = null;
    this.session++;
    this.clearMemberData();
    this.ready.set(false);
  }

  /** Every signal a member listen fills, back to what it holds before the first snapshot. */
  private clearMemberData(): void {
    this.players.set([]);
    this.fillIns.set([]);
    this.comps.set([]);
    this.compResults.set([]);
    this.trophies.set([]);
    this.scrims.set([]);
    this.scrimOpponents.set([]);
    this.plays.set([]);
    this.painPoints.set([]);
    this.learnEntries.set([]);
    this.accessEntries.set([]);
    this.teamIdentity.set(null);
    this.selfScout.set(null);
    this.compAnalysis.set(null);
    this.tournaments.set([]);
    this.tournamentSeries.set([]);
    this.seriesGames.set([]);
    this.matchNotes.set([]);
    this.compOverrides.set([]);
    this.practiceGames.set([]);
    this.gameReviews.set([]);
    this.filmCommitments.set([]);
    this.filmNotes.set([]);
    this.championTraits.set({});
    this.keyHealth.set(null);
    this.refreshLog.set(null);
    this.resourceLinks.set({});
  }

  /**
   * What a refused listen does. The SDK has already dropped it; a later sign-in opens a fresh one. A refused players
   * listen settles `ready`, so the page shows empty rather than "Loading team data…" for ever.
   */
  private onRefused(name: string, session: number, email: string): (error: FirestoreError) => void {
    return (error) => {
      if (session !== this.session) return;
      if (name === 'players') this.ready.set(true);
      // Signing out (or into another account) re-sends the open listens under the new token before the effect has
      // closed them. Their refusal is the expected end of this session, not something to report.
      if (this.auth.userEmail() !== email) return;
      void this.answerRefusal(name, error, session, email);
    };
  }

  /**
   * A refusal while the person is still signed in, answered once a session however many listens it takes down.
   *
   * The rules refusing a signed-in member almost always means their access went while the app was open: an admin
   * unticked Active on Admin › Access or removed the entry. AuthService read the entry only at sign-in, and the
   * refusals arrive at the next stream restart (a token refresh, at most an hour, or a reconnect). Left alone, that tab
   * went on showing the last snapshot, frozen, with the nav still up, until a reload. So a `permission-denied` asks
   * AuthService whether they are still let in; when they are not it signs them out, and the session effects close
   * and empty everything here and take the page to the login. Nothing is reported for them: clientErrors is a
   * member's to write, and the row would be refused too.
   *
   * Still let in, or the question itself could not be read, is the rules and the app disagreeing, and that is
   * reported.
   */
  private async answerRefusal(name: string, error: FirestoreError, session: number, email: string): Promise<void> {
    // The access list is refused alone when an admin is demoted, so it does not use up the session's one check.
    if (name !== 'access') {
      if (this.refusalAnsweredIn === session) return;
      this.refusalAnsweredIn = session;
    }
    if (error.code === 'permission-denied') {
      let stillIn = true;
      try {
        stillIn = await this.auth.confirmAccess();
      } catch {
        // Could not ask; report the refusal as it stands.
      }
      if (!stillIn || session !== this.session || this.auth.userEmail() !== email) return;
      // Still in, but no longer an admin: the check took the role back and the effect closes the access list.
      if (name === 'access' && !this.auth.canManageUsers()) return;
    }
    this.reportRefusal(name, error);
  }

  /**
   * As a warning and a row in the app's error log (Admin › Diagnostics), never console.error: a refusal is a state
   * the app can reach without a bug in it, and the e2e sweeps fail on console errors. The row is what tells an admin
   * which collection the rules and the app disagree about. Only a member can write one: for an account whose access
   * was withdrawn the write is refused and swallowed, which is why a withdrawn account is signed out rather than
   * reported (answerRefusal). Once a session.
   */
  private reportRefusal(name: string, error: FirestoreError): void {
    if (this.refusalReportedIn === this.session) return;
    this.refusalReportedIn = this.session;
    const message = `Firestore refused the ${name} listener (${error.code})`;
    console.warn(`${message}. It stays empty until the next sign-in; any further refusal this session goes unlogged.`);
    this.reportError(new Error(message));
  }

  /** The app's error log, behind a method so a spec never writes to Firestore. */
  protected reportError(error: Error): void {
    void reportClientError(error);
  }

  /** One Firestore listen, behind a method so a spec can stand in for Firestore (the ReplayRecordingService pattern). */
  protected listen(target: Query, next: (snap: QuerySnapshot) => void, error: (error: FirestoreError) => void): Unsubscribe;
  protected listen(target: DocumentReference, next: (snap: DocumentSnapshot) => void, error: (error: FirestoreError) => void): Unsubscribe;
  protected listen(
    target: Query | DocumentReference,
    next: ((snap: QuerySnapshot) => void) | ((snap: DocumentSnapshot) => void),
    error: (error: FirestoreError) => void
  ): Unsubscribe {
    return target.type === 'document'
      ? onSnapshot(target, next as (snap: DocumentSnapshot) => void, error)
      : onSnapshot(target, next as (snap: QuerySnapshot) => void, error);
  }

  /**
   * One-time import of SEED_DATA into Firestore. Safe to run only on an empty project.
   *
   * An admin's alone, and only once signed in: the batch writes `access` and meta/settings, which the rules keep to
   * admins. The bootstrap admin needs no access document to be one, so on an empty project they sign in, open
   * Admin and seed. The marker read is meta/settings, the one public document, so it answers either way.
   */
  async seedFirestore(): Promise<void> {
    const db = getDb();
    if (!db) {
      throw new Error('Firebase is not configured.');
    }
    if (!this.auth.userEmail() || !this.auth.canManageUsers()) {
      throw new Error('Only a signed-in admin can seed the database.');
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
    for (const trophy of SEED_DATA.trophies ?? []) {
      const { id, ...rest } = trophy;
      batch.set(doc(db, 'trophies', id), rest);
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

  /** Returns the new id, as createTournament does: the roster importer enriches and can undo what it made. */
  async createPlayer(data: Omit<Player, 'id' | 'order'>): Promise<string> {
    const player: Player = { ...data, id: this.newId('player'), order: this.nextOrder(this.players()) };
    await this.persistUpsert('players', this.players, player);
    return player.id;
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

  /**
   * Put a deleted series and its games back under their own ids (15 Sep 2026, the Undo on a delete). Written whole,
   * as they were read, so nothing is re-derived; the games are not diffed into the draft log again. A game that can
   * no longer go back as it was (`restoreBlock`) is left out, and the reasons are returned for the toast.
   */
  async restoreSeries(series: TournamentSeries, games: readonly SeriesGame[]): Promise<string[]> {
    const writes: Promise<void>[] = [this.persistUpsert('tournamentSeries', this.tournamentSeries, series)];
    const skipped: string[] = [];
    for (const game of games) {
      const why = this.restoreBlock(game, series);
      if (why) skipped.push(`game ${game.gameNumber}: ${why}`);
      else writes.push(this.persistUpsert('seriesGames', this.seriesGames, game));
    }
    await Promise.all(writes);
    return skipped;
  }

  /**
   * Put a deleted game back under its own id, with the replay record that went with it unless one has been saved
   * under that id since. Returns why it could not go back, or null when it did.
   */
  async restoreSeriesGame(game: SeriesGame, scrim?: Scrim): Promise<string | null> {
    const why = this.restoreBlock(game);
    if (why) return why;
    const writes = [this.persistUpsert('seriesGames', this.seriesGames, game)];
    if (scrim && !this.scrims().some((s) => s.id === scrim.id)) writes.push(this.persistUpsert('scrims', this.scrims, scrim));
    await Promise.all(writes);
    return null;
  }

  /**
   * Why a deleted game cannot go back as it was, or null: its series is gone, its number (or the last slot of a
   * best-of) has been filled since, or its replay now belongs to another game. Undo stays up for seconds, and a
   * Game 3 added in them used to leave a series with two of them.
   */
  private restoreBlock(game: SeriesGame, seriesBeingRestored?: TournamentSeries): string | null {
    const series = seriesBeingRestored ?? this.tournamentSeries().find((s) => s.id === game.seriesId);
    if (!series) return 'its series has been deleted';
    const others = this.seriesGames().filter((g) => g.id !== game.id);
    const siblings = others.filter((g) => g.seriesId === game.seriesId);
    if (siblings.some((g) => g.gameNumber === game.gameNumber)) return `game ${game.gameNumber} has been added again since`;
    if (series.bestOf > 0 && siblings.length >= series.bestOf) return 'the series is full';
    if (game.matchId && others.some((g) => g.matchId === game.matchId)) return 'its replay is linked to another game now';
    return null;
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
    const gone = this.seriesGames().find((g) => g.id === id);
    if (gone) void this.logDeletedGame(gone);
    return this.persistRemove('seriesGames', this.seriesGames, id);
  }

  /**
   * A deleted game leaves its last board in the draft log (15 Sep 2026): deletes used to leave no trace, so the one
   * way back for a scrim block deleted by mistake was a snapshot taken for something else.
   */
  private async logDeletedGame(game: SeriesGame): Promise<void> {
    if (this.mode !== 'firebase') return;
    const db = getDb();
    if (!db) return;
    const at = new Date();
    const id = `${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)}-${game.id.slice(-6)}-del`;
    const opponent = this.tournamentSeries().find((s) => s.id === game.seriesId)?.opponent;
    const event: Omit<DraftEvent, 'id'> = {
      at: at.toISOString(),
      by: getAuthInstance()?.currentUser?.email ?? 'unknown',
      seriesId: game.seriesId,
      gameId: game.id,
      gameNumber: game.gameNumber,
      stepBefore: game.draftStep ?? 0,
      stepAfter: 0,
      changes: [
        `Deleted game ${game.gameNumber}${opponent ? ` vs ${opponent}` : ''}${game.win === undefined ? '' : game.win ? ', a win' : ', a loss'}${game.matchId ? ` (replay ${game.matchId})` : ''}`
      ],
      kinds: ['delete'],
      board: {
        ...(game.ourSide ? { ourSide: game.ourSide } : {}),
        bans: (game.bans ?? []).filter(Boolean),
        ourChampions: game.ourChampions ?? [],
        theirChampions: game.theirChampions ?? []
      }
    };
    try {
      await setDoc(doc(db, 'draftEvents', id), stripUndefined(event as unknown as Record<string, unknown>));
    } catch (error) {
      console.warn('Draft log write failed', error);
    }
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

  // ---- Trophies ---------------------------------------------------------

  async createTrophy(data: Omit<Trophy, 'id' | 'order'>): Promise<string> {
    const trophy: Trophy = { ...data, id: this.newId('trophy'), order: this.nextOrder(this.trophies()) };
    await this.persistUpsert('trophies', this.trophies, trophy);
    return trophy.id;
  }

  updateTrophy(trophy: Trophy): Promise<void> {
    return this.persistUpsert('trophies', this.trophies, trophy);
  }

  deleteTrophy(id: string): Promise<void> {
    return this.persistRemove('trophies', this.trophies, id);
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
      // Stripped first: a blank motto or no banner arrives as undefined, and Firestore refuses the whole write over one.
      if (db) await setDoc(doc(db, 'meta', 'settings'), stripUndefined(settings as unknown as Record<string, unknown>));
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
