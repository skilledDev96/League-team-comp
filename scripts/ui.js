function championSlug(championName) {
  const explicitMap = {
    "Bel'Veth": "belveth",
    "Vel'Koz": "velkoz",
    "Dr. Mundo": "drmundo",
    "Miss Fortune": "missfortune"
  };

  if (explicitMap[championName]) {
    return explicitMap[championName];
  }

  return championName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function championDDragonName(championName) {
  const explicitMap = {
    "Bel'Veth": "Belveth",
    "Vel'Koz": "Velkoz",
    "Dr. Mundo": "DrMundo",
    "Miss Fortune": "MissFortune",
    "Jarvan IV": "JarvanIV",
    "Kai'Sa": "Kaisa",
    "Kha'Zix": "Khazix",
    "Kog'Maw": "KogMaw",
    "LeBlanc": "Leblanc",
    "Nunu & Willump": "Nunu",
    "Rek'Sai": "RekSai",
    "Renata Glasc": "Renata",
    "Tahm Kench": "TahmKench",
    "Twisted Fate": "TwistedFate",
    "Xin Zhao": "XinZhao",
    "Aurelion Sol": "AurelionSol",
    "Cho'Gath": "Chogath",
    "Wukong": "MonkeyKing"
  };

  if (explicitMap[championName]) {
    return explicitMap[championName];
  }

  return championName.replace(/[^A-Za-z0-9]/g, "");
}

function championIconUrl(championName) {
  const ddName = championDDragonName(championName);
  return `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${ddName}.png`;
}

function summonerIconUrl(iconRef, basePath = "assets/summoners") {
  if (!iconRef) {
    return "";
  }

  if (iconRef.startsWith("http://") || iconRef.startsWith("https://")) {
    return iconRef;
  }

  return `${basePath}/${iconRef}`;
}

function summonerProfileMeta(name) {
  const profiles = (window.TEAM_DATA && window.TEAM_DATA.summonerProfiles) || {};
  return profiles[name] || null;
}

function summonerSearchUrl(name) {
  const meta = summonerProfileMeta(name);
  if (meta && meta.region && meta.opggSlug) {
    return `https://op.gg/lol/summoners/${meta.region}/${meta.opggSlug}`;
  }

  const region = (meta && meta.region) || "euw";
  const riotTag = (meta && meta.riotTag) || region.toUpperCase();
  return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(name)}-${encodeURIComponent(riotTag)}`;
}

function summonerMobalyticsUrl(name) {
  const meta = summonerProfileMeta(name);
  if (meta && meta.region && meta.mobalyticsSlug) {
    return `https://www.mobalytics.gg/lol/summoners/${meta.region}/${meta.mobalyticsSlug}`;
  }
  return "";
}

function championBuildUrl(championName) {
  return `https://u.gg/lol/champions/${championSlug(championName)}/build`;
}

function parseCompLine(text) {
  const separator = " - ";
  if (!text.includes(separator)) {
    return { champion: text.trim(), note: "" };
  }

  const index = text.indexOf(separator);
  return {
    champion: text.slice(0, index).trim(),
    note: text.slice(index + separator.length).trim()
  };
}

function createTag(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function createExternalLink(url, text) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

function playstyleIcon(playstyleText) {
  const value = (playstyleText || "").toLowerCase();
  const map = [
    { test: /selfless/, icon: "volunteer_activism" },
    { test: /late bloomer/, icon: "eco" },
    { test: /ultimate predator/, icon: "pets" },
    { test: /third eye/, icon: "visibility" },
    { test: /generalist/, icon: "psychology" }
  ];

  for (const entry of map) {
    if (entry.test.test(value)) {
      return entry.icon;
    }
  }

  return "track_changes";
}

function createPlaystyleLine(playstyleText) {
  const line = document.createElement("p");
  line.className = "meta-line meta-playstyle";

  const iconName = playstyleIcon(playstyleText);

  const label = document.createElement("span");
  label.className = "meta-label";
  label.textContent = "Playstyle";

  const value = document.createElement("span");
  value.className = "meta-value";
  value.textContent = playstyleText || "Unknown";

  const trailingIcon = document.createElement("span");
  trailingIcon.className = "playstyle-icon material-symbols-rounded trailing";
  trailingIcon.setAttribute("aria-hidden", "true");
  trailingIcon.textContent = iconName;

  line.appendChild(label);
  line.appendChild(value);
  line.appendChild(trailingIcon);
  return line;
}

function playerAnchorId(playerName) {
  const safe = (playerName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `player-${safe}`;
}

function createChampionChip(championName, linkText) {
  const wrap = document.createElement("a");
  wrap.href = championBuildUrl(championName);
  wrap.target = "_blank";
  wrap.rel = "noopener noreferrer";
  wrap.className = "champ-chip";

  const img = document.createElement("img");
  img.src = championIconUrl(championName);
  img.alt = `${championName} icon`;
  img.className = "champ-icon";
  img.loading = "lazy";

  const text = document.createElement("span");
  text.textContent = linkText || championName;

  wrap.appendChild(img);
  wrap.appendChild(text);
  return wrap;
}

function roleBadgeText(role) {
  const map = {
    Top: "TOP",
    Jungle: "JG",
    Mid: "MID",
    ADC: "ADC",
    Support: "SUP"
  };
  return map[role] || role || "";
}

function createPlayerAvatar(playerName, iconRef, options = {}) {
  const basePath = options.basePath || "assets/summoners";
  const wrap = document.createElement("span");
  wrap.className = "avatar";

  const fallback = document.createElement("span");
  fallback.className = "avatar-fallback";
  fallback.textContent = playerName ? playerName.slice(0, 1).toUpperCase() : "?";
  wrap.appendChild(fallback);

  const src = summonerIconUrl(iconRef, basePath);
  if (!src) {
    return wrap;
  }

  const img = document.createElement("img");
  img.className = "avatar-img";
  img.alt = `${playerName} summoner icon`;
  img.loading = "eager";
  img.addEventListener("load", () => {
    wrap.classList.add("has-image");
  });
  img.src = src;

  // Local/cached files can be complete before the load listener fires.
  if (img.complete && img.naturalWidth > 0) {
    wrap.classList.add("has-image");
  }

  wrap.appendChild(img);

  const badgeRole = roleBadgeText(options.role);
  if (badgeRole) {
    const badge = document.createElement("span");
    badge.className = "avatar-role";
    badge.textContent = badgeRole;
    wrap.appendChild(badge);
  }

  return wrap;
}

window.UI = {
  championIconUrl,
  championBuildUrl,
  createChampionChip,
  parseCompLine,
  createPlaystyleLine,
  createPlayerAvatar,
  playerAnchorId,
  createTag,
  createExternalLink,
  summonerMobalyticsUrl,
  summonerSearchUrl,
  summonerIconUrl
};
