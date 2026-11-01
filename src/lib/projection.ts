import type { ScoreGeometry, StaffProjection } from './score';

/** Measurements, not screen coordinates: resizing a score never alters them. */
export type PitchSample = { captureTime: number; scoreTime: number; frequency: number; targetChannel: number; staff: number; transpose: number; playing: boolean; epoch: number };

// Natural staff positions (C..B), shifted by the current key signature. The
// continuous interpolation keeps a measured detuning visible; it never snaps
// the singer to an expected note or borrows that note as a vertical origin.
const keyScales = new Map<number, { midi: number; step: number }[]>();
function keyScale(fifths: number) {
  const cached = keyScales.get(fifths);
  if (cached) return cached;
  const natural = [0, 2, 4, 5, 7, 9, 11];
  const alterations = [0, 0, 0, 0, 0, 0, 0];
  const order = fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
  for (let index = 0; index < Math.min(7, Math.abs(fifths)); index++) alterations[order[index]] = fifths >= 0 ? 1 : -1;
  const pitches: { midi: number; step: number }[] = [];
  for (let oct = -1; oct <= 1; oct++) {
    for (let letter = 0; letter < 7; letter++) pitches.push({ midi: oct * 12 + natural[letter] + alterations[letter], step: oct * 7 + letter });
  }
  keyScales.set(fifths, pitches);
  return pitches;
}
function diatonicPosition(midi: number, fifths: number) {
  const octave = Math.floor(midi / 12) - 1;
  const pitches = keyScale(fifths);
  const relative = midi - (octave + 1) * 12;
  let index = 0;
  while (index + 1 < pitches.length && pitches[index + 1].midi <= relative) index++;
  const left = pitches[index], right = pitches[Math.min(index + 1, pitches.length - 1)];
  return octave * 7 + left.step + (right.step - left.step) * (relative - left.midi) / Math.max(1, right.midi - left.midi);
}

function positionInStaff(staff: StaffProjection, time: number, frequency: number, transpose: number) {
  let index = 0;
  while (index + 1 < staff.anchors.length && staff.anchors[index + 1].time <= time) index++;
  const left = staff.anchors[index], right = staff.anchors[Math.min(index + 1, staff.anchors.length - 1)];
  const fraction = Math.max(0, Math.min(1, (time - left.time) / Math.max(0.001, right.time - left.time)));
  const x = left.x + (right.x - left.x) * fraction;
  let notation = staff.notation[0]?.value;
  for (const change of staff.notation) if (change.fromX <= x) notation = change.value;
  if (!notation || notation.bottomStep === null) return null;
  const midi = 69 + 12 * Math.log2(frequency / 440) - transpose - notation.soundingOffset;
  const y = staff.bottomY - (diatonicPosition(midi, notation.keyFifths) - notation.bottomStep) * staff.stepPx;
  return { x, y, systemId: staff.systemId };
}

/** Each accepted sample is projected once; unvoiced samples break the path. */
export function projectPitchTrace(samples: PitchSample[], geometry: ScoreGeometry | null, markEnd = false): string {
  if (!geometry) return '';
  const byStaff = new Map<number, StaffProjection[]>();
  for (const staff of geometry.staffs) {
    const intervals = byStaff.get(staff.staff) || [];
    intervals.push(staff);
    byStaff.set(staff.staff, intervals);
  }
  const path: string[] = [];
  let previous: { sample: PitchSample; systemId: string; x: number } | null = null;
  for (const sample of samples) {
    if (!sample.playing || sample.frequency <= 0) { previous = null; continue; }
    const intervals = byStaff.get(sample.staff);
    if (!intervals?.length) { previous = null; continue; }
    let lo = 0, hi = intervals.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (intervals[mid].startTime <= sample.scoreTime) lo = mid;
      else hi = mid - 1;
    }
    const staff = intervals[lo];
    if (staff.channel !== sample.targetChannel || sample.scoreTime < staff.startTime || sample.scoreTime > staff.endTime) { previous = null; continue; }
    const point = positionInStaff(staff, sample.scoreTime, sample.frequency, sample.transpose);
    if (!point) { previous = null; continue; }
    const connected = previous && previous.sample.epoch === sample.epoch && previous.systemId === point.systemId && previous.sample.targetChannel === sample.targetChannel && previous.sample.staff === sample.staff && previous.sample.transpose === sample.transpose && sample.captureTime - previous.sample.captureTime <= 0.12 && sample.scoreTime >= previous.sample.scoreTime && point.x >= previous.x;
    path.push(`${connected ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    previous = { sample, systemId: point.systemId, x: point.x };
  }
  // A frontier can consist of a single point. A tiny round-ended segment makes
  // it visible, including at a fresh onset, without extending its time axis.
  if (markEnd && previous) path.push('l0,0.1');
  return path.join(' ');
}
