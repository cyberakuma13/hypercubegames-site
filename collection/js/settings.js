// App settings, persisted in localStorage (API keys, proxy, view prefs).

const KEY = 'hypercube-collection-settings';

const DEFAULTS = {
  tmdbKey: '',
  rawgKey: '',
  comicVineKey: '',
  corsProxy: 'https://corsproxy.io/?url={url}',
  view: 'grid',          // 'grid' | 'list'
  sort: 'updatedAt-desc',
};

let cache = null;

export function getSettings() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
    catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  return cache;
}
