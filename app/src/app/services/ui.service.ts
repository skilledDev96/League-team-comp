import { Injectable, inject } from '@angular/core';
import { Role, SummonerProfile } from '../models/team.models';
import { ChampionDataService } from './champion-data.service';

const CHAMP_SLUG_MAP: Record<string, string> = {
  "Bel'Veth": 'belveth',
  "Vel'Koz": 'velkoz',
  'Dr. Mundo': 'drmundo',
  'Miss Fortune': 'missfortune'
};

const CHAMP_DDRAGON_MAP: Record<string, string> = {
  "Bel'Veth": 'Belveth',
  "Vel'Koz": 'Velkoz',
  'Dr. Mundo': 'DrMundo',
  'Miss Fortune': 'MissFortune',
  'Jarvan IV': 'JarvanIV',
  "Kai'Sa": 'Kaisa',
  "Kha'Zix": 'Khazix',
  "Kog'Maw": 'KogMaw',
  LeBlanc: 'Leblanc',
  'Nunu & Willump': 'Nunu',
  "Rek'Sai": 'RekSai',
  'Renata Glasc': 'Renata',
  'Tahm Kench': 'TahmKench',
  'Twisted Fate': 'TwistedFate',
  'Xin Zhao': 'XinZhao',
  'Aurelion Sol': 'AurelionSol',
  "Cho'Gath": 'Chogath',
  Wukong: 'MonkeyKing'
};

const ROLE_BADGE: Record<string, string> = {
  Top: 'TOP',
  Jungle: 'JG',
  Mid: 'MID',
  ADC: 'ADC',
  Support: 'SUP'
};

const PLAYSTYLE_ICONS: { test: RegExp; icon: string }[] = [
  { test: /selfless/, icon: 'volunteer_activism' },
  { test: /late bloomer/, icon: 'eco' },
  { test: /ultimate predator/, icon: 'pets' },
  { test: /third eye/, icon: 'visibility' },
  { test: /generalist/, icon: 'psychology' }
];

@Injectable({ providedIn: 'root' })
export class UiService {
  readonly assetsBase = 'assets/summoners';

  private readonly champions = inject(ChampionDataService);

  championSlug(championName: string): string {
    return CHAMP_SLUG_MAP[championName] ?? championName.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  championDDragonName(championName: string): string {
    // Prefer the live Data Dragon index; fall back to the static maps.
    return (
      this.champions.resolveId(championName) ??
      CHAMP_DDRAGON_MAP[championName] ??
      championName.replace(/[^A-Za-z0-9]/g, '')
    );
  }

  championIconUrl(championName: string): string {
    const version = this.champions.version();
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${this.championDDragonName(championName)}.png`;
  }

  /** Riot class tags (Fighter, Mage, …) once the champion index has loaded. */
  championTags(championName: string): string[] {
    return this.champions.tags(championName);
  }

  championBuildUrl(championName: string): string {
    return `https://u.gg/lol/champions/${this.championSlug(championName)}/build`;
  }

  summonerIconUrl(iconRef?: string, basePath = this.assetsBase): string {
    if (!iconRef) {
      return '';
    }
    if (iconRef.startsWith('http://') || iconRef.startsWith('https://')) {
      return iconRef;
    }
    return `${basePath}/${iconRef}`;
  }

  summonerSearchUrl(name: string, profile?: SummonerProfile): string {
    if (profile?.region && profile.opggSlug) {
      return `https://op.gg/lol/summoners/${profile.region}/${profile.opggSlug}`;
    }
    const region = profile?.region ?? 'euw';
    const riotTag = profile?.riotTag ?? region.toUpperCase();
    return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(name)}-${encodeURIComponent(riotTag)}`;
  }

  summonerMobalyticsUrl(profile?: SummonerProfile): string {
    if (profile?.region && profile.mobalyticsSlug) {
      return `https://mobalytics.gg/lol/profile/${profile.region}/${encodeURIComponent(profile.mobalyticsSlug)}/overview`;
    }
    return '';
  }

  playstyleIcon(playstyleText?: string): string {
    const value = (playstyleText ?? '').toLowerCase();
    for (const entry of PLAYSTYLE_ICONS) {
      if (entry.test.test(value)) {
        return entry.icon;
      }
    }
    return 'track_changes';
  }

  roleBadgeText(role?: string): string {
    return ROLE_BADGE[role ?? ''] ?? role ?? '';
  }

  avatarInitial(name?: string): string {
    return name ? name.slice(0, 1).toUpperCase() : '?';
  }

  playerAnchorId(playerName: string): string {
    const safe = (playerName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `player-${safe}`;
  }

  parseCompLine(text: string): { champion: string; note: string } {
    const separator = ' - ';
    if (!text.includes(separator)) {
      return { champion: text.trim(), note: '' };
    }
    const index = text.indexOf(separator);
    return {
      champion: text.slice(0, index).trim(),
      note: text.slice(index + separator.length).trim()
    };
  }

  roleLabel(role: Role): string {
    return role;
  }
}
