import { derived, get, writable } from 'svelte/store';
import { appMessages } from './messages-app';
import { componentMessages } from './messages-components';

export type Locale = 'fr' | 'en' | 'de' | 'nl';
export type MessageParams = Record<string, string | number>;
export type Translator = (keyFrench: string, params?: MessageParams) => string;

const preferenceKey = 'chansonade.language';
const supported: readonly Locale[] = ['fr', 'en', 'de', 'nl'];
const dictionaries: Record<Exclude<Locale, 'fr'>, Record<string, string>> = {
  en: { ...appMessages.en, ...componentMessages.en },
  de: { ...appMessages.de, ...componentMessages.de },
  nl: { ...appMessages.nl, ...componentMessages.nl },
};

export const locale = writable<Locale>('en');
let initialized = false;

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && supported.includes(value as Locale);
}

function browserLanguage(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    const base = language?.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

function readLanguage(): Locale {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (isLocale(value)) return value;
  } catch { /* Keep the reader usable when browser storage is blocked. */ }
  return browserLanguage();
}

function message(language: Locale, keyFrench: string, params?: MessageParams): string {
  const translated = language !== 'fr' && Object.hasOwn(dictionaries[language], keyFrench)
    ? dictionaries[language][keyFrench] : keyFrench;
  if (!params) return translated;
  return translated.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

/** Reactive translations for Svelte markup: $t('Lire') or $t(key, { value }). */
export const t = derived(locale, language =>
  ((keyFrench, params) => message(language, keyFrench, params)) as Translator);

/** Read the current language when a notification or other JS action occurs. */
export function translate(keyFrench: string, params?: MessageParams): string {
  return message(get(locale), keyFrench, params);
}

/** Run once before mounting. The language belongs to this browser, not a user account. */
export function initializeLanguage(): void {
  if (initialized) return;
  initialized = true;
  locale.set(readLanguage());
  locale.subscribe(language => { document.documentElement.lang = language; });
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey || event.key === null) locale.set(readLanguage());
  });
}

export function setLanguage(language: Locale): void {
  if (!isLocale(language)) return;
  locale.set(language);
  try { localStorage.setItem(preferenceKey, language); }
  catch { /* The selected language still works for this page. */ }
}

const noteNames: Record<Locale, readonly string[]> = {
  fr: ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
  en: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  de: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'],
  nl: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'B'],
};

export function noteName(midi: number, language: Locale = get(locale)): string {
  if (!Number.isFinite(midi) || midi < 0) return '—';
  const rounded = Math.round(midi);
  return `${noteNames[language][rounded % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function formatDate(timestamp: number, language: Locale = get(locale)): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
