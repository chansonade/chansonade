import type { MusicalData } from './score';
import type { PitchSample } from './projection';
import type { RecordedTake, TakeTransport } from './storage';

/** Recorded audio time is the master clock, including pauses and loop jumps. */
export function takeMoment(take: RecordedTake, time: number): TakeTransport {
  const timeline = take.transport;
  let lo = 0, hi = timeline.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (timeline[mid].time <= time) lo = mid; else hi = mid - 1;
  }
  const point = timeline[lo];
  if (!point || time < point.time) return { time, scoreTime: point?.scoreTime ?? 0, playing: false, rate: take.settings.rate, targetChannel: take.settings.target, transpose: take.settings.parts.find(p => p.channel === take.settings.target)?.transpose || 0 };
  return { ...point, time, scoreTime: Math.max(0, point.scoreTime + (point.playing ? (time - point.time) * point.rate : 0)) };
}

/** Keep measured frequencies and their original score times; never re-detect WAV. */
export function takePitchSamples(take: RecordedTake, music: MusicalData): PitchSample[] {
  let epoch = 0;
  let previous: PitchSample | null = null;
  return take.pitches.map(p => {
    const moment = takeMoment(take, p.time);
    const sample: PitchSample = {
      captureTime: p.time, scoreTime: p.scoreTime, frequency: p.frequency,
      targetChannel: p.targetChannel, staff: p.staff ?? music.parts.find(part => part.channel === p.targetChannel)?.staves[0] ?? 0,
      transpose: p.transpose ?? moment.transpose, playing: p.playing, epoch: p.epoch ?? epoch,
    };
    if (p.epoch === undefined && previous && (sample.scoreTime < previous.scoreTime || sample.playing !== previous.playing || sample.targetChannel !== previous.targetChannel || sample.transpose !== previous.transpose)) sample.epoch = ++epoch;
    previous = sample;
    return sample;
  });
}

/** Binary search avoids scanning a long recording on each animation frame. */
export function takePitchCount(samples: PitchSample[], time: number) {
  let lo = 0, hi = samples.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].captureTime <= time) lo = mid + 1; else hi = mid; }
  return lo;
}
