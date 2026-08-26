import { Injectable, signal } from '@angular/core';

// Used until the live version is fetched (and if the network is unavailable).
const FALLBACK_VERSION = '14.24.1';
const CACHE_KEY = 'bom-ddragon-v1';
const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';

/** A single champion as we need it across the app. */
export interface ChampionInfo {
  /** Data Dragon id / icon filename stem, e.g. "Maokai", "MonkeyKing". */
  id: string;
  /** Numeric key as a string. */
  key: string;
  /** Display name, e.g. "Maokai", "Wukong", "Miss Fortune". */
  name: string;
  title: string;
  /** Riot class tags: Fighter, Tank, Mage, Assassin, Marksman, Support. */
  tags: string[];
}

interface CacheShape {
  version: string;
  champions: ChampionInfo[];
}

interface DdragonChampionEntry {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
}

/**
 * Loads the current champion list from Data Dragon and caches it in
 * localStorage. Everything is served from signals so views update once the
 * live data arrives; lookups fall back gracefully before it does.
 */
@Injectable({ providedIn: 'root' })
export class ChampionDataService {
  readonly version = signal<string>(FALLBACK_VERSION);
  readonly champions = signal<ChampionInfo[]>([]);
  readonly ready = signal(false);

  // normalized name / id -> champion, so lookups tolerate spaces and punctuation.
  private byNorm = new Map<string, ChampionInfo>();

  constructor() {
    this.hydrateFromCache();
    void this.refresh();
  }

  /** Strip to lowercase alphanumerics so "Miss Fortune" == "missfortune" == "MissFortune". */
  normalize(name: string): string {
    return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  resolve(name: string): ChampionInfo | undefined {
    return this.byNorm.get(this.normalize(name));
  }

  /** Data Dragon id for a champion name, or undefined if not resolved yet. */
  resolveId(name: string): string | undefined {
    return this.resolve(name)?.id;
  }

  tags(name: string): string[] {
    return this.resolve(name)?.tags ?? [];
  }

  iconUrl(name: string): string {
    const id = this.resolveId(name) ?? (name ?? '').replace(/[^A-Za-z0-9]/g, '');
    return `https://ddragon.leagueoflegends.com/cdn/${this.version()}/img/champion/${id}.png`;
  }

  /** Name-prefix/substring search for pickers (e.g. a future draft board). */
  search(query: string, limit = 12): ChampionInfo[] {
    const q = this.normalize(query);
    if (!q) return this.champions().slice(0, limit);
    return this.champions()
      .filter((c) => this.normalize(c.name).includes(q))
      .slice(0, limit);
  }

  // ---- Loading ----------------------------------------------------------

  private setChampions(version: string, champions: ChampionInfo[]): void {
    this.version.set(version);
    this.champions.set(champions);
    this.byNorm = new Map();
    for (const champ of champions) {
      this.byNorm.set(this.normalize(champ.name), champ);
      // Index by id too, so "MonkeyKing"/"MissFortune" resolve as well as names.
      this.byNorm.set(this.normalize(champ.id), champ);
    }
    this.ready.set(champions.length > 0);
  }

  private hydrateFromCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as CacheShape;
      if (cached?.champions?.length) {
        this.setChampions(cached.version || FALLBACK_VERSION, cached.champions);
      }
    } catch {
      // Ignore corrupt cache; a refresh will repopulate it.
    }
  }

  private writeCache(data: CacheShape): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable; the in-memory data still works this session.
    }
  }

  /** Fetch the latest version and, if it changed, the champion index for it. */
  private async refresh(): Promise<void> {
    try {
      const versions = (await this.fetchJson(VERSIONS_URL)) as string[] | null;
      const latest = versions?.[0];
      if (!latest) return;
      if (latest === this.version() && this.champions().length) {
        return; // Cache already matches the live version.
      }
      const url = `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`;
      const payload = (await this.fetchJson(url)) as
        | { data: Record<string, DdragonChampionEntry> }
        | null;
      if (!payload?.data) return;
      const champions: ChampionInfo[] = Object.values(payload.data)
        .map((c) => ({ id: c.id, key: c.key, name: c.name, title: c.title, tags: c.tags ?? [] }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.setChampions(latest, champions);
      this.writeCache({ version: latest, champions });
    } catch {
      // Offline or blocked: keep whatever the cache/fallback gave us.
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  }
}
