/** Browser preferences remain usable when localStorage persistence is refused. */
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch {}
}

export function removePreference(key: string): void {
  try { localStorage.removeItem(key); }
  catch {}
}
