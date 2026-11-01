import { VoicePitchDetector } from './pitch-detector';
import { PitchTracker, type TrackedPitch } from './pitch-tracker';
import type { PitchFrame, PitchResult } from './pitch';

type Input = { type?: 'pitch'; samples: Float32Array; sampleRate: number; time: number } | { type: 'flush'; id: number };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Input>) => void) | null;
  postMessage: (result: PitchFrame | { type: 'flushed'; id: number }) => void;
};
let detector: VoicePitchDetector | null = null;
let sampleRate = 0;
const tracker = new PitchTracker();

function pitchResult(result: TrackedPitch): PitchResult {
  const pitch = result.frequency > 0 ? 69 + 12 * Math.log2(result.frequency / 440) : -1;
  const midi = pitch >= 0 ? Math.round(pitch) : -1;
  return { time: result.time, frequency: result.frequency, rawFrequency: result.rawFrequency, clarity: result.voicedProbability, rms: result.rms, midi, cents: midi >= 0 ? (pitch - midi) * 100 : 0 };
}

scope.onmessage = ({ data }) => {
  if (data.type === 'flush') {
    scope.postMessage({ type: 'pitch', confirmed: tracker.flush().map(pitchResult), pending: [] });
    scope.postMessage({ type: 'flushed', id: data.id });
    return;
  }
  if (!detector || detector.inputLength !== data.samples.length || sampleRate !== data.sampleRate) {
    detector = new VoicePitchDetector(data.samples.length);
    sampleRate = data.sampleRate;
    tracker.reset();
  }
  const result = tracker.push(detector.observe(data.samples, data.sampleRate, data.time));
  scope.postMessage({ type: 'pitch', confirmed: result ? [pitchResult(result)] : [], pending: tracker.pending().map(pitchResult) });
};
