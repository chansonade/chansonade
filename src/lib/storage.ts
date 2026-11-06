import { projectOrganization, folderFor, type FolderData, type PlacementData, type ItemKind, type Organization, type OrganizationItem, type OrganizationTarget } from './organization';

export type SavedScore = { id: string; title: string; composer: string; xml: string; added: number };
export type PracticeSettings = { rate: number; loopA: number | null; loopB: number | null; loopEnabled: boolean; target: number; parts: { channel: number; volume: number; muted: boolean; solo: boolean; transpose: number; program: number }[] };
export type TakePitch = {
  time: number; frequency: number; rawFrequency: number; clarity: number; rms: number;
  midi: number; cents: number; scoreTime: number; expectedPitch: number | null;
  noteId: string | null; targetChannel: number; playing: boolean;
  staff?: number; transpose?: number; epoch?: number;
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
    const request = indexedDB.open('chansonade', 5);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('scores')) request.result.createObjectStore('scores', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('takes')) {
        request.result.createObjectStore('takes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (!request.result.objectStoreNames.contains('takeData')) request.result.createObjectStore('takeData', { keyPath: ['scope', 'id'] });
      if (!request.result.objectStoreNames.contains('takeIndex')) {
        const takes = request.result.createObjectStore('takeIndex', { keyPath: ['scope', 'id'] });
        takes.createIndex('scope', 'scope');
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
    try { await migrateLocalDatabase(connection); await migrateScopedData(connection); await migrateTakes(connection); await migrateSyncQueue(connection); return connection; }
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

export type TakeSummary = {
  id: string; createdAt: number; title: string; duration: number; scoreId: string;
  synced: boolean; pending: boolean;
};
type TakeIndex = Omit<TakeSummary, 'synced' | 'pending'> & { scope: string; deleted: boolean; change: number };
type TakeData = { scope: string; id: string; take: RecordedTake };

function takeSummary(take: RecordedTake, scope: string): TakeIndex {
  return { scope, id: take.id, createdAt: take.createdAt, title: take.title, duration: take.duration,
    scoreId: take.scoreId, deleted: false, change: 1 };
}

// The old, unscoped store remains untouched as a recovery copy. The marker and
// new records commit together, so interrupted upgrades can be retried safely.
async function migrateTakes(connection: IDBDatabase) {
  await transaction(connection, ['takes', 'takeData', 'takeIndex', 'meta'], 'readwrite', async tx => {
    const meta = tx.objectStore('meta');
    if (await requestValue(meta.get('takes-scoped-v5'))) return;
    const source = tx.objectStore('takes');
    await new Promise<void>((resolve, reject) => {
      const request = source.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const take = cursor.value as RecordedTake;
        tx.objectStore('takeData').put({ scope: ANONYMOUS_SCOPE, id: take.id, take } satisfies TakeData);
        tx.objectStore('takeIndex').put(takeSummary(take, ANONYMOUS_SCOPE));
        cursor.continue();
      };
    });
    meta.put(true, 'takes-scoped-v5');
  });
}

export async function saveTake(take: RecordedTake, scope = activeScope) {
  const connection = await db();
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const organization = await organizationInTransaction(tx, scope);
    const folderId = folderFor(organization, 'score', take.scoreId);
    const index = tx.objectStore('takeIndex');
    const old = await requestValue<TakeIndex | undefined>(index.get([scope, take.id]));
    if (old) throw new Error('Cet essai existe déjà.');
    tx.objectStore('takeData').put({ scope, id: take.id, take } satisfies TakeData);
    index.put(takeSummary(take, scope));
    if (scope !== ANONYMOUS_SCOPE) tx.objectStore('outbox').put(takeJob(scope, take.id, take.title, 1, 'upload'));
    if (folderId !== null) {
      await writeResourceInTransaction(tx, 'organization', `take.${take.id}`, { type: 'placement', itemKind: 'take', itemId: take.id, folderId }, scope);
    }
  });
  changed(scope, 'write');
}
export async function listTakes(scope = activeScope): Promise<TakeSummary[]> {
  return (await takeSyncEntries(scope)).filter(record => !record.deleted).sort((a,b) => b.createdAt - a.createdAt);
}
export async function getTake(id: string, scope = activeScope): Promise<RecordedTake | null> {
  const connection = await db();
  return transaction(connection, ['takeData', 'takeIndex'], 'readonly', async tx => {
    const index = await requestValue<TakeIndex | undefined>(tx.objectStore('takeIndex').get([scope, id]));
    if (!index || index.deleted) return null;
    const data = await requestValue<TakeData | undefined>(tx.objectStore('takeData').get([scope, id]));
    return data?.take || null;
  });
}
export async function latestTake(scope = activeScope): Promise<RecordedTake | null> {
  const [takes, organization] = await Promise.all([listTakes(scope), readOrganization(scope)]);
  const latest = takes.find(take => organization.matches('take', take.id));
  return latest ? getTake(latest.id, scope) : null;
}
async function deleteTakeInTransaction(tx: IDBTransaction, id: string, scope: string) {
  const index = tx.objectStore('takeIndex');
  const record = await requestValue<TakeIndex | undefined>(index.get([scope, id]));
  if (record?.deleted) return;
  const job = await requestValue<PendingTake | undefined>(tx.objectStore('outbox').get(key(scope, 'take', id)));
  const tombstone: TakeIndex = { scope, id, title: record?.title ?? job?.title ?? id, createdAt: record?.createdAt ?? 0,
    scoreId: record?.scoreId ?? '', duration: record?.duration ?? 0, deleted: true, change: (record?.change ?? 0) + 1 };
  index.put(tombstone); tx.objectStore('takeData').delete([scope, id]);
  if (scope !== ANONYMOUS_SCOPE) tx.objectStore('outbox').put(takeJob(scope, id, tombstone.title, tombstone.change, 'delete'));
  const placement = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'organization', `take.${id}`)));
  if (placement && !placement.deleted) await writeResourceInTransaction(tx, 'organization', `take.${id}`, null, scope);
}
export async function deleteTake(id: string, scope = activeScope) {
  const connection = await db();
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    await deleteTakeInTransaction(tx, id, scope);
  });
  changed(scope, 'write');
}

/** Move unassigned takes into the signed-in account without copying other accounts. */
export async function claimAnonymousTakes(scope: string) {
  if (scope === ANONYMOUS_SCOPE) return;
  const connection = await db();
  let moved = false;
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const index = tx.objectStore('takeIndex'), data = tx.objectStore('takeData'), resources = tx.objectStore('resources');
    const records = await requestValue<TakeIndex[]>(index.index('scope').getAll(ANONYMOUS_SCOPE));
    for (const record of records) {
      if (record.deleted) continue;
      const source = await requestValue<TakeData | undefined>(data.get([ANONYMOUS_SCOPE, record.id]));
      if (!source) continue;
      let id = record.id;
      if (await requestValue(index.get([scope, id]))) id = crypto.randomUUID();
      const take = id === source.id ? source.take : { ...source.take, id };
      data.put({ scope, id, take } satisfies TakeData);
      index.put({ ...takeSummary(take, scope), change: record.change + 1 });
      tx.objectStore('outbox').put(takeJob(scope, id, take.title, record.change + 1, 'upload'));
      const placement = await requestValue<LocalResource | undefined>(resources.get(key(ANONYMOUS_SCOPE, 'organization', `take.${record.id}`)));
      if (placement && !placement.deleted && placement.data && 'type' in placement.data && placement.data.type === 'placement') {
        await writeResourceInTransaction(tx, 'organization', `take.${id}`, { ...placement.data, itemId: id }, scope);
        resources.delete(key(ANONYMOUS_SCOPE, 'organization', `take.${record.id}`));
      }
      data.delete([ANONYMOUS_SCOPE, record.id]); index.delete([ANONYMOUS_SCOPE, record.id]); moved = true;
    }
  });
  if (moved) changed(scope, 'write');
}

export async function takeSyncEntries(scope: string) {
  const connection = await db();
  return transaction(connection, ['takeIndex', 'outbox'], 'readonly', async tx => {
    const records = await requestValue<TakeIndex[]>(tx.objectStore('takeIndex').index('scope').getAll(scope));
    const jobs = new Map((await requestValue<SyncJob[]>(tx.objectStore('outbox').index('scope').getAll(scope))).filter(job => job.kind === 'take').map(job => [job.id, job]));
    return records.map(record => ({ ...record, pending: jobs.has(record.id), synced: scope !== ANONYMOUS_SCOPE && !jobs.has(record.id) }));
  });
}
export async function acknowledgeTake(scope: string, id: string, change: number) {
  const connection = await db();
  await transaction(connection, ['outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const store = tx.objectStore('outbox');
    const job = await requestValue<PendingTake | undefined>(store.get(key(scope, 'take', id)));
    if (job?.change === change) store.delete(key(scope, 'take', id));
  });
  changed(scope, 'remote');
}

/** Reconcile the complete remote collection with transfers and tombstones. */
export async function queueRemoteTakes(scope: string, remote: readonly { id: string; title?: string; deleted: boolean; ready: boolean }[]) {
  const connection = await db();
  let didChange = false;
  const jobs = await transaction(connection, ['outbox', 'takeIndex', 'takeData', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const outbox = tx.objectStore('outbox'), index = tx.objectStore('takeIndex');
    const remoteIds = new Set(remote.map(item => item.id));
    for (const job of await requestValue<SyncJob[]>(outbox.index('scope').getAll(scope))) {
      if (job.kind === 'take' && job.operation === 'download' && !remoteIds.has(job.id)) {
        outbox.delete(key(scope, 'take', job.id)); didChange = true;
      }
    }
    for (const item of remote) {
      if (item.deleted) { didChange = await applyRemoteTakeInTransaction(tx, scope, item.id, null) || didChange; continue; }
      if (!item.ready || await requestValue(index.get([scope, item.id])) || await requestValue(outbox.get(key(scope, 'take', item.id)))) continue;
      outbox.put(takeJob(scope, item.id, item.title || item.id, 0, 'download'));
    }
    return (await requestValue<SyncJob[]>(outbox.index('scope').getAll(scope))).filter((job): job is PendingTake => job.kind === 'take');
  });
  if (didChange) changed(scope, 'remote');
  return jobs;
}
export async function failTakeTransfer(job: PendingTake, error: string) {
  const connection = await db();
  await transaction(connection, ['outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, job.scope);
    const store = tx.objectStore('outbox'), recordKey = key(job.scope, 'take', job.id);
    const current = await requestValue<PendingTake | undefined>(store.get(recordKey));
    if (!current || current.change !== job.change || current.operation !== job.operation) return;
    current.attempt = { state: 'retry', error }; store.put(current);
  });
  changed(job.scope, 'remote');
}
export async function cacheTakeDigest(job: PendingTake, digest: string) {
  const connection = await db();
  await transaction(connection, ['outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, job.scope);
    const store = tx.objectStore('outbox'), recordKey = key(job.scope, 'take', job.id);
    const current = await requestValue<PendingTake | undefined>(store.get(recordKey));
    if (!current || current.change !== job.change || current.operation !== 'upload') return;
    current.audioSha256 = digest; store.put(current);
  });
}
async function applyRemoteTakeInTransaction(tx: IDBTransaction, scope: string, id: string, take: RecordedTake | null): Promise<boolean> {
  const index = tx.objectStore('takeIndex'), data = tx.objectStore('takeData'), outbox = tx.objectStore('outbox');
  const current = await requestValue<TakeIndex | undefined>(index.get([scope, id]));
  // A local deletion wins over an in-flight download; server tombstones win
  // over uploads. The transfer is completed in the same transaction as its data.
  if (take && current) return false;
  if (!take) {
    if (current?.deleted && !await requestValue(outbox.get(key(scope, 'take', id)))) return false;
    const tombstone: TakeIndex = current || { scope, id, createdAt: 0, title: '', duration: 0, scoreId: '', deleted: true, change: 0 };
    tombstone.deleted = true; tombstone.change++;
    index.put(tombstone); data.delete([scope, id]);
  } else {
    data.put({ scope, id, take } satisfies TakeData); index.put(takeSummary(take, scope));
  }
  outbox.delete(key(scope, 'take', id));
  return true;
}
export async function applyRemoteTake(scope: string, id: string, take: RecordedTake | null) {
  const connection = await db();
  const didChange = await transaction(connection, ['takeData', 'takeIndex', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    return applyRemoteTakeInTransaction(tx, scope, id, take);
  });
  if (didChange) changed(scope, 'remote');
}

export type ResourceKind = 'score' | 'settings' | 'organization';
export type ResourceData = SavedScore | PracticeSettings | FolderData | PlacementData;
export type RemoteResource = { kind: ResourceKind; id: string; data: ResourceData | null; revision: number; deleted: boolean };
export type Mutation = { mutationId: string; kind: ResourceKind; id: string; baseRevision: number; data: ResourceData | null; deleted: boolean };
export type SyncAttempt = { state: 'queued' | 'sent' } | { state: 'rejected' | 'retry'; error: string };
type QueuedWork = { scope: string; change: number; title: string; attempt: SyncAttempt };
export type PendingMutation = Mutation & QueuedWork;
export type PendingTake = QueuedWork & { kind: 'take'; id: string; operation: 'upload' | 'download' | 'delete'; audioSha256?: string };
export type SyncJob = PendingMutation | PendingTake;
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
function key(scope: string, kind: ResourceKind | 'take', id: string) { return [scope, kind, id]; }
function queueFor(record: LocalResource): PendingMutation {
  return { scope: record.scope, kind: record.kind, id: record.id, mutationId: crypto.randomUUID(), baseRevision: record.revision, data: record.data, deleted: record.deleted, change: record.change, title: record.data && 'title' in record.data ? record.data.title : record.id, attempt: { state: 'queued' } };
}
function takeJob(scope: string, id: string, title: string, change: number, operation: PendingTake['operation']): PendingTake {
  return { scope, kind: 'take', id, title, change, operation, attempt: { state: 'queued' } };
}
async function migrateSyncQueue(connection: IDBDatabase) {
  await transaction(connection, ['outbox', 'takeIndex', 'meta'], 'readwrite', async tx => {
    const meta = tx.objectStore('meta');
    if (await requestValue(meta.get('sync-queue-v1'))) return;
    const outbox = tx.objectStore('outbox');
    type OldMutation = Mutation & { scope: string; change: number; sent: boolean; error?: string };
    for (const old of await requestValue<OldMutation[]>(outbox.getAll())) {
      const { sent, error, ...mutation } = old;
      outbox.put({ ...mutation, title: mutation.data && 'title' in mutation.data ? mutation.data.title : mutation.id,
        attempt: error ? { state: 'rejected', error } : { state: sent ? 'sent' : 'queued' } } satisfies PendingMutation);
    }
    const index = tx.objectStore('takeIndex');
    for (const old of await requestValue<(TakeIndex & { pending?: boolean; synced?: boolean })[]>(index.getAll())) {
      const { pending, synced: _synced, ...record } = old;
      index.put(record);
      if (pending && record.scope !== ANONYMOUS_SCOPE) outbox.put(takeJob(record.scope, record.id, record.title, record.change, record.deleted ? 'delete' : 'upload'));
    }
    meta.put(true, 'sync-queue-v1');
  });
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
async function writeResourceInTransaction(tx: IDBTransaction, kind: ResourceKind, id: string, data: ResourceData | null, scope: string) {
  await assertAccountPresent(tx, scope);
  const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
  const existing = await requestValue<LocalResource | undefined>(resources.get(key(scope, kind, id)));
  if (existing && JSON.stringify(existing.data) === JSON.stringify(data) && existing.deleted === (data === null)) return;
  const record = existing || localRecord(scope, kind, id, data);
  record.data = data; record.deleted = data === null; record.change++; record.dirty = scope !== ANONYMOUS_SCOPE;
  resources.put(record);
  if (record.dirty && !record.conflict) {
    const queued = await requestValue<PendingMutation | undefined>(outbox.get(key(scope, kind, id)));
    if (queued?.attempt.state !== 'sent') outbox.put(queueFor(record));
  }
}
async function writeResource(kind: ResourceKind, id: string, data: ResourceData | null, scope: string) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', tx => writeResourceInTransaction(tx, kind, id, data, scope));
  changed(scope, 'write');
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkedFolderName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 100) throw new Error('Le nom du dossier doit contenir entre 1 et 100 caractères.');
  return value;
}
function checkFolderId(id: string) { if (!uuidPattern.test(id)) throw new Error('Identifiant de dossier invalide.'); }
function checkedItem(kind: 'score' | 'take', id: string) {
  if (kind === 'take' ? !uuidPattern.test(id) : !/^[A-Za-z0-9][A-Za-z0-9._-]{0,193}$/.test(id)) throw new Error('Identifiant invalide.');
}
async function organizationInTransaction(tx: IDBTransaction, scope: string): Promise<Organization> {
  const records = await requestValue<LocalResource[]>(tx.objectStore('resources').index('scopeKind').getAll([scope, 'organization']));
  const folders: { id: string; data: FolderData }[] = [], placements: Record<string, PlacementData> = {};
  for (const record of records) {
    if (record.deleted || !record.data || !('type' in record.data)) continue;
    if (record.data.type === 'folder') folders.push({ id: record.id.slice(7), data: record.data });
    else if (record.data.type === 'placement') placements[`${record.data.itemKind}:${record.data.itemId}`] = record.data;
  }
  return projectOrganization({ folders, placements });
}
async function organizationTakesInTransaction(tx: IDBTransaction, scope: string): Promise<{ id: string; title: string }[]> {
  const takes = await requestValue<TakeIndex[]>(tx.objectStore('takeIndex').index('scope').getAll(scope));
  const jobs = await requestValue<PendingTake[]>(tx.objectStore('outbox').getAll(IDBKeyRange.bound(key(scope, 'take', ''), key(scope, 'take', '\uffff'))));
  const items = new Map(takes.filter(take => !take.deleted).map(take => [take.id, { id: take.id, title: take.title }]));
  for (const job of jobs) if (job.operation === 'download') items.set(job.id, { id: job.id, title: job.title });
  return [...items.values()];
}
/** Small inventory for trash, including remote takes not downloaded yet. */
export async function organizationTakes(scope = activeScope) {
  return transaction(await db(), ['takeIndex', 'outbox'], 'readonly', tx => organizationTakesInTransaction(tx, scope));
}
export async function readOrganization(scope = activeScope): Promise<Organization> {
  const connection = await db();
  return transaction(connection, ['resources'], 'readonly', tx => organizationInTransaction(tx, scope));
}
async function changeOrganization<T>(scope: string, operation: (tx: IDBTransaction, organization: Organization) => Promise<T>): Promise<T> {
  const connection = await db();
  const result = await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    return operation(tx, await organizationInTransaction(tx, scope));
  });
  changed(scope, 'write');
  return result;
}
function activeFolder(organization: Organization, id: string) {
  checkFolderId(id);
  const folder = organization.folder(id);
  if (!folder || folder.trashed) throw new Error('Dossier introuvable.');
  return folder;
}
export async function createFolder(name: string, parentId: string | null = null, scope = activeScope): Promise<string> {
  const value = checkedFolderName(name), id = crypto.randomUUID();
  return changeOrganization(scope, async (tx, organization) => {
    if (parentId !== null) activeFolder(organization, parentId);
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { type: 'folder', name: value, added: Date.now(), parentId }, scope);
    return id;
  });
}
export async function renameFolder(id: string, name: string, scope = activeScope): Promise<void> {
  const value = checkedFolderName(name);
  return changeOrganization(scope, async (tx, organization) => {
    const folder = activeFolder(organization, id);
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { ...folder.data, name: value }, scope);
  });
}
export async function moveFolder(id: string, parentId: string | null, scope = activeScope): Promise<void> {
  return changeOrganization(scope, async (tx, organization) => {
    const folder = activeFolder(organization, id);
    if (parentId !== null) {
      activeFolder(organization, parentId);
      if (organization.contains(id, parentId)) throw new Error('Impossible de déplacer un dossier dans son propre sous-arbre.');
    }
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { ...folder.data, parentId }, scope);
  });
}
export async function trashFolder(id: string, scope = activeScope): Promise<void> {
  return changeOrganization(scope, async (tx, organization) => {
    const folder = activeFolder(organization, id);
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { ...folder.data, trashedAt: Date.now() }, scope);
  });
}
export async function restoreFolder(id: string, scope = activeScope): Promise<void> {
  return changeOrganization(scope, async (tx, organization) => {
    checkFolderId(id);
    const folder = organization.folder(id);
    if (!folder) throw new Error('Dossier introuvable.');
    if (!folder.trashed) return;
    const parent = folder.parentId === null ? undefined : organization.folder(folder.parentId);
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { ...folder.data, trashedAt: null, parentId: parent && !parent.trashed ? parent.id : null }, scope);
  });
}
async function itemPlacement(tx: IDBTransaction, kind: ItemKind, id: string, scope: string): Promise<PlacementData> {
  checkedItem(kind, id);
  const record = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'organization', `${kind}.${id}`)));
  return record && !record.deleted && record.data && 'type' in record.data && record.data.type === 'placement'
    ? record.data : { type: 'placement', itemKind: kind, itemId: id, folderId: null };
}
export async function moveItem(kind: ItemKind, id: string, folderId: string | null, scope = activeScope): Promise<void> {
  return changeOrganization(scope, async (tx, organization) => {
    if (folderId !== null) activeFolder(organization, folderId);
    const placement = await itemPlacement(tx, kind, id, scope);
    await writeResourceInTransaction(tx, 'organization', `${kind}.${id}`, { ...placement, folderId }, scope);
  });
}
export async function trashItem(kind: ItemKind, id: string, scope = activeScope): Promise<void> {
  return changeOrganization(scope, async tx => {
    const placement = await itemPlacement(tx, kind, id, scope);
    await writeResourceInTransaction(tx, 'organization', `${kind}.${id}`, { ...placement, trashedAt: placement.trashedAt ?? Date.now() }, scope);
  });
}
async function restoreItemInTransaction(tx: IDBTransaction, organization: Organization, kind: ItemKind, id: string, scope: string) {
  const location = organization.classify(kind, id);
  if (location.state !== 'trash') return;
  const placement = await itemPlacement(tx, kind, id, scope);
  const folder = location.folderId === null ? undefined : organization.folder(location.folderId);
  await writeResourceInTransaction(tx, 'organization', `${kind}.${id}`, { ...placement, trashedAt: null, folderId: folder && !folder.trashed ? folder.id : null }, scope);
}
export async function restoreItem(kind: ItemKind, id: string, scope = activeScope): Promise<void> {
  return changeOrganization(scope, (tx, organization) => restoreItemInTransaction(tx, organization, kind, id, scope));
}
async function deleteScoreInTransaction(tx: IDBTransaction, id: string, scope: string) {
  await writeResourceInTransaction(tx, 'score', id, null, scope);
  for (const [kind, resourceId] of [['settings', id], ['organization', `score.${id}`]] as const) {
    const record = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, kind, resourceId)));
    if (record && !record.deleted) await writeResourceInTransaction(tx, kind, resourceId, null, scope);
  }
}
/** Purge only the trash selected inside this transaction; use ordinary sync conflicts and take tombstones. */
export async function purgeTrash(selection: OrganizationTarget | 'all', scope = activeScope): Promise<void> {
  const connection = await db();
  await transaction(connection, ['resources', 'takeData', 'takeIndex', 'outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const organization = await organizationInTransaction(tx, scope);
    // Score keys include tombstones. Deleting an existing tombstone is a no-op;
    // only selected score values are read by the ordinary deletion primitive.
    const scoreKeys = await requestValue(tx.objectStore('resources').index('scopeKind').getAllKeys([scope, 'score']));
    const takes = await organizationTakesInTransaction(tx, scope);
    const candidates = new Map<string, OrganizationItem>();
    for (const recordKey of scoreKeys) {
      const id = (recordKey as string[])[2];
      candidates.set(`score:${id}`, { kind: 'score', id });
    }
    for (const take of takes) candidates.set(`take:${take.id}`, { kind: 'take', id: take.id });
    const contents = organization.trashContents([...candidates.values()], selection);
    if (selection !== 'all' && !contents.length) throw new Error('Cet élément n’est pas dans la corbeille.');
    const folders = new Set(contents.filter(item => item.kind === 'folder').map(item => item.id));
    const items = contents.filter((item): item is OrganizationItem => item.kind !== 'folder');
    for (const item of items) {
      if (item.kind === 'score') await deleteScoreInTransaction(tx, item.id, scope);
      else await deleteTakeInTransaction(tx, item.id, scope);
    }
    for (const id of folders) await writeResourceInTransaction(tx, 'organization', `folder.${id}`, null, scope);
    // Remove dangling placements in the purged subtree as well, without inventing missing files.
    const records = await requestValue<LocalResource[]>(tx.objectStore('resources').index('scopeKind').getAll([scope, 'organization']));
    for (const record of records) if (!record.deleted && record.data && 'type' in record.data && record.data.type === 'placement') {
      const location = organization.classify(record.data.itemKind, record.data.itemId);
      if (location.folderId !== null && folders.has(location.folderId) || (selection === 'all' && location.state === 'trash')) await writeResourceInTransaction(tx, 'organization', record.id, null, scope);
    }
  });
  changed(scope, 'write');
}
/** Add once, restore if needed, and place only new scores, in one transaction. */
export async function addScoreToLibrary(score: SavedScore, folderId: string | null, scope: string, signal: AbortSignal): Promise<void> {
  return changeOrganization(scope, async (tx, organization) => {
    signal.throwIfAborted();
    const abort = () => tx.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    tx.addEventListener('complete', cleanup, { once: true });
    tx.addEventListener('abort', cleanup, { once: true });
    const existing = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'score', score.id)));
    if (existing && !existing.deleted && existing.data) {
      await restoreItemInTransaction(tx, organization, 'score', score.id, scope);
      return;
    }
    await writeResourceInTransaction(tx, 'score', score.id, score, scope);
    const placement = await itemPlacement(tx, 'score', score.id, scope);
    const folder = folderId === null ? undefined : organization.folder(folderId);
    await writeResourceInTransaction(tx, 'organization', `score.${score.id}`, {
      ...placement, folderId: folder && !folder.trashed ? folder.id : null, trashedAt: null,
    }, scope);
  });
}
export function saveScore(score: SavedScore, scope = activeScope) { return writeResource('score', score.id, score, scope); }
export function writeSettings(id: string, settings: PracticeSettings, scope = activeScope) { return writeResource('settings', id, settings, scope); }
export async function deleteScore(id: string, scope = activeScope) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', tx => deleteScoreInTransaction(tx, id, scope));
  changed(scope, 'write');
}
export async function syncQueue(scope: string): Promise<SyncJob[]> {
  const connection = await db();
  return requestValue(connection.transaction('outbox').objectStore('outbox').index('scope').getAll(scope));
}
export async function pendingMutations(scope: string): Promise<PendingMutation[]> {
  return (await syncQueue(scope)).filter((job): job is PendingMutation => job.kind !== 'take');
}
export async function pendingTakes(scope: string): Promise<PendingTake[]> {
  return (await syncQueue(scope)).filter((job): job is PendingTake => job.kind === 'take');
}
export async function rearmRejectedMutations(scope: string) {
  const connection = await db();
  await transaction(connection, ['outbox', 'meta'], 'readwrite', async tx => {
    await assertAccountPresent(tx, scope);
    const store = tx.objectStore('outbox');
    for (const job of await requestValue<SyncJob[]>(store.index('scope').getAll(scope))) {
      if (job.attempt.state === 'rejected') { job.attempt = { state: 'queued' }; store.put(job); }
    }
  });
}
export async function markMutationSent(mutation: PendingMutation): Promise<boolean> {
  const connection = await db();
  return transaction(connection, ['outbox', 'meta'], 'readwrite', async (tx) => {
    await assertAccountPresent(tx, mutation.scope);
    const store = tx.objectStore('outbox');
    const current = await requestValue<PendingMutation | undefined>(store.get(key(mutation.scope, mutation.kind, mutation.id)));
    if (!current || current.mutationId !== mutation.mutationId || current.attempt.state === 'rejected') return false;
    current.attempt = { state: 'sent' }; store.put(current);
    return true;
  });
}
export async function releaseRejectedMutation(mutation: PendingMutation, error: string) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
    await assertAccountPresent(tx, mutation.scope);
    const outbox = tx.objectStore('outbox');
    const recordKey = key(mutation.scope, mutation.kind, mutation.id);
    const queued = await requestValue<PendingMutation | undefined>(outbox.get(recordKey));
    const record = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(recordKey));
    if (!queued || !record || queued.mutationId !== mutation.mutationId) return;
    // A validation rejection is definitive: no server write occurred. A later
    // edit may replace this payload; network failures keep it immutable.
    if (record.change !== queued.change) outbox.put(queueFor(record));
    else { queued.attempt = { state: 'rejected', error }; outbox.put(queued); }
  });
}
export async function acceptMutation(scope: string, mutationId: string, status: 'applied' | 'conflict', remote: RemoteResource) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
    await assertAccountPresent(tx, scope);
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
    await assertAccountPresent(tx, scope);
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
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
    await assertAccountPresent(tx, scope);
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    const recordKey = key(scope, kind, id);
    const record = await requestValue<LocalResource | undefined>(resources.get(recordKey));
    if (!record?.conflict) return;
    const remote = record.conflict;
    tx.objectStore('meta').put(keepLocal ? remote : { kind, id, data: record.data, revision: record.revision, deleted: record.deleted }, `sync.backup.${scope}.${kind}.${id}.${remote.revision}`);
    record.conflict = null; record.revision = remote.revision; record.change++;
    record.dirty = keepLocal;
    if (keepLocal) outbox.put(queueFor(record));
    else { record.data = remote.data; record.deleted = remote.deleted; outbox.delete(recordKey); }
    resources.put(record);
  });
  changed(scope, 'write');
}
export async function claimAnonymousLibrary(scope: string): Promise<number> {
  if (scope === ANONYMOUS_SCOPE) return 0;
  const connection = await db();
  let count = 0;
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
    await assertAccountPresent(tx, scope);
    const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
    const local = await requestValue<LocalResource[]>(resources.index('scope').getAll(ANONYMOUS_SCOPE));
    for (const source of local) {
      if (source.kind === 'organization' && source.id.startsWith('take.')) continue;
      resources.delete(key(ANONYMOUS_SCOPE, source.kind, source.id));
      if (source.deleted) continue;
      const recordKey = key(scope, source.kind, source.id);
      const existing = await requestValue<LocalResource | undefined>(resources.get(recordKey));
      if (existing && JSON.stringify(existing.data) === JSON.stringify(source.data) && !existing.deleted) continue;
      // Pending local edits take precedence; retain the other version locally.
      if (existing) {
        const remote: RemoteResource = existing.conflict || { kind: existing.kind, id: existing.id, data: existing.data, deleted: existing.deleted, revision: existing.revision };
        tx.objectStore('meta').put(remote, `sync.backup.${scope}.${source.kind}.${source.id}.${remote.revision}`);
        const record = { ...existing, data: source.data, deleted: false, dirty: true, change: existing.change + 1, conflict: null };
        resources.put(record); outbox.put(queueFor(record));
      } else {
        const record = { ...source, scope, revision: 0, dirty: true, change: 1, conflict: null };
        resources.put(record); outbox.put(queueFor(record));
      }
      count++;
    }
  });
  if (count) changed(scope, 'write');
  return count;
}

async function assertAccountPresent(tx: IDBTransaction, scope: string) {
  if (scope !== ANONYMOUS_SCOPE && await requestValue(tx.objectStore('meta').get(`account.deleted.${scope}`))) throw new Error('Ce compte a été supprimé.');
}

/** Forget this account on this browser; never move its files to anonymous. */
export async function forgetAccountScope(scope: string): Promise<void> {
  if (!scope.startsWith('user:')) throw new Error('Compte invalide.');
  const connection = await db();
  const scoreIds: string[] = [], takeIds: string[] = [];
  await transaction(connection, ['resources', 'outbox', 'takeIndex', 'takeData', 'meta', 'scores', 'takes'], 'readwrite', async tx => {
    const resources = tx.objectStore('resources');
    const records = await requestValue<LocalResource[]>(resources.index('scope').getAll(scope));
    for (const record of records) {
      resources.delete(key(scope, record.kind, record.id));
      if (record.kind === 'score') { scoreIds.push(record.id); tx.objectStore('scores').delete(record.id); }
    }
    const outbox = tx.objectStore('outbox');
    for (const recordKey of await requestValue(outbox.index('scope').getAllKeys(scope))) outbox.delete(recordKey);
    const takes = tx.objectStore('takeIndex');
    for (const take of await requestValue<TakeIndex[]>(takes.index('scope').getAll(scope))) {
      takeIds.push(take.id); takes.delete([scope, take.id]);
      tx.objectStore('takeData').delete([scope, take.id]); tx.objectStore('takes').delete(take.id);
    }
    const meta = tx.objectStore('meta');
    meta.put(true, `account.deleted.${scope}`);
    for (const name of await requestValue(meta.getAllKeys())) {
      if (typeof name === 'string' && (name === `sync.cursor.${scope}` || name.startsWith(`sync.backup.${scope}.`))) meta.delete(name);
    }
  });
  // Discard matching recovery copies made by the application's previous name.
  const legacy = await new Promise<IDBDatabase | null>((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open(LEGACY_NAME);
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  if (legacy) {
    try {
      const names = ['scores', 'takes'].filter(name => legacy.objectStoreNames.contains(name));
      if (names.length) await transaction(legacy, names, 'readwrite', async tx => {
        if (names.includes('scores')) scoreIds.forEach(id => tx.objectStore('scores').delete(id));
        if (names.includes('takes')) takeIds.forEach(id => tx.objectStore('takes').delete(id));
      });
    } finally { legacy.close(); }
  }
  try { for (const id of scoreIds) { localStorage.removeItem(`chansonade.practice.${id}`); localStorage.removeItem(`${LEGACY_NAME}.practice.${id}`); } }
  catch { /* Account data in IndexedDB is already removed. */ }
  changed(scope, 'remote');
}
