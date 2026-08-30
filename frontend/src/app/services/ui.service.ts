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

  private static readonly MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  /**
   * Render a stored date as "05 Aug, 2026". Values are ISO from the date
   * pickers, but older records hold free text ("Sun 20:00"), so anything that
   * does not parse is passed through untouched rather than shown as garbage.
   */
  formatDay(value: string | undefined | null): string {
    const date = this.parseDate(value);
    if (!date) return value ?? '';
    const day = String(date.getDate()).padStart(2, '0');
    return `${day} ${UiService.MONTHS[date.getMonth()]}, ${date.getFullYear()}`;
  }

  /** Same as formatDay, plus the time when the value carries one. */
  formatDayTime(value: string | undefined | null): string {
    const date = this.parseDate(value);
    if (!date) return value ?? '';
    const hasTime = typeof value === 'string' && value.includes('T');
    if (!hasTime) return this.formatDay(value);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${this.formatDay(value)} · ${hh}:${mm}`;
  }

  private parseDate(value: string | undefined | null): Date | null {
    if (!value) return null;
    // A bare "YYYY-MM-DD" is parsed as UTC midnight, which renders as the day
    // before in any negative-offset timezone. Build it in local time instead.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

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

  /**
   * Splash art for the default skin, for the wide cards on the draft board.
   *
   * The **centered** splash, not Data Dragon's. Both are landscape and the same
   * scene, but Riot composes the centered one with the champion in the middle
   * precisely so it can be cropped to a wide strip — which is what a draft card
   * is. Data Dragon's splash places the champion wherever the art wants them,
   * so a wide crop of it clipped Darius at the forehead and left Brand as
   * mostly fire.
   *
   * The id is the Data Dragon one lowercased, which handles the awkward cases
   * on its own: MonkeyKing, Fiddlesticks, Bel'Veth and Kai'Sa all resolve.
   *
   * Deliberately unversioned — CommunityDragon serves `latest`, so this keeps
   * working across patches by itself.
   */
  championArtUrl(championName: string): string {
    const id = this.championDDragonName(championName).toLowerCase();
    return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/${id}/skins/base/images/${id}_splash_centered_0.jpg`;
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
