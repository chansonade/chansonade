const listeners = new Set<(key: string) => void>();
const changed = (key: string) => { for (const listener of listeners) listener(key); };

/** Browser preferences remain usable when localStorage persistence is refused. */
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch { return; }
  changed(key);
}

export function removePreference(key: string): void {
  try { localStorage.removeItem(key); }
  catch { return; }
  changed(key);
}

/** A refused read must never be mistaken for a missing entry during adoption. */
export function writePreferenceIfMissing(key: string, value: string): void {
  try {
    const storage = localStorage;
    if (storage.getItem(key) !== null) return;
    storage.setItem(key, value);
  } catch { return; }
  changed(key);
}

/** Observe successful local writes and changes from other tabs, without caching values. */
export function subscribePreference(key: string, listener: () => void): () => void {
  const local = (name: string) => { if (name === key) listener(); };
  const remote = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
  listeners.add(local);
  window.addEventListener('storage', remote);
  return () => { listeners.delete(local); window.removeEventListener('storage', remote); };
}
