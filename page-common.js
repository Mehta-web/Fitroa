(() => {
  "use strict";

  const STORAGE_KEY = "fitguide.local.v1";
  const DEFAULT_STATE = {
    profile: null,
    plan: null,
    history: [],
    wins: [],
    favorites: [],
    theme: "light",
    reminder: ""
  };

  function emptyState() {
    return { ...DEFAULT_STATE, history: [], wins: [], favorites: [] };
  }

  function readState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return emptyState();
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
      return {
        ...DEFAULT_STATE,
        ...parsed,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        wins: Array.isArray(parsed.wins) ? parsed.wins : [],
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : []
      };
    } catch (error) {
      console.error("Could not read FitGuide data from this browser.", error);
      return emptyState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function todayIndex() {
    return (new Date().getDay() + 6) % 7;
  }

  function dateKey(date) {
    const value = new Date(date);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(date, options = { month: "short", day: "numeric", year: "numeric" }) {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return "Date unavailable";
    return value.toLocaleDateString(undefined, options);
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    if (!minutes) return `${remainder} sec`;
    return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
  }

  function formatClock(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function illustration(exercise) {
    const media = exercise && exercise.media ? exercise.media : {};
    const alt = escapeHtml(media.alt || `${exercise && exercise.name ? exercise.name : "Exercise"} illustration`);
    const symbol = escapeHtml(media.symbol || "✦");
    return `<div class="page-exercise-illustration" role="img" aria-label="${alt}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="19" r="9"></circle><path d="M50 29v31m0-22L31 43m19-5 19 5M50 60 36 85m14-25 16 25"></path></svg>
      <span aria-hidden="true">${symbol}</span>
    </div>`;
  }

  function initNavigation() {
    const state = readState();
    const themeToggle = document.getElementById("theme-toggle");
    const menuToggle = document.getElementById("menu-toggle");
    const mainNav = document.querySelector(".main-nav");
    document.body.classList.toggle("dark", state.theme === "dark");
    themeToggle.textContent = state.theme === "dark" ? "☀" : "☾";
    themeToggle.addEventListener("click", () => {
      const nextState = readState();
      nextState.theme = document.body.classList.toggle("dark") ? "dark" : "light";
      themeToggle.textContent = nextState.theme === "dark" ? "☀" : "☾";
      try {
        saveState(nextState);
        window.dispatchEvent(new CustomEvent("fitguide:themechange", { detail: nextState.theme }));
      } catch (error) {
        console.error("Could not save the FitGuide theme preference.", error);
      }
    });
    menuToggle.addEventListener("click", () => {
      const open = mainNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    mainNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      mainNav.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open menu");
    }));
  }

  window.FitGuidePage = Object.freeze({
    STORAGE_KEY,
    readState,
    saveState,
    escapeHtml,
    todayIndex,
    dateKey,
    formatDate,
    formatDuration,
    formatClock,
    illustration,
    initNavigation
  });
})();
