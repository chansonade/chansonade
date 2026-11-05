import { claimAnonymousTakes, queueRemoteTakes, failTakeTransfer, cacheTakeDigest, getTake, acknowledgeTake, applyRemoteTake, type RecordedTake } from './storage';

type RemoteTake = {
  id: string; deleted: boolean; ready: boolean;
  createdAt?: number; title?: string; scoreId?: string; duration?: number;
  sampleRate?: number; samples?: number; audioBytes?: number; audioSha256?: string;
};
class TakeAPIError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const base = `${import.meta.env.BASE_URL}api/v1/`;
type TakeRequestOptions = RequestInit & { response: 'json' | 'wav'; timeoutMs?: number };
async function takeRequest<T>(route: string, accountId: string, signal: AbortSignal, { response: format, timeoutMs = 8_000, ...options }: TakeRequestOptions): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${base}${route}`, {
      ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Chansonade-User': accountId, ...options.headers },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new TakeAPIError(error?.message || `Le serveur a répondu ${response.status}.`, response.status);
    }
    if (format === 'wav') return await response.blob() as T;
    try { return await response.json() as T; }
    catch (cause) {
      if (cause instanceof SyntaxError) throw new TakeAPIError('Les métadonnées de l’essai sont invalides.', 422);
      throw cause;
    }
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

/** All transfers, including absent local takes, live in the scoped outbox. */
export async function synchronizeTakes(scope: string, accountId: string, signal: AbortSignal, current: () => boolean): Promise<void> {
  await claimAnonymousTakes(scope);
  if (!current()) return;
  const collection = await takeRequest<{ takes: RemoteTake[] }>('takes', accountId, signal, { response: 'json' });
  if (!Array.isArray(collection?.takes)) throw new TakeAPIError('Les métadonnées de l’essai sont invalides.', 422);
  if (!current()) return;
  const remote = new Map(collection.takes.map(take => [take.id, take]));
  const jobs = await queueRemoteTakes(scope, collection.takes);
  if (!current()) return;
  // Complete local writes first, then downloads; retain the outbox key order.
  jobs.sort((a, b) => Number(a.operation === 'download') - Number(b.operation === 'download'));
  for (const job of jobs) {
    if (!current()) return;
    const path = `takes/${encodeURIComponent(job.id)}`;
    try {
      if (job.operation === 'delete') {
        await takeRequest(path, accountId, signal, { response: 'json', method: 'DELETE' });
        if (current()) await acknowledgeTake(scope, job.id, job.change);
      } else if (job.operation === 'upload') {
        const take = await getTake(job.id, scope);
        if (!current()) return;
        if (!take) throw new TakeAPIError('Cet essai n’est plus disponible.', 422);
        if (take.audio.size > 64 * 1024 * 1024) throw new TakeAPIError('Le WAV dépasse la limite de 64 Mio.', 413);
        const audioSha256 = job.audioSha256 || [...new Uint8Array(await crypto.subtle.digest('SHA-256', await take.audio.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (!current()) return;
        if (!job.audioSha256) await cacheTakeDigest(job, audioSha256);
        const declaration = await takeRequest<{ take: RemoteTake }>(path, accountId, signal, {
          response: 'json', method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: metadataForUpload(take), audioBytes: take.audio.size, audioSha256 }),
        });
        if (!current()) return;
        if (typeof declaration?.take?.ready !== 'boolean') throw new TakeAPIError('Les métadonnées de l’essai sont invalides.', 422);
        if (!declaration.take.ready) await takeRequest(`${path}/audio`, accountId, signal, {
          response: 'json', timeoutMs: 300_000, method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: take.audio,
        });
        if (current()) await acknowledgeTake(scope, job.id, job.change);
      } else {
        const item = remote.get(job.id)!;
        const response = await takeRequest<{ metadata: Omit<RecordedTake, 'audio'> }>(path, accountId, signal, { response: 'json' });
        if (response?.metadata?.id !== job.id) throw new TakeAPIError('Essai téléchargé incomplet.', 422);
        const audio = await takeRequest<Blob>(`${path}/audio`, accountId, signal, { response: 'wav', timeoutMs: 300_000 });
        if (!current()) return;
        if (audio.size !== item.audioBytes) throw new TakeAPIError('Essai téléchargé incomplet.', 422);
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await audio.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== item.audioSha256) throw new TakeAPIError('Le son téléchargé ne correspond pas à l’essai.', 422);
        if (!current()) return;
        await applyRemoteTake(scope, job.id, { ...response.metadata, audio });
      }
    } catch (cause) {
      if (!current() || signal.aborted) throw cause;
      if (cause instanceof TakeAPIError && cause.status === 410) { await applyRemoteTake(scope, job.id, null); continue; }
      if (cause instanceof TakeAPIError && [400, 404, 409, 413, 415, 422].includes(cause.status)) {
        await failTakeTransfer(job, cause.message);
        continue;
      }
      throw cause;
    }
  }
}
export { TakeAPIError };
