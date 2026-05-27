// localStorage 래퍼 (기획서 §6.3)
(() => {
  'use strict';
  const KEY = 'suika.mochi.v1';
  const DEFAULTS = {
    bestScore: 0, totalGames: 0, totalMerges: 0,
    maxCombo: 0, kingCakeCount: 0,
    unlockedDesserts: [], firstSeenAt: {},
    settings: { sound: true, music: true },
  };
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { return { ...DEFAULTS }; }
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }
  window.Storage = { load, save };
})();
