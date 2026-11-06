import { writable } from 'svelte/store';
import { readPreference, writePreference } from './preferences';

export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'chansonade.theme';
export const themePreference = writable<ThemePreference>('system');
let initialized = false;

function readTheme(): ThemePreference {
  const value = readPreference(key);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = readTheme();
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
    if (event.key === key || event.key === null) themePreference.set(readTheme());
  });
}

export function cycleTheme() {
  themePreference.update((current) => {
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    writePreference(key, next);
    return next;
  });
}
