import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';
import { PlayerQueueStats, Role } from '../models/team.models';

interface EnrichRequest {
  summonerName: string;
  riotTag?: string;
  region?: string;
  role?: Role;
  mobalyticsSlug?: string;
}

interface EnrichResponse {
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  role?: Role;
  /** Positions played, most often first, with the games behind each. */
  positions?: { role: Role; games: number }[];
  /** Their pool in each seat, for a player who has changed role. */
  poolByRole?: Partial<Record<Role, string[]>>;
  /** Who beats them in each seat. */
  bansByRole?: Partial<Record<Role, string[]>>;
  top3?: string[];
  bans?: string[];
  queueStats?: {
    solo?: PlayerQueueStats;
    flex?: PlayerQueueStats;
    clash?: PlayerQueueStats;
  };
  iconUrl?: string;
  source: 'template' | 'provider';
  provider: string;
  generatedAt: string;
}

const DEFAULT_REGION = 'europe-west1';

const ROLE_TEMPLATES: Record<Role, Omit<EnrichResponse, 'generatedAt'>> = {
  Top: {
    playstyle: 'Lane-priority bruiser with side-lane threat and TP timing focus.',
    strengths: ['Strong wave control', 'Reliable flank setups', 'Objective setup discipline'],
    weaknesses: ['Can overextend in side lane', 'Needs cleaner herald-to-drake transitions', 'Vulnerable to early camp pressure'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Jungle: {
    playstyle: 'Tempo-oriented pathing with objective-first decision making.',
    strengths: ['Good route efficiency', 'Consistent objective tracking', 'High impact early skirmishes'],
    weaknesses: ['Can force low-percentage invades', 'Needs cleaner lane-cover timing', 'Occasional vision debt before objectives'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Mid: {
    playstyle: 'Wave-control mid with roam windows around jungle pressure.',
    strengths: ['Wave management under pressure', 'Strong river skirmish setups', 'Reliable teamfight positioning'],
    weaknesses: ['Roam timing can be late', 'Can overhold flash for picks', 'Needs tighter side-lane reset timing'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  ADC: {
    playstyle: 'Teamfight carry with spacing-first mindset and objective DPS focus.',
    strengths: ['Consistent damage output', 'Good lane trading patterns', 'Strong late-game positioning'],
    weaknesses: ['Can greed one extra wave', 'Needs cleaner trap around fog', 'Relies heavily on front-to-back setup'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Support: {
    playstyle: 'Vision-control support enabling engage or peel by draft context.',
    strengths: ['Objective vision discipline', 'Strong engage timing reads', 'Good lane matchup adaptation'],
    weaknesses: ['Can overcommit engage without cooldown checks', 'Roam windows occasionally too early', 'Needs faster ward reset cadence'],
    source: 'template',
    provider: 'built-in-role-template'
  }
};

function fallbackByRole(role: Role): EnrichResponse {
  const template = ROLE_TEMPLATES[role];
  return {
    ...template,
    generatedAt: new Date().toISOString()
  };
}

@Injectable({ providedIn: 'root' })
export class PlayerEnrichmentService {
  async enrichPlayer(request: EnrichRequest): Promise<EnrichResponse> {
    if (!request.summonerName.trim()) {
      throw new Error('Player name is required for enrichment.');
    }

    const role = request.role ?? 'Mid';

    if (!isFirebaseConfigured()) {
      return fallbackByRole(role);
    }

    const auth = getAuthInstance();
    const user = auth?.currentUser;
    if (!auth || !user) {
      throw new Error('Sign in first to use profile enrichment.');
    }

    const idToken = await user.getIdToken();
    const baseUrl = environment.functions?.enrichPlayerUrl || this.defaultFunctionUrl();

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        summonerName: request.summonerName.trim(),
        riotTag: request.riotTag?.trim() || undefined,
        region: request.region?.trim().toLowerCase() || undefined,
        role,
        mobalyticsSlug: request.mobalyticsSlug?.trim() || undefined
      })
    });

    const data = (await response.json()) as Partial<EnrichResponse> & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Profile enrichment failed.');
    }

    return {
      playstyle: data.playstyle ?? '',
      strengths: data.strengths ?? [],
      weaknesses: data.weaknesses ?? [],
      role: data.role,
      // Rebuilt field by field rather than spread, so anything added to the
      // response has to be added here too or it is silently dropped on the way
      // in. These two were, and the positions never reached the screen.
      positions: data.positions,
      poolByRole: data.poolByRole,
      bansByRole: data.bansByRole,
      top3: data.top3,
      bans: data.bans,
      queueStats: data.queueStats,
      iconUrl: data.iconUrl,
      source: data.source === 'provider' ? 'provider' : 'template',
      provider: data.provider ?? 'unknown',
      generatedAt: data.generatedAt ?? new Date().toISOString()
    };
  }

  private defaultFunctionUrl(): string {
    const projectId = environment.firebase.projectId;
    const region = environment.functions?.region || DEFAULT_REGION;
    return `https://${region}-${projectId}.cloudfunctions.net/enrichPlayer`;
  }

  /**
   * Fold Riot's champion list into the one already on the player instead of
   * replacing it. A hand-curated pool is deliberate — and the first entry is
   * shown as the Main Champion — so existing picks keep their place and their
   * order, and anything new is appended.
   */
  mergeChampionPool(existing: string[] | undefined, incoming: string[] | undefined): string[] {
    const norm = (name: string) => (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const merged = [...(existing ?? [])];
    const seen = new Set(merged.map(norm));
    for (const champ of incoming ?? []) {
      if (champ && !seen.has(norm(champ))) {
        merged.push(champ);
        seen.add(norm(champ));
      }
    }
    return merged;
  }
}
