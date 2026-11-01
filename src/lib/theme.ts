import { writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'chansonade.theme';
export const themePreference = writable<ThemePreference>('system');
let initialized = false;

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* A blocked preference must not prevent using the reader. */ }
  return 'system';
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = readPreference();
  themePreference.set(preference);
  const apply = () => {
    const resolved = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0b1427' : '#f2f6ff');
  };
  themePreference.subscribe((value) => { preference = value; apply(); });
  media.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) themePreference.set(readPreference());
  });
}

export function cycleTheme() {
  themePreference.update((current) => {
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    try { localStorage.setItem(key, next); } catch { /* Keep the current choice in memory. */ }
    return next;
  });
}
