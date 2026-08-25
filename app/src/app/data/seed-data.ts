import { TeamData } from '../models/team.models';

// One-time migration source. Mirrors the original scripts/team-data.js content,
// reshaped into the normalized structure used by Firestore.
export const SEED_DATA: TeamData = {
  settings: { teamName: 'Bom Squad' },
  players: [
    {
      id: 'rulukuku',
      name: 'Rulukuku',
      role: 'Top',
      icon: 'rulukuku.webp',
      playstyle: 'Late Bloomer',
      strengths: ['vision', 'consistency', 'late-game'],
      weaknesses: ['farming', 'fighting', 'aggression', 'survivability'],
      top3: ['Yorick', 'Mordekaiser', 'Vladimir'],
      bans: ['Fiora', 'Camille', 'Quinn', 'Jayce'],
      profile: { region: 'euw', opggSlug: 'RULUKUKULUKU-EUW', riotTag: 'EUW', mobalyticsSlug: 'rulukukuluku-euw' },
      order: 0
    },
    {
      id: 'go10x',
      name: 'Go10x',
      role: 'Jungle',
      icon: 'go10x.png',
      playstyle: 'Ultimate Predator',
      strengths: ['fighting', 'tempo', 'objectives', 'vision'],
      weaknesses: ['survivability', 'flex farming'],
      top3: ['Udyr', 'Diana', 'Vi'],
      bans: ['Rengar', 'Elise', 'Nidalee', 'Graves'],
      profile: { region: 'euw', opggSlug: 'Go10x-EUW', riotTag: 'EUW', mobalyticsSlug: 'go10x-euw' },
      order: 1
    },
    {
      id: 'drunkenbannana',
      name: 'DrunkenBannana',
      role: 'Mid',
      icon: 'drunkenbannana.png',
      playstyle: 'Generalist',
      strengths: ['vision', 'farming', 'aggression', 'versatility'],
      weaknesses: ['survivability', 'objectives', 'consistency'],
      top3: ['Yasuo', 'Ahri', 'Akali'],
      bans: ['Zed', 'Qiyana', 'Talon', 'Xerath', 'Ziggs'],
      profile: { region: 'euw', opggSlug: 'DrunkenBannana-EUW', riotTag: 'EUW', mobalyticsSlug: 'drunkenbannana-euw' },
      order: 2
    },
    {
      id: 'skilledscarecrow',
      name: 'SkilledScarecrow',
      role: 'ADC',
      icon: 'skilledscarecrow.webp',
      playstyle: 'Third Eye',
      strengths: ['vision', 'consistency', 'objectives'],
      weaknesses: ['survivability', 'fighting'],
      top3: ['Miss Fortune', 'Jhin', 'Tristana'],
      bans: ['Draven', 'Caitlyn', 'Varus', 'Ashe'],
      profile: { region: 'euw', opggSlug: 'SkilledScarecrow-42096', riotTag: '42096', mobalyticsSlug: 'skilledscarecrow-42096' },
      order: 3
    },
    {
      id: 'dawhitehammer',
      name: 'DaWhiteHammer',
      role: 'Support',
      icon: 'dawhitehammer.webp',
      playstyle: 'Generalist / Selfless',
      strengths: ['utility', 'vision', 'versatility'],
      weaknesses: ['survivability', 'objective impact'],
      top3: ['Leona', 'Nautilus', 'Lux'],
      bans: ['Blitzcrank', 'Pyke', 'Brand', 'Xerath'],
      profile: { region: 'euw', opggSlug: 'DaWhiteHammer-EUW', riotTag: 'EUW', mobalyticsSlug: 'dawhitehammer-euw' },
      order: 4
    }
  ],
  fillIns: [
    {
      id: 'sirstonedalott',
      summoner: 'SirStonedAlott',
      status: 'provisional',
      preferredRoles: ['Top'],
      note: 'Joined for a recent match; role likely top. Confirm tomorrow before locking in roster.',
      profile: { region: 'euw', mobalyticsSlug: 'sir stonedalot-euw' },
      order: 0
    }
  ],
  comps: [
    {
      id: 'engage',
      name: 'Engage',
      order: 0,
      picks: {
        Top: 'Maokai - hard engage frontline',
        Jungle: 'Vi - guaranteed lockdown',
        Mid: 'Galio - follow-up engage + peel',
        ADC: 'Miss Fortune - AoE wombo finisher',
        Support: 'Leona - reliable engage chain'
      },
      gamePlan: {
        early: 'Weakside top, funnel bot; jungle paths bot-side for early skirmishes.',
        mid: 'Group as 5 and look for Galio/Leona engage onto a caught-out target.',
        late: 'Wait for the MF ult wombo — flank with Vi, chain CC, then front-to-back.'
      },
      bans: ['Janna', 'Tahm Kench', 'Yuumi']
    },
    {
      id: 'pick',
      name: 'Pick',
      order: 1,
      picks: {
        Top: 'Renekton - point-and-click stun',
        Jungle: 'Udyr - fast pick setups',
        Mid: 'Ahri - charm picks',
        ADC: 'Jhin - long-range pick follow-up',
        Support: 'Lux - bind to burst'
      }
    },
    {
      id: 'dive',
      name: 'Dive',
      order: 2,
      picks: {
        Top: 'Vladimir - backline dive',
        Jungle: 'Diana - AoE dive + wombo',
        Mid: 'Yasuo - synergizes with Diana',
        ADC: 'Tristana - self-peel dive ADC',
        Support: 'Nautilus - guaranteed engage'
      }
    },
    {
      id: 'wombo',
      name: 'Wombo',
      order: 3,
      picks: {
        Top: 'Mordekaiser - isolate key target',
        Jungle: 'Sejuani - AoE lockdown',
        Mid: 'Yone - massive AoE follow-up',
        ADC: 'Miss Fortune - AoE cleanup',
        Support: 'Mel - AoE CC + setup'
      }
    },
    {
      id: 'skirmish',
      name: 'Skirmish',
      order: 4,
      picks: {
        Top: 'Garen - simple, strong skirmisher',
        Jungle: 'Udyr - fast 2v2/3v3 tempo',
        Mid: 'Akali - high-damage skirmisher',
        ADC: 'Yasuo - melee DPS flex',
        Support: 'Zilean - speed + revive'
      }
    },
    {
      id: 'poke',
      name: 'Poke',
      order: 5,
      picks: {
        Top: 'Maokai - sapling poke + frontline',
        Jungle: "Bel'Veth - sustained DPS",
        Mid: 'Azir - long-range poke + zone control',
        ADC: 'Ashe - poke + slows',
        Support: "Vel'Koz - long-range poke burst"
      }
    },
    {
      id: 'fronttoback',
      name: 'FrontToBack',
      order: 6,
      picks: {
        Top: 'Dr. Mundo - unkillable frontline',
        Jungle: 'Sejuani - tank engage',
        Mid: 'Syndra - burst + zone control',
        ADC: 'Miss Fortune - AoE teamfight DPS',
        Support: 'Nautilus - peel + engage'
      }
    }
  ],
  compResults: [],
  plays: [],
  painPoints: [],
  learnEntries: [],
  teamIdentity: {
    visionDriven: true,
    objectiveFocused: true,
    primaryPlaystyle: ['Engage', 'AoE teamfight'],
    jungleTempo: 'tempo jungle',
    damageProfile: 'double-carry damage',
    midRole: 'utility mid',
    lateGameFrontline: 'late-game tank frontline'
  },
  tournaments: [
    {
      id: 'oryx-2026-split2',
      name: 'Oryx Fearless League 2026 — Split 2',
      organiser: 'Oryx Esports',
      division: 'Second Division',
      format: 'Bo3 Fearless Draft — Swiss stage, 1 series per week',
      startDate: '2026-08-31',
      endDate: '2026-11-08',
      notes:
        'Fearless Draft: a champion can only be played once per series by BOTH teams. ' +
        'Scheduling is agreed on Discord/WhatsApp and must be confirmed before Thursday; ' +
        'default match time is Sunday 20:00. Game 1 side is decided by a 1v1 (first tower, ' +
        'first blood, first to 50 CS).',
      active: true,
      order: 0
    }
  ],
  tournamentSeries: [],
  seriesGames: [],
  resourceLinks: {
    DraftTools: [
      { label: 'U.GG Tier Lists', url: 'https://u.gg/lol/tier-list' },
      { label: 'Mobalytics Team Comps', url: 'https://mobalytics.gg/lol/team-comps' },
      { label: 'Probuild Stats', url: 'https://probuildstats.com/' }
    ],
    MacroAndObjectives: [
      { label: 'Dragon/Objective Timers', url: 'https://leagueoflegends.fandom.com/wiki/Monster' },
      { label: 'Map Objective Guide', url: 'https://mobalytics.gg/blog/lol-macro-guide/' }
    ],
    MatchupResearch: [
      { label: 'CounterStats', url: 'https://www.counterstats.net/' },
      { label: 'Lolalytics', url: 'https://lolalytics.com/' }
    ]
  }
};
