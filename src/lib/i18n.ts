import { derived, get, writable } from 'svelte/store';
import { appMessages } from './messages-app';
import { componentMessages } from './messages-components';
import { readPreference, writePreference } from './preferences';

export type NoteNotation = 'language' | 'solfege' | 'english';
export type Locale = 'fr' | 'en' | 'de' | 'nl';
export type MessageParams = Record<string, string | number>;
export type Translator = (keyFrench: string, params?: MessageParams) => string;

const preferenceKey = 'chansonade.language';
const notationKey = 'chansonade.note-notation';
const supported: readonly Locale[] = ['fr', 'en', 'de', 'nl'];
const dictionaries: Record<Exclude<Locale, 'fr'>, Record<string, string>> = {
  en: { ...appMessages.en, ...componentMessages.en },
  de: { ...appMessages.de, ...componentMessages.de },
  nl: { ...appMessages.nl, ...componentMessages.nl },
};

export const locale = writable<Locale>('en');
export const noteNotation = writable<NoteNotation>('language');
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
  const value = readPreference(preferenceKey);
  return isLocale(value) ? value : browserLanguage();
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

/** Run once before mounting. Language and note notation belong to this device. */
export function initializeLanguage(): void {
  if (initialized) return;
  initialized = true;
  locale.set(readLanguage());
  noteNotation.set(readNotation());
  locale.subscribe(language => { document.documentElement.lang = language; });
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey || event.key === null) locale.set(readLanguage());
    if (event.key === notationKey || event.key === null) noteNotation.set(readNotation());
  });
}

export function setLanguage(language: Locale): void {
  if (!isLocale(language)) return;
  locale.set(language);
  writePreference(preferenceKey, language);
}

function isNoteNotation(value: unknown): value is NoteNotation {
  return value === 'language' || value === 'solfege' || value === 'english';
}
function readNotation(): NoteNotation {
  const value = readPreference(notationKey);
  return isNoteNotation(value) ? value : 'language';
}
export function setNoteNotation(value: NoteNotation): void {
  if (!isNoteNotation(value)) return;
  noteNotation.set(value);
  writePreference(notationKey, value);
}

const noteNames: Record<Locale, readonly string[]> = {
  fr: ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
  en: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  de: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'],
  nl: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'B'],
};

export function noteName(midi: number, language: Locale = get(locale), notation: NoteNotation = get(noteNotation)): string {
  if (!Number.isFinite(midi) || midi < 0) return '—';
  const rounded = Math.round(midi);
  const names = noteNames[notation === 'solfege' ? 'fr' : notation === 'english' ? 'en' : language];
  return `${names[rounded % 12]}${Math.floor(rounded / 12) - 1}`;
}

/** One reactive formatter for every displayed pitch, independent of audio/score state. */
export const noteFormatter = derived([locale, noteNotation], ([language, notation]) =>
  (midi: number) => noteName(midi, language, notation));

export function formatDate(timestamp: number, language: Locale = get(locale)): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
