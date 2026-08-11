(function () {
  const host = document.getElementById("playerCards");
  if (!host || host.children.length > 0) {
    return;
  }

  if (!window.TEAM_DATA || !window.UI) {
    return;
  }

  if (window.Theme && typeof window.Theme.initThemeToggle === "function") {
    window.Theme.initThemeToggle();
  }

  const data = window.TEAM_DATA;
  const ui = window.UI;
  const playerAnchorId = ui.playerAnchorId || function (playerName) {
    const safe = (playerName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return `player-${safe}`;
  };

  const brandTitle = document.getElementById("brandTitle");
  const pageTitle = document.getElementById("pageTitle");
  if (brandTitle && brandTitle.firstChild) {
    brandTitle.firstChild.textContent = data.teamName;
  }
  if (pageTitle) {
    pageTitle.textContent = `${data.teamName} Scouting Board: Role Profiles and Champion Links`;
  }

  const fillInHost = document.getElementById("fillInSection");
  const fillIns = Array.isArray(data.fillIns) ? data.fillIns : [];
  if (fillInHost && fillIns.length > 0 && fillInHost.children.length === 0) {
    for (const player of fillIns) {
      const card = document.createElement("article");
      card.className = "card";

      const titleRow = document.createElement("div");
      titleRow.className = "title-row";
      titleRow.appendChild(ui.createPlayerAvatar(player.summoner, player.icon, { role: (player.preferredRoles || [""])[0] }));
      const heading = document.createElement("h2");
      heading.textContent = `Fill-in: ${player.summoner}`;
      titleRow.appendChild(heading);
      card.appendChild(titleRow);

      const status = document.createElement("p");
      status.className = "muted";
      status.textContent = `Status: ${player.status}`;
      card.appendChild(status);

      const rolesText = document.createElement("p");
      rolesText.className = "muted";
      rolesText.textContent = `Likely roles: ${(player.preferredRoles || []).join(", ")}`;
      card.appendChild(rolesText);

      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = player.note || "";
      card.appendChild(note);

      const linksWrap = document.createElement("div");
      linksWrap.className = "links";
      linksWrap.appendChild(ui.createExternalLink(ui.summonerSearchUrl(player.summoner), "OP.GG player search"));
      const fillInMobalyticsUrl = ui.summonerMobalyticsUrl(player.summoner);
      if (fillInMobalyticsUrl) {
        linksWrap.appendChild(ui.createExternalLink(fillInMobalyticsUrl, "Mobalytics player profile"));
      }
      card.appendChild(linksWrap);
      fillInHost.appendChild(card);
    }
  }

  for (const [role, player] of Object.entries(data.team)) {
    const stats = data.strengthsWeaknesses[player];
    const champs = data.top3Champs[player];
    const bans = data.banRecommendations[player];
    const icon = data.summonerIcons[player];

    const card = document.createElement("article");
    card.className = "card";
    card.id = playerAnchorId(player);

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    titleRow.appendChild(ui.createPlayerAvatar(player, icon, { role }));

    const title = document.createElement("h2");
    title.textContent = `${role} - ${player}`;
    titleRow.appendChild(title);
    card.appendChild(titleRow);

    card.appendChild(ui.createPlaystyleLine(data.playstyles[player]));

    const mainChamp = document.createElement("p");
    mainChamp.className = "meta-line main-champ-inline";

    const mainChampIcon = document.createElement("img");
    mainChampIcon.className = "main-champ-icon";
    mainChampIcon.src = ui.championIconUrl(champs.top3[0]);
    mainChampIcon.alt = `${champs.top3[0]} icon`;

    const mainChampText = document.createElement("span");
    mainChampText.className = "meta-label";
    mainChampText.textContent = "Main Champion";

    const mainChampValue = document.createElement("span");
    mainChampValue.className = "meta-value";
    mainChampValue.textContent = champs.top3[0];

    mainChamp.appendChild(mainChampIcon);
    mainChamp.appendChild(mainChampText);
    mainChamp.appendChild(mainChampValue);
    card.appendChild(mainChamp);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "view-btn role-toggle";
    toggleBtn.textContent = "Show Details";
    card.appendChild(toggleBtn);

    const details = document.createElement("div");
    details.className = "role-details";

    const strengthsTitle = document.createElement("h3");
    strengthsTitle.textContent = "Strengths";
    details.appendChild(strengthsTitle);
    const strengthsRow = document.createElement("div");
    strengthsRow.className = "tag-row";
    for (const item of stats.strengths) strengthsRow.appendChild(ui.createTag(item, "tag good"));
    details.appendChild(strengthsRow);

    const weakTitle = document.createElement("h3");
    weakTitle.textContent = "Weaknesses";
    details.appendChild(weakTitle);
    const weakRow = document.createElement("div");
    weakRow.className = "tag-row";
    for (const item of stats.weaknesses) weakRow.appendChild(ui.createTag(item, "tag bad"));
    details.appendChild(weakRow);

    const champTitle = document.createElement("h3");
    champTitle.textContent = "Champion Pool";
    details.appendChild(champTitle);

    const champRow = document.createElement("div");
    champRow.className = "champ-chip-row";
    for (const champion of champs.top3) champRow.appendChild(ui.createChampionChip(champion, champion));
    champRow.appendChild(ui.createChampionChip(champs.learn, `Learn: ${champs.learn}`));
    details.appendChild(champRow);

    const linksWrap = document.createElement("div");
    linksWrap.className = "links";
    linksWrap.appendChild(ui.createExternalLink(ui.summonerSearchUrl(player), "OP.GG player search"));
    const mobalyticsUrl = ui.summonerMobalyticsUrl(player);
    if (mobalyticsUrl) {
      linksWrap.appendChild(ui.createExternalLink(mobalyticsUrl, "Mobalytics player profile"));
    }
    for (const champion of champs.top3) linksWrap.appendChild(ui.createExternalLink(ui.championBuildUrl(champion), `Build guide: ${champion}`));
    linksWrap.appendChild(ui.createExternalLink(ui.championBuildUrl(champs.learn), `Learn next build: ${champs.learn}`));
    details.appendChild(linksWrap);

    const banTitle = document.createElement("h3");
    banTitle.textContent = "Suggested Bans";
    details.appendChild(banTitle);

    const banList = document.createElement("ul");
    banList.className = "list-clean";
    for (const ban of bans) {
      const li = document.createElement("li");
      li.textContent = ban;
      banList.appendChild(li);
    }
    details.appendChild(banList);

    card.appendChild(details);

    toggleBtn.addEventListener("click", function () {
      const expanded = card.classList.toggle("expanded");
      toggleBtn.textContent = expanded ? "Hide Details" : "Show Details";
    });

    host.appendChild(card);
  }

  const starterBtn = document.getElementById("starterViewBtn");
  const fullBtn = document.getElementById("fullViewBtn");

  function setView(mode) {
    const full = mode === "full";
    if (fillInHost) {
      fillInHost.hidden = !full;
    }
    for (const card of host.children) {
      card.classList.toggle("expanded", full);
      const btn = card.querySelector(".role-toggle");
      if (btn) {
        btn.textContent = full ? "Hide Details" : "Show Details";
      }
    }

    if (starterBtn) {
      starterBtn.classList.toggle("active", !full);
    }
    if (fullBtn) {
      fullBtn.classList.toggle("active", full);
    }
  }

  if (starterBtn) {
    starterBtn.addEventListener("click", function () { setView("starter"); });
  }
  if (fullBtn) {
    fullBtn.addEventListener("click", function () { setView("full"); });
  }

  setView("starter");
})();
