(function () {
  const THEMES = ["dark", "dark-blue", "dark-red", "light"];

  function isValidTheme(theme) {
    return THEMES.includes(theme);
  }

  function themeLabel(theme) {
    if (theme === "dark") {
      return "Dark";
    }
    if (theme === "dark-red") {
      return "Red";
    }
    if (theme === "light") {
      return "Light";
    }
    return "Blue";
  }

  function nextTheme(theme) {
    const index = THEMES.indexOf(theme);
    if (index === -1) {
      return THEMES[0];
    }
    return THEMES[(index + 1) % THEMES.length];
  }

  function getStoredTheme() {
    const stored = localStorage.getItem("bom-theme");
    if (isValidTheme(stored)) {
      return stored;
    }
    return null;
  }

  function preferredTheme() {
    const stored = getStoredTheme();
    if (stored) {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark-blue" : "light";
  }

  function applyTheme(theme) {
    const selectedTheme = isValidTheme(theme) ? theme : "dark";
    document.body.setAttribute("data-theme", selectedTheme);
    localStorage.setItem("bom-theme", selectedTheme);

    const select = document.querySelector("[data-theme-select]");
    if (select && select.value !== selectedTheme) {
      select.value = selectedTheme;
    }

    const button = document.querySelector("[data-theme-toggle]");
    if (button) {
      const next = nextTheme(selectedTheme);
      button.textContent = `Theme: ${themeLabel(selectedTheme)}`;
      button.setAttribute("aria-label", `Switch to ${themeLabel(next)} theme`);
    }
  }

  function initThemeToggle() {
    const select = document.querySelector("[data-theme-select]");
    if (select) {
      select.addEventListener("change", function () {
        applyTheme(select.value);
      });

      applyTheme(document.body.getAttribute("data-theme") || preferredTheme());
      return;
    }

    const button = document.querySelector("[data-theme-toggle]");
    if (!button) {
      return;
    }

    button.addEventListener("click", function () {
      const current = document.body.getAttribute("data-theme") || "dark";
      applyTheme(nextTheme(current));
    });

    applyTheme(document.body.getAttribute("data-theme") || preferredTheme());
  }

  window.Theme = {
    applyTheme,
    initThemeToggle,
    preferredTheme
  };
})();
