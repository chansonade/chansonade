import { writable } from 'svelte/store';
import { ANONYMOUS_SCOPE, storageScope, setStorageScope, subscribeStorage, pendingMutations, markMutationSent, releaseRejectedMutation, acceptMutation, applyRemoteChanges, syncCursor, syncConflicts, resolveSyncConflict, importAnonymousLibrary, type LocalResource, type RemoteResource, type ResourceKind } from './storage';

type User = { id: string; email: string };
type Session = { user: User | null; registration: 'invite' | 'open' };
export type SyncState = {
  user: User | null; registration: 'invite' | 'open'; available: boolean;
  status: 'Local' | 'Synchronisé' | 'En attente' | 'Hors ligne' | 'Conflit' | 'Connexion requise';
  busy: boolean; pending: number; conflicts: LocalResource[]; message: string;
};
function cachedUser(): User | null {
  try {
    const user = JSON.parse(localStorage.getItem('chansonade.account') || 'null');
    return user && typeof user.id === 'string' && typeof user.email === 'string' ? user : null;
  } catch { return null; }
}
let user = cachedUser();
setStorageScope(user ? `user:${user.id}` : ANONYMOUS_SCOPE);
let state: SyncState = { user, registration: 'invite', available: false, status: user ? 'Hors ligne' : 'Local', busy: false, pending: 0, conflicts: [], message: '' };
export const syncState = writable<SyncState>(state);
function update(change: Partial<SyncState>) { state = { ...state, ...change }; syncState.set(state); }
class APIError extends Error { constructor(message: string, public status: number) { super(message); } }
const apiBase = `${import.meta.env.BASE_URL}api/v1/`;
let epoch = 0;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;
let stopListening: (() => void) | null = null;
let stopped = false;
let authChanging = false;

async function request<T>(route: string, options: RequestInit = {}, account?: User, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) timeout.abort();
  const timeoutId = setTimeout(abort, 8000);
  try {
    const response = await fetch(`${apiBase}${route}`, {
      ...options, signal: timeout.signal, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(account ? { 'X-Chansonade-User': account.id } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new APIError(body?.message || `Le serveur a répondu ${response.status}.`, response.status);
    if (!body) throw new APIError('Réponse du serveur non reconnue.', 502);
    return body;
  } finally { clearTimeout(timeoutId); signal?.removeEventListener('abort', abort); }
}
function adoptSession(session: Session) {
  const changed = user?.id !== session.user?.id;
  user = session.user;
  if (changed) {
    epoch++;
    controller?.abort();
    setStorageScope(user ? `user:${user.id}` : ANONYMOUS_SCOPE);
  }
  try {
    if (user) localStorage.setItem('chansonade.account', JSON.stringify(user));
    else localStorage.removeItem('chansonade.account');
  } catch { /* Account isolation is also enforced in memory and by the API. */ }
  update({ user, registration: session.registration, available: true, message: '', ...(changed ? { conflicts: [], pending: 0 } : {}), status: user ? 'En attente' : 'Local' });
}
async function refreshCounts(scope: string, currentEpoch = epoch) {
  const [pending, conflicts] = await Promise.all([pendingMutations(scope), syncConflicts(scope)]);
  if (currentEpoch !== epoch || scope !== storageScope()) return;
  update({ pending: pending.length, conflicts, status: conflicts.length ? 'Conflit' : pending.length ? 'En attente' : state.available ? 'Synchronisé' : 'Hors ligne' });
}
function schedule(delay = 500) {
  if (stopped || authChanging) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void synchronize(); }, delay);
}
async function cycle() {
  update({ busy: true, message: '' });
  try {
    // Recheck the cookie identity before processing a persisted outbox. Each
    // data request also binds this account explicitly, including across tabs.
    const sessionEpoch = epoch;
    const session = await request<Session>('session');
    if (stopped || authChanging || sessionEpoch !== epoch) return;
    adoptSession(session);
    if (!user) return;
    const account = user, scope = storageScope(), currentEpoch = epoch;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => !stopped && currentEpoch === epoch && !authChanging;
    // One score at a time keeps large MusicXML uploads within the API limit.
    // Settings are small too; a serial queue is enough for this POC.
    for (const mutation of await pendingMutations(scope)) {
      if (!current()) return;
      if (!await markMutationSent(mutation)) continue;
      const { mutationId, kind, id, baseRevision, data, deleted } = mutation;
      let response: { results: { mutationId: string; status: 'applied' | 'conflict'; resource: RemoteResource }[] };
      try {
        response = await request('mutations', {
          method: 'POST', body: JSON.stringify({ mutations: [{ mutationId, kind, id, baseRevision, data, deleted }] }),
        }, account, signal);
      } catch (cause) {
        if (cause instanceof APIError && [400, 413, 422].includes(cause.status)) await releaseRejectedMutation(mutation);
        throw cause;
      }
      if (!current()) return;
      for (const result of response.results) await acceptMutation(scope, result.mutationId, result.status, result.resource);
    }
    if (!current()) return;
    const cursor = await syncCursor(scope);
    const response = await request<{ cursor: number; changes: RemoteResource[] }>(`changes?cursor=${cursor}`, {}, account, signal);
    if (!current()) return;
    await applyRemoteChanges(scope, response.changes, response.cursor);
    await refreshCounts(scope, currentEpoch);
    if (state.pending) again = true;
  } catch (cause) {
    if (stopped || authChanging) return;
    if (cause instanceof APIError && (cause.status === 401 || cause.status === 403)) {
      update({ status: 'Connexion requise', message: 'La session a changé. Reconnectez le compte pour synchroniser.' });
    } else if (cause instanceof APIError && cause.status !== 404 && cause.status !== 502) {
      update({ available: true, status: user ? 'En attente' : 'Local', message: cause.message });
    } else {
      // A static self-hosted client without this API remains fully usable.
      update({ available: false, status: user ? 'Hors ligne' : 'Local', message: user ? 'Les modifications sont conservées sur cet appareil.' : '' });
    }
  } finally { controller = null; update({ busy: false }); }
}
export function synchronize(): Promise<void> {
  if (stopped || authChanging) return Promise.resolve();
  if (running) { again = true; return running; }
  running = cycle().finally(() => {
    running = null;
    if (again && !stopped && !authChanging) { again = false; schedule(300); }
  });
  return running;
}
export function startSync() {
  stopped = false;
  const online = () => schedule(0);
  const visible = () => { if (document.visibilityState === 'visible') schedule(0); };
  const storage = (event: StorageEvent) => { if (event.key === 'chansonade.account') schedule(0); };
  stopListening?.();
  stopListening = subscribeStorage((event) => {
    if (event.scope !== storageScope() || event.scope === ANONYMOUS_SCOPE) return;
    if (event.reason === 'write') {
      void refreshCounts(event.scope).catch(() => update({ message: 'Impossible de lire la file de synchronisation.' }));
      schedule();
    }
  });
  window.addEventListener('online', online);
  window.addEventListener('storage', storage);
  document.addEventListener('visibilitychange', visible);
  if (user) void refreshCounts(storageScope()).catch(() => {});
  void synchronize();
  return () => {
    stopped = true; epoch++; controller?.abort(); clearTimeout(timer); stopListening?.(); stopListening = null;
    window.removeEventListener('online', online); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible);
  };
}
async function changeAuthentication(route: string, method: string, data?: unknown) {
  authChanging = true; epoch++; controller?.abort(); clearTimeout(timer);
  try {
    const result = await request<{ user?: User }>(route, { method, ...(data ? { body: JSON.stringify(data) } : {}) });
    adoptSession({ user: result.user || null, registration: state.registration });
  } finally { authChanging = false; }
  await synchronize();
}
export function login(email: string, password: string) { return changeAuthentication('session', 'POST', { email, password }); }
export function createAccount(email: string, password: string, invitation?: string) { return changeAuthentication('accounts', 'POST', { email, password, ...(invitation ? { invitation } : {}) }); }
export function logout() { return changeAuthentication('session', 'DELETE'); }
export async function addLocalLibrary() {
  const account = user, scope = storageScope();
  if (!account) throw new Error('Connectez-vous pour ajouter la bibliothèque locale.');
  await synchronize();
  if (user?.id !== account.id || storageScope() !== scope) throw new Error('Le compte a changé. Relancez l’import dans la bibliothèque souhaitée.');
  const count = await importAnonymousLibrary(scope);
  await synchronize();
  return count;
}
export async function chooseConflict(kind: ResourceKind, id: string, keepLocal: boolean) {
  if (!user) return;
  const scope = storageScope();
  await resolveSyncConflict(scope, kind, id, keepLocal);
  await refreshCounts(scope);
  await synchronize();
}
