export type SavedScore = { id: string; title: string; composer: string; xml: string; added: number };
export type PracticeSettings = { rate: number; loopA: number | null; loopB: number | null; loopEnabled: boolean; target: number; parts: { channel: number; volume: number; muted: boolean; solo: boolean; transpose: number; program: number }[] };
export type TakePitch = {
  time: number; frequency: number; rawFrequency: number; clarity: number; rms: number;
  midi: number; cents: number; scoreTime: number; expectedPitch: number | null;
  noteId: string | null; targetChannel: number; playing: boolean;
};
export type TakeTransport = { time: number; scoreTime: number; playing: boolean; rate: number; targetChannel: number; transpose: number };
export type RecordedTake = {
  id: string; createdAt: number; title: string; scoreId: string; scoreXML: string;
  audio: Blob; duration: number; sampleRate: number; samples: number;
  analysisComplete?: boolean;
  input?: { label: string; settings: MediaTrackSettings } | null;
  captureStartedAt: number; settings: PracticeSettings; latencyMs: number;
  /** Versioned detector settings; older takes retain their original fields. */
  detector: { name: string; [parameter: string]: string | number };
  pitches: TakePitch[]; transport: TakeTransport[];
};

// Compatibility only: the public name and all new writes use Chansonade.
const LEGACY_NAME = 'worpus';

export function migrateLocalSettings() {
  try {
    if (localStorage.getItem('chansonade.settings-migrated')) return;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`${LEGACY_NAME}.`)) continue;
      const target = `chansonade.${key.slice(LEGACY_NAME.length + 1)}`;
      if (localStorage.getItem(target) === null) localStorage.setItem(target, localStorage.getItem(key)!);
    }
    localStorage.setItem('chansonade.settings-migrated', '1');
  } catch { /* Retry next time if storage is unavailable or full. */ }
}

function readStore<T>(connection: IDBDatabase, name: string): Promise<T[]> {
  if (!connection.objectStoreNames.contains(name)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = connection.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function migrateLocalDatabase(connection: IDBDatabase) {
  const migrated = await new Promise((resolve, reject) => {
    const request = connection.transaction('meta').objectStore('meta').get('legacy-imported');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (migrated) return;
  const legacy = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_NAME);
    let absent = false;
    // Aborting creation leaves no empty legacy database on a fresh install.
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  let scores: SavedScore[] = [], takes: RecordedTake[] = [];
  if (legacy) {
    try { [scores, takes] = await Promise.all([readStore<SavedScore>(legacy, 'scores'), readStore<RecordedTake>(legacy, 'takes')]); }
    finally { legacy.close(); }
  }
  // Copy records and the completion marker atomically. Preserve both the old
  // database and any newer records already present under the new name.
  await new Promise<void>((resolve, reject) => {
    const tx = connection.transaction(['scores', 'takes', 'meta'], 'readwrite');
    for (const [name, records] of [['scores', scores], ['takes', takes]] as const) {
      const store = tx.objectStore(name);
      for (const record of records) {
        const request = store.get(record.id);
        request.onsuccess = () => { if (request.result === undefined) store.put(record); };
      }
    }
    tx.objectStore('meta').put(true, 'legacy-imported');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('La reprise des données locales a été interrompue.'));
    tx.onerror = () => reject(tx.error);
  });
}

let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  if (database) return database;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('chansonade', 4);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('scores')) request.result.createObjectStore('scores', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('takes')) {
        request.result.createObjectStore('takes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (!request.result.objectStoreNames.contains('meta')) request.result.createObjectStore('meta');
      if (!request.result.objectStoreNames.contains('resources')) {
        const resources = request.result.createObjectStore('resources', { keyPath: ['scope', 'kind', 'id'] });
        resources.createIndex('scope', 'scope');
        resources.createIndex('scopeKind', ['scope', 'kind']);
      }
      if (!request.result.objectStoreNames.contains('outbox')) {
        request.result.createObjectStore('outbox', { keyPath: ['scope', 'kind', 'id'] }).createIndex('scope', 'scope');
      }
    };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); if (database === opening) database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new Error('Rechargez les autres onglets Chansonade pour activer la sauvegarde des essais.')); };
  }).then(async (connection) => {
    try { await migrateLocalDatabase(connection); await migrateScopedData(connection); return connection; }
    catch (cause) { connection.close(); throw cause; }
  });
  database = opening;
  void opening.catch(() => { if (database === opening) database = undefined; });
  return opening;
}

export async function scoreId(xml: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function saveTake(take: RecordedTake) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('takes', 'readwrite');
    tx.objectStore('takes').put(take);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Sauvegarde de l’essai interrompue.'));
  });
}

export async function latestTake(): Promise<RecordedTake | null> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('takes').objectStore('takes').index('createdAt').openCursor(null, 'prev');
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

export type ResourceKind = 'score' | 'settings';
export type ResourceData = SavedScore | PracticeSettings;
export type RemoteResource = { kind: ResourceKind; id: string; data: ResourceData | null; revision: number; deleted: boolean };
export type Mutation = { mutationId: string; kind: ResourceKind; id: string; baseRevision: number; data: ResourceData | null; deleted: boolean };
export type PendingMutation = Mutation & { scope: string; change: number; sent: boolean };
export type LocalResource = RemoteResource & { scope: string; change: number; dirty: boolean; conflict: RemoteResource | null };
export type StorageChange = { scope: string; reason: 'write' | 'remote' | 'scope' };
export const ANONYMOUS_SCOPE = 'anonymous';
let activeScope = ANONYMOUS_SCOPE;
const listeners = new Set<(event: StorageChange) => void>();
export function storageScope() { return activeScope; }
export function setStorageScope(scope: string) {
  if (scope === activeScope) return;
  activeScope = scope;
  changed(scope, 'scope');
}
export function subscribeStorage(listener: (event: StorageChange) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function changed(scope: string, reason: StorageChange['reason']) {
  for (const listener of listeners) listener({ scope, reason });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transaction<T>(connection: IDBDatabase, stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(stores, mode);
    let value: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('La sauvegarde locale a été interrompue.'));
    void operation(tx).then((result) => { value = result; }, (cause) => {
      failure = cause;
      try { tx.abort(); } catch { reject(cause); }
    });
  });
}
function key(scope: string, kind: ResourceKind, id: string) { return [scope, kind, id]; }
function queueFor(record: LocalResource): PendingMutation {
  return { scope: record.scope, kind: record.kind, id: record.id, mutationId: crypto.randomUUID(), baseRevision: record.revision, data: record.data, deleted: record.deleted, change: record.change, sent: false };
}
function localRecord(scope: string, kind: ResourceKind, id: string, data: ResourceData | null, revision = 0): LocalResource {
  return { scope, kind, id, data, revision, deleted: data === null, change: 1, dirty: false, conflict: null };
}
async function migrateScopedData(connection: IDBDatabase) {
  if (await requestValue(connection.transaction('meta').objectStore('meta').get('scoped-v4'))) return;
  const scores = await readStore<SavedScore>(connection, 'scores');
  const settings: [string, PracticeSettings][] = [];
  try {
    for (const name of Object.keys(localStorage)) {
      if (!name.startsWith('chansonade.practice.')) continue;
      try {
        const value = JSON.parse(localStorage.getItem(name)!);
        if (value && Array.isArray(value.parts)) settings.push([name.slice('chansonade.practice.'.length), value]);
      } catch { /* A damaged legacy preference must not prevent opening the library. */ }
    }
  } catch { /* IndexedDB still works when localStorage is unavailable. */ }
  await transaction(connection, ['resources', 'meta'], 'readwrite', async (tx) => {
    const store = tx.objectStore('resources');
    for (const score of scores) if (!await requestValue(store.get(key(ANONYMOUS_SCOPE, 'score', score.id)))) store.put(localRecord(ANONYMOUS_SCOPE, 'score', score.id, score));
    for (const [id, value] of settings) if (!await requestValue(store.get(key(ANONYMOUS_SCOPE, 'settings', id)))) store.put(localRecord(ANONYMOUS_SCOPE, 'settings', id, value));
    tx.objectStore('meta').put(true, 'scoped-v4');
  });
}

export async function savedScores(scope = activeScope): Promise<SavedScore[]> {
  const connection = await db();
  const records = await requestValue<LocalResource[]>(connection.transaction('resources').objectStore('resources').index('scopeKind').getAll([scope, 'score']));
  return records.filter((record) => !record.deleted && record.data).map((record) => record.data as SavedScore).sort((a, b) => b.added - a.added);
}
export async function readSettings(id: string, scope = activeScope): Promise<PracticeSettings | null> {
  const connection = await db();
  const record = await requestValue<LocalResource | undefined>(connection.transaction('resources').objectStore('resources').get(key(scope, 'settings', id)));
  return record && !record.deleted ? record.data as PracticeSettings : null;
}
async function writeResource(kind: ResourceKind, id: string, data: ResourceData | null, scope: string) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async (tx) => {
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    const existing = await requestValue<LocalResource | undefined>(resources.get(key(scope, kind, id)));
    if (existing && JSON.stringify(existing.data) === JSON.stringify(data) && existing.deleted === (data === null)) return;
    const record = existing || localRecord(scope, kind, id, data);
    record.data = data; record.deleted = data === null; record.change++; record.dirty = scope !== ANONYMOUS_SCOPE;
    resources.put(record);
    if (record.dirty && !record.conflict) {
      const queued = await requestValue<PendingMutation | undefined>(outbox.get(key(scope, kind, id)));
      // Once sent, this request is immutable until acknowledgement. A newer
      // edit stays in the resource and becomes the next mutation after ack.
      if (!queued?.sent) outbox.put(queueFor(record));
    }
  });
  changed(scope, 'write');
}
export function saveScore(score: SavedScore, scope = activeScope) { return writeResource('score', score.id, score, scope); }
export function writeSettings(id: string, settings: PracticeSettings, scope = activeScope) { return writeResource('settings', id, settings, scope); }
export function deleteScore(id: string, scope = activeScope) { return writeResource('score', id, null, scope); }
export async function pendingMutations(scope: string): Promise<PendingMutation[]> {
  const connection = await db();
  return requestValue(connection.transaction('outbox').objectStore('outbox').index('scope').getAll(scope));
}
export async function markMutationSent(mutation: PendingMutation): Promise<boolean> {
  const connection = await db();
  return transaction(connection, ['outbox'], 'readwrite', async (tx) => {
    const store = tx.objectStore('outbox');
    const current = await requestValue<PendingMutation | undefined>(store.get(key(mutation.scope, mutation.kind, mutation.id)));
    if (!current || current.mutationId !== mutation.mutationId) return false;
    current.sent = true; store.put(current);
    return true;
  });
}
export async function releaseRejectedMutation(mutation: PendingMutation) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async (tx) => {
    const outbox = tx.objectStore('outbox');
    const recordKey = key(mutation.scope, mutation.kind, mutation.id);
    const queued = await requestValue<PendingMutation | undefined>(outbox.get(recordKey));
    const record = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(recordKey));
    if (!queued || !record || queued.mutationId !== mutation.mutationId) return;
    // A validation rejection is definitive: no server write occurred. A later
    // edit may replace this payload; network failures keep it immutable.
    if (record.change !== queued.change) outbox.put(queueFor(record));
    else { queued.sent = false; outbox.put(queued); }
  });
}
export async function acceptMutation(scope: string, mutationId: string, status: 'applied' | 'conflict', remote: RemoteResource) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async (tx) => {
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    const recordKey = key(scope, remote.kind, remote.id);
    const queued = await requestValue<PendingMutation | undefined>(outbox.get(recordKey));
    const record = await requestValue<LocalResource | undefined>(resources.get(recordKey));
    if (!queued || !record || queued.mutationId !== mutationId) return;
    outbox.delete(recordKey);
    record.revision = remote.revision;
    if (status === 'conflict') {
      record.conflict = remote;
      record.dirty = true;
    } else if (record.change !== queued.change) {
      record.conflict = null;
      record.dirty = true;
      outbox.put(queueFor(record));
    } else {
      record.data = remote.data; record.deleted = remote.deleted;
      record.conflict = null; record.dirty = false;
    }
    resources.put(record);
  });
  changed(scope, 'remote');
}
export async function applyRemoteChanges(scope: string, remote: RemoteResource[], cursor: number) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    for (const incoming of remote) {
      const recordKey = key(scope, incoming.kind, incoming.id);
      const record = await requestValue<LocalResource | undefined>(resources.get(recordKey));
      if (record && record.revision >= incoming.revision) continue;
      if (record?.dirty && (record.deleted !== incoming.deleted || JSON.stringify(record.data) !== JSON.stringify(incoming.data))) {
        record.revision = incoming.revision; record.conflict = incoming;
        outbox.delete(recordKey);
        resources.put(record);
      } else {
        resources.put({ ...incoming, scope, change: (record?.change || 0) + 1, dirty: false, conflict: null } satisfies LocalResource);
        outbox.delete(recordKey);
      }
    }
    tx.objectStore('meta').put(cursor, `sync.cursor.${scope}`);
  });
  changed(scope, 'remote');
}
export async function syncCursor(scope: string): Promise<number> {
  const connection = await db();
  return (await requestValue(connection.transaction('meta').objectStore('meta').get(`sync.cursor.${scope}`))) || 0;
}
export async function syncConflicts(scope: string): Promise<LocalResource[]> {
  const connection = await db();
  const resources = await requestValue<LocalResource[]>(connection.transaction('resources').objectStore('resources').index('scope').getAll(scope));
  return resources.filter((record) => record.conflict);
}
export async function resolveSyncConflict(scope: string, kind: ResourceKind, id: string, keepLocal: boolean) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async (tx) => {
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    const recordKey = key(scope, kind, id);
    const record = await requestValue<LocalResource | undefined>(resources.get(recordKey));
    if (!record?.conflict) return;
    const remote = record.conflict;
    record.conflict = null; record.revision = remote.revision; record.change++;
    record.dirty = keepLocal;
    if (keepLocal) outbox.put(queueFor(record));
    else { record.data = remote.data; record.deleted = remote.deleted; outbox.delete(recordKey); }
    resources.put(record);
  });
  changed(scope, 'write');
}
export async function importAnonymousLibrary(scope: string): Promise<number> {
  if (scope === ANONYMOUS_SCOPE) return 0;
  const connection = await db();
  const local = await requestValue<LocalResource[]>(connection.transaction('resources').objectStore('resources').index('scope').getAll(ANONYMOUS_SCOPE));
  let count = 0;
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async (tx) => {
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    for (const source of local) {
      if (source.deleted) continue;
      const recordKey = key(scope, source.kind, source.id);
      const existing = await requestValue<LocalResource | undefined>(resources.get(recordKey));
      if (existing && JSON.stringify(existing.data) === JSON.stringify(source.data) && !existing.deleted) continue;
      // Import is explicit; if both libraries already contain different values,
      // retain both and let the person choose rather than silently replace one.
      if (existing) {
        const remote: RemoteResource = existing.conflict || { kind: existing.kind, id: existing.id, data: existing.data, deleted: existing.deleted, revision: existing.revision };
        resources.put({ ...existing, data: source.data, deleted: false, dirty: true, change: existing.change + 1, conflict: remote });
        outbox.delete(recordKey);
      } else {
        const record = { ...source, scope, revision: 0, dirty: true, change: 1, conflict: null };
        resources.put(record); outbox.put(queueFor(record));
      }
      count++;
    }
  });
  changed(scope, 'write');
  return count;
}
