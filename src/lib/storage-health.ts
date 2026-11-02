/** Ask after an import/record gesture, without making persistence a requirement. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !await navigator.storage.persisted()) await navigator.storage.persist();
  } catch { /* A refusal must never stop an import or recording. */ }
}

