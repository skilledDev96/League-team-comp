export type Role = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export const ROLES: Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

export type AccessRole = 'admin' | 'contributor' | 'viewer';

export interface AccessEntry {
  email: string;
  role: AccessRole;
  active: boolean;
}

export interface SummonerProfile {
  region: string;
  opggSlug?: string;
  riotTag?: string;
  mobalyticsSlug?: string;
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  icon?: string;
  playstyle?: string;
  strengths: string[];
  weaknesses: string[];
  top3: string[];
  learn?: string;
  bans: string[];
  profile?: SummonerProfile;
  order: number;
}

export interface FillIn {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string[];
  note?: string;
  icon?: string;
  profile?: SummonerProfile;
  order: number;
}

export type CompPicks = Record<Role, string>;

export interface Comp {
  id: string;
  name: string;
  picks: CompPicks;
  order: number;
}

export interface TeamIdentity {
  visionDriven: boolean;
  objectiveFocused: boolean;
  primaryPlaystyle: string[];
  jungleTempo: string;
  damageProfile: string;
  midRole: string;
  lateGameFrontline: string;
}

export interface MacroPhase {
  strategy: string[];
}

export interface MacroEarlyGame extends MacroPhase {
  top: string;
  mid: string;
  bot: string;
  junglePath: string;
}

export interface MacroSummary {
  earlyGame: MacroEarlyGame;
  midGame: MacroPhase;
  lateGame: MacroPhase;
}

export interface ResourceLink {
  label: string;
  url: string;
}

export type ResourceLinks = Record<string, ResourceLink[]>;

export interface Settings {
  teamName: string;
}

export interface TeamData {
  settings: Settings;
  players: Player[];
  fillIns: FillIn[];
  comps: Comp[];
  teamIdentity: TeamIdentity;
  macroSummary: MacroSummary;
  resourceLinks: ResourceLinks;
}
