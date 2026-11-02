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
    try { await migrateLocalDatabase(connection); await migrateScopedData(connection); await migrateTakes(connection); return connection; }
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
type TakeIndex = TakeSummary & { scope: string; deleted: boolean; change: number };
type TakeData = { scope: string; id: string; take: RecordedTake };

function takeSummary(take: RecordedTake, scope: string, pending: boolean): TakeIndex {
  return { scope, id: take.id, createdAt: take.createdAt, title: take.title, duration: take.duration,
    scoreId: take.scoreId, synced: scope !== ANONYMOUS_SCOPE && !pending, pending, deleted: false, change: 1 };
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
        tx.objectStore('takeIndex').put(takeSummary(take, ANONYMOUS_SCOPE, false));
        cursor.continue();
      };
    });
    meta.put(true, 'takes-scoped-v5');
  });
}

export async function saveTake(take: RecordedTake, scope = activeScope, folderId?: string | null) {
  const connection = await db();
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox'], 'readwrite', async tx => {
    if (folderId != null) checkFolderId(folderId);
    const index = tx.objectStore('takeIndex');
    const old = await requestValue<TakeIndex | undefined>(index.get([scope, take.id]));
    if (old) throw new Error('Cet essai existe déjà.');
    tx.objectStore('takeData').put({ scope, id: take.id, take } satisfies TakeData);
    index.put(takeSummary(take, scope, scope !== ANONYMOUS_SCOPE));
    if (folderId !== undefined) {
      checkedItem('take', take.id);
      await writeResourceInTransaction(tx, 'organization', `take.${take.id}`, { type: 'placement', itemKind: 'take', itemId: take.id, folderId }, scope);
    }
  });
  changed(scope, 'write');
}
export async function listTakes(scope = activeScope): Promise<TakeSummary[]> {
  const connection = await db();
  const records = await requestValue<TakeIndex[]>(connection.transaction('takeIndex').objectStore('takeIndex').index('scope').getAll(scope));
  return records.filter(record => !record.deleted).sort((a,b) => b.createdAt - a.createdAt).map(({ id, createdAt, title, duration, scoreId, synced, pending }) => ({ id, createdAt, title, duration, scoreId, synced: scope !== ANONYMOUS_SCOPE && synced, pending }));
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
  const [latest] = await listTakes(scope);
  return latest ? getTake(latest.id, scope) : null;
}
export async function deleteTake(id: string, scope = activeScope) {
  const connection = await db();
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox'], 'readwrite', async tx => {
    const index = tx.objectStore('takeIndex');
    const record = await requestValue<TakeIndex | undefined>(index.get([scope, id]));
    if (!record || record.deleted) return;
    record.deleted = true; record.pending = scope !== ANONYMOUS_SCOPE; record.synced = false; record.change++;
    index.put(record); tx.objectStore('takeData').delete([scope, id]);
    const placement = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'organization', `take.${id}`)));
    if (placement && !placement.deleted) await writeResourceInTransaction(tx, 'organization', `take.${id}`, null, scope);
  });
  changed(scope, 'write');
}

/** Move unassigned takes into the signed-in account without copying other accounts. */
export async function claimAnonymousTakes(scope: string) {
  if (scope === ANONYMOUS_SCOPE) return;
  const connection = await db();
  let moved = false;
  await transaction(connection, ['takeData', 'takeIndex', 'resources', 'outbox'], 'readwrite', async tx => {
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
      index.put({ ...takeSummary(take, scope, true), change: record.change + 1 });
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

export async function takeSyncEntries(scope: string): Promise<TakeIndex[]> {
  const connection = await db();
  return requestValue(connection.transaction('takeIndex').objectStore('takeIndex').index('scope').getAll(scope));
}
export async function acknowledgeTake(scope: string, id: string, change: number) {
  const connection = await db();
  await transaction(connection, ['takeIndex'], 'readwrite', async tx => {
    const store = tx.objectStore('takeIndex');
    const record = await requestValue<TakeIndex | undefined>(store.get([scope, id]));
    if (!record || record.change !== change) return;
    record.pending = false; record.synced = true; store.put(record);
  });
  changed(scope, 'remote');
}
export async function applyRemoteTake(scope: string, id: string, take: RecordedTake | null) {
  const connection = await db();
  let didChange = false;
  await transaction(connection, ['takeData', 'takeIndex'], 'readwrite', async tx => {
    const index = tx.objectStore('takeIndex'), data = tx.objectStore('takeData');
    const current = await requestValue<TakeIndex | undefined>(index.get([scope, id]));
    // A local deletion wins over an in-flight download. A server tombstone
    // wins over a local upload, so deleted takes never reappear.
    if (take && current) return;
    if (!take) {
      if (current?.deleted && !current.pending) return;
      const tombstone: TakeIndex = current || { scope, id, createdAt: 0, title: '', duration: 0, scoreId: '', synced: true, pending: false, deleted: true, change: 0 };
      tombstone.deleted = true; tombstone.pending = false; tombstone.synced = true; tombstone.change++;
      index.put(tombstone); data.delete([scope, id]); didChange = true;
    } else {
      data.put({ scope, id, take } satisfies TakeData); index.put(takeSummary(take, scope, false)); didChange = true;
    }
  });
  if (didChange) changed(scope, 'remote');
}

export type LibraryFolder = { id: string; name: string; added: number };
export type OrganizationSnapshot = { folders: LibraryFolder[]; placements: Record<string, string | null> };
export type FolderData = { type: 'folder'; name: string; added: number };
export type PlacementData = { type: 'placement'; itemKind: 'score' | 'take'; itemId: string; folderId: string | null };
export type ResourceKind = 'score' | 'settings' | 'organization';
export type ResourceData = SavedScore | PracticeSettings | FolderData | PlacementData;
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
async function writeResourceInTransaction(tx: IDBTransaction, kind: ResourceKind, id: string, data: ResourceData | null, scope: string) {
  const resources = tx.objectStore('resources'), outbox = tx.objectStore('outbox');
  const existing = await requestValue<LocalResource | undefined>(resources.get(key(scope, kind, id)));
  if (existing && JSON.stringify(existing.data) === JSON.stringify(data) && existing.deleted === (data === null)) return;
  const record = existing || localRecord(scope, kind, id, data);
  record.data = data; record.deleted = data === null; record.change++; record.dirty = scope !== ANONYMOUS_SCOPE;
  resources.put(record);
  if (record.dirty && !record.conflict) {
    const queued = await requestValue<PendingMutation | undefined>(outbox.get(key(scope, kind, id)));
    if (!queued?.sent) outbox.put(queueFor(record));
  }
}
async function writeResource(kind: ResourceKind, id: string, data: ResourceData | null, scope: string) {
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', tx => writeResourceInTransaction(tx, kind, id, data, scope));
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
export async function readOrganization(scope = activeScope): Promise<OrganizationSnapshot> {
  const connection = await db();
  const records = await requestValue<LocalResource[]>(connection.transaction('resources').objectStore('resources').index('scopeKind').getAll([scope, 'organization']));
  const folders: LibraryFolder[] = [], placements: Record<string, string | null> = {};
  for (const record of records) {
    if (record.deleted || !record.data || !('type' in record.data)) continue;
    const data = record.data;
    if (data.type === 'folder' && record.id.startsWith('folder.')) folders.push({ id: record.id.slice(7), name: data.name, added: data.added });
    else if (data.type === 'placement') placements[`${data.itemKind}:${data.itemId}`] = data.folderId;
  }
  folders.sort((a, b) => a.added - b.added || a.name.localeCompare(b.name));
  return { folders, placements };
}
export function folderFor(snapshot: OrganizationSnapshot, kind: 'score' | 'take', id: string): string | null {
  const folder = snapshot.placements[`${kind}:${id}`];
  return folder && snapshot.folders.some(item => item.id === folder) ? folder : null;
}
export async function createFolder(name: string, scope = activeScope): Promise<string> {
  const id = crypto.randomUUID();
  await writeResource('organization', `folder.${id}`, { type: 'folder', name: checkedFolderName(name), added: Date.now() }, scope);
  return id;
}
export async function renameFolder(id: string, name: string, scope = activeScope): Promise<void> {
  checkFolderId(id); const value = checkedFolderName(name), connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async tx => {
    const record = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'organization', `folder.${id}`)));
    if (!record || record.deleted || !record.data || !('type' in record.data) || record.data.type !== 'folder') throw new Error('Dossier introuvable.');
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, { ...record.data, name: value }, scope);
  });
  changed(scope, 'write');
}
export async function deleteFolder(id: string, scope = activeScope): Promise<void> {
  checkFolderId(id); const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async tx => {
    const records = await requestValue<LocalResource[]>(tx.objectStore('resources').index('scopeKind').getAll([scope, 'organization']));
    await writeResourceInTransaction(tx, 'organization', `folder.${id}`, null, scope);
    for (const record of records) if (!record.deleted && record.data && 'type' in record.data && record.data.type === 'placement' && record.data.folderId === id)
      await writeResourceInTransaction(tx, 'organization', record.id, { ...record.data, folderId: null }, scope);
  });
  changed(scope, 'write');
}
export async function moveItem(kind: 'score' | 'take', id: string, folderId: string | null, scope = activeScope): Promise<void> {
  checkedItem(kind, id); if (folderId !== null) checkFolderId(folderId);
  const connection = await db();
  await transaction(connection, ['resources', 'outbox'], 'readwrite', async tx => {
    if (folderId !== null) {
      const folder = await requestValue<LocalResource | undefined>(tx.objectStore('resources').get(key(scope, 'organization', `folder.${folderId}`)));
      if (!folder || folder.deleted || !folder.data || !('type' in folder.data) || folder.data.type !== 'folder') throw new Error('Dossier introuvable.');
    }
    await writeResourceInTransaction(tx, 'organization', `${kind}.${id}`, { type: 'placement', itemKind: kind, itemId: id, folderId }, scope);
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
  await transaction(connection, ['resources', 'outbox', 'meta'], 'readwrite', async (tx) => {
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
