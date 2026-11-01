import { claimAnonymousTakes, takeSyncEntries, getTake, acknowledgeTake, applyRemoteTake, type RecordedTake } from './storage';

type RemoteTake = {
  id: string; deleted: boolean; ready: boolean;
  createdAt?: number; title?: string; scoreId?: string; duration?: number;
  sampleRate?: number; samples?: number; audioBytes?: number; audioSha256?: string;
};
class TakeAPIError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const base = `${import.meta.env.BASE_URL}api/v1/`;

async function takeRequest<T>(route: string, accountId: string, signal: AbortSignal, options: RequestInit = {}, audio = false): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, audio ? 300_000 : 8_000);
  try {
    const response = await fetch(`${base}${route}`, {
      ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Chansonade-User': accountId, ...options.headers },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new TakeAPIError(error?.message || `Le serveur a répondu ${response.status}.`, response.status);
    }
    return (audio && options.method !== 'PUT' ? await response.blob() : await response.json()) as T;
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort);
  }
}

function metadataForUpload(take: RecordedTake): Omit<RecordedTake, 'audio'> {
  const { audio: _audio, input, ...metadata } = take;
  if (!input) return { ...metadata, input };
  const { sampleRate, channelCount, sampleSize, echoCancellation, noiseSuppression, autoGainControl } = input.settings;
  return { ...metadata, input: { label: '', settings: { sampleRate, channelCount, sampleSize, echoCancellation, noiseSuppression, autoGainControl } } };
}

/** Synchronize immutable takes and tombstones independently of the score outbox. */
export async function synchronizeTakes(scope: string, accountId: string, signal: AbortSignal, current: () => boolean) {
  await claimAnonymousTakes(scope);
  if (!current()) return;
  const collection = await takeRequest<{ takes: RemoteTake[] }>('takes', accountId, signal);
  if (!current()) return;
  const remote = new Map(collection.takes.map(take => [take.id, take]));
  for (const item of collection.takes) {
    if (!current()) return;
    if (item.deleted) await applyRemoteTake(scope, item.id, null);
  }
  let firstFailure: TakeAPIError | undefined;
  let entries = await takeSyncEntries(scope);
  for (const entry of entries) {
    if (!current()) return;
    if (!entry.pending) continue;
    const path = `takes/${encodeURIComponent(entry.id)}`;
    try {
      if (entry.deleted) {
        await takeRequest(path, accountId, signal, { method: 'DELETE' });
        if (current()) await acknowledgeTake(scope, entry.id, entry.change);
        continue;
      }
      const take = await getTake(entry.id, scope);
      if (!take || !current()) continue;
      if (take.audio.size > 64 * 1024 * 1024) throw new TakeAPIError('Le WAV dépasse la limite de 64 Mio.', 413);
      const audioSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await take.audio.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!current()) return;
      const declaration = await takeRequest<{ take: RemoteTake }>(path, accountId, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: metadataForUpload(take), audioBytes: take.audio.size, audioSha256 }),
      });
      if (!current()) return;
      if (!declaration.take.ready) await takeRequest(`${path}/audio`, accountId, signal, {
        method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: take.audio,
      }, true);
      if (current()) await acknowledgeTake(scope, entry.id, entry.change);
    } catch (cause) {
      if (cause instanceof TakeAPIError && cause.status === 410) { await applyRemoteTake(scope, entry.id, null); continue; }
      if (cause instanceof TakeAPIError && [400, 409, 413, 415, 422].includes(cause.status)) {
        firstFailure ||= new TakeAPIError(`Essai « ${entry.title || entry.id} » : ${cause.message}`, cause.status);
        continue;
      }
      throw cause;
    }
  }
  if (!current()) return;
  entries = await takeSyncEntries(scope);
  const local = new Set(entries.map(entry => entry.id));
  for (const item of remote.values()) {
    if (!current()) return;
    if (item.deleted || !item.ready || local.has(item.id)) continue;
    const path = `takes/${encodeURIComponent(item.id)}`;
    try {
      const response = await takeRequest<{ metadata: Omit<RecordedTake, 'audio'> }>(path, accountId, signal);
      const audio = await takeRequest<Blob>(`${path}/audio`, accountId, signal, {}, true);
      if (!current()) return;
      if (response.metadata.id !== item.id || audio.size !== item.audioBytes) throw new Error('Essai téléchargé incomplet.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await audio.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== item.audioSha256) throw new Error('Le son téléchargé ne correspond pas à l’essai.');
      if (!current()) return;
      await applyRemoteTake(scope, item.id, { ...response.metadata, audio });
    } catch (cause) {
      if (cause instanceof TakeAPIError && cause.status === 410) { await applyRemoteTake(scope, item.id, null); continue; }
      throw cause;
    }
  }
  if (firstFailure) throw firstFailure;
}
export { TakeAPIError };
