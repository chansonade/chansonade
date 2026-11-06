/** Keep PCM16 WAV strictly below the server's 64 MiB per-take limit. */
export const RECORDING_MAX_SECONDS = 10 * 60;
export const RECORDING_MAX_WAV_BYTES = 64 * 1024 * 1024;
export function recordingMaxSamples(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Fréquence d’échantillonnage invalide.');
  return Math.min(Math.floor(sampleRate * RECORDING_MAX_SECONDS), Math.floor((RECORDING_MAX_WAV_BYTES - 45) / 2));
}
