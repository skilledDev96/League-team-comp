import { Injectable, WritableSignal, signal } from '@angular/core';
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
import { SEED_DATA } from '../data/seed-data';
import {
  Comp,
  CompResult,
  Play,
  AccessEntry,
  FillIn,
  MacroSummary,
  Player,
  ResourceLinks,
  Settings,
  TeamData,
  TeamIdentity
} from '../models/team.models';
import { normalizeEmail } from '../core/access';

const LOCAL_KEY = 'bom-team-data';

type EntityKey = 'players' | 'fillIns' | 'comps' | 'compResults' | 'plays';

// Firestore rejects any field set to undefined; drop those keys (incl. one level of nested objects).
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result = {} as T;
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) {
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key as keyof T] = stripUndefined(val as Record<string, unknown>) as T[keyof T];
    } else {
      result[key as keyof T] = val as T[keyof T];
    }
  }
  return result;
}

@Injectable({ providedIn: 'root' })
export class TeamDataService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly players = signal<Player[]>([]);
  readonly fillIns = signal<FillIn[]>([]);
  readonly comps = signal<Comp[]>([]);
  readonly compResults = signal<CompResult[]>([]);
  readonly plays = signal<Play[]>([]);
  readonly accessEntries = signal<AccessEntry[]>([]);
  readonly teamIdentity = signal<TeamIdentity | null>(null);
  readonly macroSummary = signal<MacroSummary | null>(null);
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
    this.plays.set([...(data.plays ?? [])].sort((a, b) => a.order - b.order));
    this.accessEntries.set([{ email: 'ruanhart7@gmail.com', role: 'admin', active: true }]);
    this.teamIdentity.set(data.teamIdentity);
    this.macroSummary.set(data.macroSummary);
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
      plays: this.plays(),
      teamIdentity: this.teamIdentity() ?? SEED_DATA.teamIdentity,
      macroSummary: this.macroSummary() ?? SEED_DATA.macroSummary,
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
    onSnapshot(collection(db, 'compResults'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CompResult, 'id'>) }));
      this.compResults.set(list.sort((a, b) => a.order - b.order));
    });
    onSnapshot(collection(db, 'plays'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Play, 'id'>) }));
      this.plays.set(list.sort((a, b) => a.order - b.order));
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
    onSnapshot(doc(db, 'meta', 'macro'), (d) => {
      this.macroSummary.set((d.data() as MacroSummary) ?? null);
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
    batch.set(doc(db, 'access', 'ruanhart7@gmail.com'), {
      email: 'ruanhart7@gmail.com',
      role: 'admin',
      active: true
    });
    batch.set(doc(db, 'meta', 'teamIdentity'), SEED_DATA.teamIdentity);
    batch.set(doc(db, 'meta', 'macro'), SEED_DATA.macroSummary);
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
    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return;
      const { id, ...rest } = entity;
      await setDoc(doc(db, key, id), stripUndefined(rest as Record<string, unknown>));
      return;
    }
    const current = sig();
    const exists = current.some((item) => item.id === entity.id);
    const next = exists
      ? current.map((item) => (item.id === entity.id ? entity : item))
      : [...current, entity];
    sig.set([...next].sort((a, b) => a.order - b.order));
    this.persistLocal();
  }

  private async persistRemove<T extends { id: string }>(
    key: EntityKey,
    sig: WritableSignal<T[]>,
    id: string
  ): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (!db) return;
      await deleteDoc(doc(db, key, id));
      return;
    }
    sig.set(sig().filter((item) => item.id !== id));
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

  async updateMacro(macro: MacroSummary): Promise<void> {
    if (this.mode === 'firebase') {
      const db = getDb();
      if (db) await setDoc(doc(db, 'meta', 'macro'), macro);
    } else {
      this.macroSummary.set(macro);
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
