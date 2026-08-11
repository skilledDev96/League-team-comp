(function () {
  const roleCardsHost = document.getElementById("roleCards");
  if (!roleCardsHost || roleCardsHost.children.length > 0) {
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
  const heroTitle = document.getElementById("heroTitle");
  if (brandTitle && brandTitle.firstChild) {
    brandTitle.firstChild.textContent = data.teamName;
  }
  if (heroTitle) {
    heroTitle.textContent = `${data.teamName} Ready Room`;
  }

  const roles = Object.entries(data.team);

  for (const entry of roles) {
    const role = entry[0];
    const player = entry[1];
    const championInfo = data.top3Champs[player];
    const stats = data.strengthsWeaknesses[player];
    const iconRef = data.summonerIcons[player];

    const block = document.createElement("article");
    block.className = "card clickable-card";

    const playerTarget = `player-intel.html?player=${encodeURIComponent(player)}`;

    block.innerHTML = `
      <div class="title-row">
        <h2>${role} - ${player}</h2>
      </div>
      ${ui.createPlaystyleLine(data.playstyles[player]).outerHTML}
      <p class="meta-line main-champ-inline"><img class="main-champ-icon" src="${ui.championIconUrl(championInfo.top3[0])}" alt="${championInfo.top3[0]} icon"><span class="meta-label">Main Champion</span><span class="meta-value">${championInfo.top3[0]}</span></p>
      <button type="button" class="view-btn role-toggle">Show Details</button>
    `;

    const titleRow = block.querySelector(".title-row");
    titleRow.prepend(ui.createPlayerAvatar(player, iconRef, { role: role }));

    const overlayLink = document.createElement("a");
    overlayLink.href = playerTarget;
    overlayLink.className = "card-link-overlay";
    overlayLink.setAttribute("aria-label", `Open ${player} in Player Intel`);
    block.appendChild(overlayLink);

    const roleDetails = document.createElement("div");
    roleDetails.className = "role-details";

    const learn = document.createElement("p");
    learn.className = "muted";
    learn.textContent = `Learn next: ${championInfo.learn}`;
    roleDetails.appendChild(learn);

    const champRow = document.createElement("div");
    champRow.className = "champ-chip-row";
    for (const champion of championInfo.top3) {
      champRow.appendChild(ui.createChampionChip(champion, champion));
    }
    roleDetails.appendChild(champRow);

    const row = document.createElement("div");
    row.className = "tag-row";
    for (const s of stats.strengths.slice(0, 2)) {
      row.appendChild(ui.createTag(s, "tag good"));
    }
    for (const w of stats.weaknesses.slice(0, 1)) {
      row.appendChild(ui.createTag(w, "tag bad"));
    }
    roleDetails.appendChild(row);

    const playerLink = ui.createExternalLink(ui.summonerSearchUrl(player), "Open player lookup");
    playerLink.className = "tag";
    roleDetails.appendChild(document.createElement("br"));
    roleDetails.appendChild(playerLink);

    block.appendChild(roleDetails);

    const toggleBtn = block.querySelector(".role-toggle");
    toggleBtn.addEventListener("click", function () {
      const expanded = block.classList.toggle("expanded");
      toggleBtn.textContent = expanded ? "Hide Details" : "Show Details";
    });

    roleCardsHost.appendChild(block);
  }

  const identityList = document.getElementById("identityList");
  if (identityList && identityList.children.length === 0) {
    const identityRows = [
      ["Vision", data.teamIdentity.visionDriven ? "Primary pillar" : "Secondary"],
      ["Objectives", data.teamIdentity.objectiveFocused ? "Priority" : "Flexible"],
      ["Primary", data.teamIdentity.primaryPlaystyle.join(" + ")],
      ["Jungle", data.teamIdentity.jungleTempo],
      ["Damage", data.teamIdentity.damageProfile],
      ["Mid role", data.teamIdentity.midRole],
      ["Frontline", data.teamIdentity.lateGameFrontline]
    ];

    for (const item of identityRows) {
      const dt = document.createElement("dt");
      dt.textContent = item[0];
      const dd = document.createElement("dd");
      dd.textContent = item[1];
      identityList.appendChild(dt);
      identityList.appendChild(dd);
    }
  }

  const resourceCards = document.getElementById("resourceCards");
  if (resourceCards && resourceCards.children.length === 0) {
    for (const resource of Object.entries(data.resourceLinks)) {
      const card = document.createElement("article");
      card.className = "card";
      const title = document.createElement("h2");
      title.className = "title-with-icon";
      const iconMap = {
        DraftTools: "DT",
        MacroAndObjectives: "MO",
        MatchupResearch: "MR"
      };
      title.innerHTML = `<span class="section-icon">${iconMap[resource[0]] || "RS"}</span>${resource[0].replace(/([A-Z])/g, " $1").trim()}`;
      card.appendChild(title);

      const wrap = document.createElement("div");
      wrap.className = "links";
      for (const link of resource[1]) {
        wrap.appendChild(ui.createExternalLink(link.url, link.label));
      }
      card.appendChild(wrap);
      resourceCards.appendChild(card);
    }
  }

  const fillInCards = document.getElementById("fillInCards");
  const fillIns = Array.isArray(data.fillIns) ? data.fillIns : [];
  if (fillInCards && fillIns.length > 0 && fillInCards.children.length === 0) {
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h2");
    title.className = "title-with-icon";
    title.innerHTML = "<span class=\"section-icon\">FI</span>Fill-in Roster (Pending Confirmation)";
    card.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "links";
    for (const player of fillIns) {
      const rolesText = (player.preferredRoles || []).join(", ");
      const text = `${player.summoner} - ${rolesText} - ${player.status}`;
      const entry = document.createElement("div");
      entry.className = "title-row";
      entry.appendChild(ui.createPlayerAvatar(player.summoner, player.icon, { role: (player.preferredRoles || [""])[0] }));
      entry.appendChild(ui.createExternalLink(ui.summonerSearchUrl(player.summoner), text));
      wrap.appendChild(entry);
    }

    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = fillIns[0].note || "";

    card.appendChild(wrap);
    card.appendChild(note);
    fillInCards.appendChild(card);
  }

  const starterBtn = document.getElementById("starterViewBtn");
  const fullBtn = document.getElementById("fullViewBtn");
  const strategySection = document.getElementById("strategySection");
  const advancedSections = [strategySection, resourceCards, fillInCards];

  function setView(mode) {
    const showAdvanced = mode === "full";
    for (const section of advancedSections) {
      if (section) {
        section.hidden = !showAdvanced;
      }
    }

    if (starterBtn) {
      starterBtn.classList.toggle("active", !showAdvanced);
    }
    if (fullBtn) {
      fullBtn.classList.toggle("active", showAdvanced);
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
