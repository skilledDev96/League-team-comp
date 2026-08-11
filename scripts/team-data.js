const TEAM_DATA = {
  teamName: "Bom Squad",
  team: {
    Top: "Rulukuku",
    Jungle: "Go10x",
    Mid: "DrunkenBannana",
    ADC: "SkilledScarecrow",
    Support: "DaWhiteHammer"
  },
  fillIns: [
    {
      summoner: "SirStonedAlott",
      status: "provisional",
      preferredRoles: ["Top"],
      note: "Joined for a recent match; role likely top. Confirm tomorrow before locking in roster."
    }
  ],
  summonerIcons: {
    Rulukuku: "rulukuku.webp",
    Go10x: "go10x.png",
    SkilledScarecrow: "skilledscarecrow.webp",
    DaWhiteHammer: "dawhitehammer.webp",
    DrunkenBannana: "drunkenbannana.png"
  },
  summonerProfiles: {
    SkilledScarecrow: {
      region: "euw",
      opggSlug: "SkilledScarecrow-42096",
      mobalyticsSlug: "skilledscarecrow-42096"
    }
  },
  playstyles: {
    Rulukuku: "Late Bloomer",
    Go10x: "Ultimate Predator",
    DrunkenBannana: "Generalist",
    SkilledScarecrow: "Third Eye",
    DaWhiteHammer: "Generalist / Selfless"
  },
  strengthsWeaknesses: {
    Rulukuku: {
      strengths: ["vision", "consistency", "late-game"],
      weaknesses: ["farming", "fighting", "aggression", "survivability"]
    },
    Go10x: {
      strengths: ["fighting", "tempo", "objectives", "vision"],
      weaknesses: ["survivability", "flex farming"]
    },
    DrunkenBannana: {
      strengths: ["vision", "farming", "aggression", "versatility"],
      weaknesses: ["survivability", "objectives", "consistency"]
    },
    SkilledScarecrow: {
      strengths: ["vision", "consistency", "objectives"],
      weaknesses: ["survivability", "fighting"]
    },
    DaWhiteHammer: {
      strengths: ["utility", "vision", "versatility"],
      weaknesses: ["survivability", "objective impact"]
    }
  },
  top3Champs: {
    Rulukuku: {
      top3: ["Yorick", "Mordekaiser", "Vladimir"],
      learn: "Maokai"
    },
    Go10x: {
      top3: ["Udyr", "Diana", "Vi"],
      learn: "Sejuani"
    },
    DrunkenBannana: {
      top3: ["Yasuo", "Ahri", "Akali"],
      learn: "Galio"
    },
    SkilledScarecrow: {
      top3: ["Miss Fortune", "Jhin", "Tristana"],
      learn: "Sivir"
    },
    DaWhiteHammer: {
      top3: ["Leona", "Nautilus", "Lux"],
      learn: "Mel"
    }
  },
  banRecommendations: {
    Rulukuku: ["Fiora", "Camille", "Quinn", "Jayce"],
    Go10x: ["Rengar", "Elise", "Nidalee", "Graves"],
    DrunkenBannana: ["Zed", "Qiyana", "Talon", "Xerath", "Ziggs"],
    SkilledScarecrow: ["Draven", "Caitlyn", "Varus", "Ashe"],
    DaWhiteHammer: ["Blitzcrank", "Pyke", "Brand", "Xerath"]
  },
  comps: {
    Engage: {
      Top: "Maokai - hard engage frontline",
      Jungle: "Vi - guaranteed lockdown",
      Mid: "Galio - follow-up engage + peel",
      ADC: "Miss Fortune - AoE wombo finisher",
      Support: "Leona - reliable engage chain"
    },
    Pick: {
      Top: "Renekton - point-and-click stun",
      Jungle: "Udyr - fast pick setups",
      Mid: "Ahri - charm picks",
      ADC: "Jhin - long-range pick follow-up",
      Support: "Lux - bind to burst"
    },
    Dive: {
      Top: "Vladimir - backline dive",
      Jungle: "Diana - AoE dive + wombo",
      Mid: "Yasuo - synergizes with Diana",
      ADC: "Tristana - self-peel dive ADC",
      Support: "Nautilus - guaranteed engage"
    },
    Wombo: {
      Top: "Mordekaiser - isolate key target",
      Jungle: "Sejuani - AoE lockdown",
      Mid: "Yone - massive AoE follow-up",
      ADC: "Miss Fortune - AoE cleanup",
      Support: "Mel - AoE CC + setup"
    },
    Skirmish: {
      Top: "Garen - simple, strong skirmisher",
      Jungle: "Udyr - fast 2v2/3v3 tempo",
      Mid: "Akali - high-damage skirmisher",
      ADC: "Yasuo - melee DPS flex",
      Support: "Zilean - speed + revive"
    },
    Poke: {
      Top: "Maokai - sapling poke + frontline",
      Jungle: "Bel'Veth - sustained DPS",
      Mid: "Azir - long-range poke + zone control",
      ADC: "Ashe - poke + slows",
      Support: "Vel'Koz - long-range poke burst"
    },
    FrontToBack: {
      Top: "Dr. Mundo - unkillable frontline",
      Jungle: "Sejuani - tank engage",
      Mid: "Syndra - burst + zone control",
      ADC: "Miss Fortune - AoE teamfight DPS",
      Support: "Nautilus - peel + engage"
    }
  },
  teamIdentity: {
    visionDriven: true,
    objectiveFocused: true,
    primaryPlaystyle: ["Engage", "AoE teamfight"],
    jungleTempo: "tempo jungle",
    damageProfile: "double-carry damage",
    midRole: "utility mid",
    lateGameFrontline: "late-game tank frontline"
  },
  macroSummary: {
    earlyGame: {
      top: "weakside",
      mid: "neutral",
      bot: "strongside",
      junglePath: "bot -> mid",
      strategy: ["avoid early fights", "focus on vision"]
    },
    midGame: {
      strategy: ["group early", "force 5v5", "play for dragons", "Herald 2"]
    },
    lateGame: {
      strategy: ["full 5v5", "front-to-back", "tanks front, carries behind"]
    }
  },
  resourceLinks: {
    DraftTools: [
      { label: "U.GG Tier Lists", url: "https://u.gg/lol/tier-list" },
      { label: "Mobalytics Team Comps", url: "https://mobalytics.gg/lol/team-comps" },
      { label: "Probuild Stats", url: "https://probuildstats.com/" }
    ],
    MacroAndObjectives: [
      { label: "Dragon/Objective Timers", url: "https://leagueoflegends.fandom.com/wiki/Monster" },
      { label: "Map Objective Guide", url: "https://mobalytics.gg/blog/lol-macro-guide/" }
    ],
    MatchupResearch: [
      { label: "CounterStats", url: "https://www.counterstats.net/" },
      { label: "Lolalytics", url: "https://lolalytics.com/" }
    ]
  }
};

window.TEAM_DATA = TEAM_DATA;
