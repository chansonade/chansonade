import { strToU8, zipSync } from 'fflate';
import { PITCH_CONFIG } from './pitch-config';
import type { PitchInput } from './pitch';
import { saveTake, type PracticeSettings, type RecordedTake, type TakePitch, type TakeTransport } from './storage';

/** Data captured at the start of a take, including its account. Folder inheritance is resolved atomically when saving. */
export type TakeCapture = {
  scope: string; startedAt: number; createdAt: number;
  scoreId: string; title: string; scoreXML: string; settings: PracticeSettings;
  latencyMs: number; pitches: TakePitch[]; transport: TakeTransport[]; metadataLimitReached?: boolean;
};

/** Leave 1 MiB for the API wrapper and any numeric/device metadata. */
export const TAKE_METADATA_BUDGET = 11 * 1024 * 1024;
const utf8 = new TextEncoder();
export class TakeMetadataBudget {
  private used: number;
  constructor(captured: TakeCapture, private readonly maximum = TAKE_METADATA_BUDGET) {
    // Include the exact escaped UTF-8 score, title, settings and fixed fields.
    // The reserve covers changing numeric fields, the sanitized device settings,
    // commas, the declaration wrapper and its SHA-256 digest.
    const fixed = {
      id: '00000000-0000-4000-8000-000000000000', createdAt: captured.createdAt,
      title: captured.title, scoreId: captured.scoreId, scoreXML: captured.scoreXML,
      duration: 600, sampleRate: 384000, samples: 33554409, input: null,
      captureStartedAt: captured.startedAt, settings: captured.settings, latencyMs: captured.latencyMs,
      detector: PITCH_CONFIG, analysisComplete: false, pitches: [], transport: [],
    };
    this.used = utf8.encode(JSON.stringify(fixed)).length + 4096;
  }
  get fits(): boolean { return this.used <= this.maximum; }
  append(point: TakePitch | TakeTransport): boolean {
    const bytes = utf8.encode(JSON.stringify(point)).length + 1;
    if (this.used + bytes > this.maximum) return false;
    this.used += bytes;
    return true;
  }
}

/** Keep a failed IndexedDB write recoverable in memory for export. */
export async function finishCapturedTake(pitch: PitchInput, captured: TakeCapture): Promise<{ take: RecordedTake; persisted: boolean }> {
  const recording = await pitch.stopRecording();
  if (!recording.samples) throw new Error('Aucun son n’a été capturé.');
  const take: RecordedTake = {
    id: crypto.randomUUID(), createdAt: captured.createdAt, title: captured.title,
    scoreId: captured.scoreId, scoreXML: captured.scoreXML, audio: recording.audio,
    duration: recording.duration, sampleRate: recording.sampleRate, samples: recording.samples,
    input: pitch.inputInfo, captureStartedAt: captured.startedAt, settings: captured.settings,
    latencyMs: captured.latencyMs, detector: { ...PITCH_CONFIG }, analysisComplete: recording.analysisComplete && !captured.metadataLimitReached,
    pitches: captured.pitches.filter(point => point.time <= recording.duration),
    transport: captured.transport.filter(point => point.time <= recording.duration),
  };
  try { await saveTake(take, captured.scope); return { take, persisted: true }; }
  catch { return { take, persisted: false }; }
}

export async function takeArchive(take: RecordedTake): Promise<Blob> {
  const { audio, scoreXML, ...analysis } = take;
  const bytes = zipSync({ 'voice.wav': new Uint8Array(await audio.arrayBuffer()), 'analysis.json': strToU8(JSON.stringify(analysis, null, 2)), 'score.musicxml': strToU8(scoreXML) });
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}
