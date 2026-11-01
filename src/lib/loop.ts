import type { MeasurePosition } from './score';

type TimedNote = { time: number; duration: number };
type NoteEvent = { tstamp: number; on?: string[]; off?: string[] };
type LoopTimeCorrection = { from: number; to: number };

// Verovio's MIDI lookup truncates note times independently of its timemap.
// Keep note selection on the same millisecond boundaries as playback frames,
// measures and pitch anchors. Both inputs and the stored note values use ms.
export function alignNoteTimings(notes: Record<string, TimedNote>, events: readonly NoteEvent[]): LoopTimeCorrection[] {
  const legacy = new Map(Object.entries(notes).map(([id, note]) => [id, { ...note }]));
  const starts = new Map<string, number>();
  for (const event of events) {
    for (const id of event.on || []) {
      if (!notes[id] || starts.has(id)) continue;
      starts.set(id, event.tstamp);
      notes[id].time = event.tstamp;
    }
    for (const id of event.off || []) {
      const start = starts.get(id);
      if (start !== undefined && notes[id]) notes[id].duration = Math.max(0, event.tstamp - start);
    }
  }
  const canonical = new Set<number>();
  const candidates = new Map<number, Set<number>>();
  const remember = (from: number, to: number) => {
    canonical.add(to);
    const targets = candidates.get(from) || new Set<number>();
    targets.add(to);
    candidates.set(from, targets);
  };
  for (const [id, note] of Object.entries(notes)) {
    const old = legacy.get(id)!;
    remember(old.time, note.time);
    remember(old.time + old.duration, note.time + note.duration);
  }
  // Saved loops use seconds. A canonical boundary always wins over a legacy
  // coincidence; an old value with several possible replacements stays intact.
  return [...candidates].flatMap(([from, targets]) => {
    if (canonical.has(from) || targets.size !== 1) return [];
    return [{ from: from / 1000, to: targets.values().next().value! / 1000 }];
  });
}

// Only absorb floating point arithmetic noise, never a musically meaningful
// interval or Verovio's millisecond rounding difference.
const TIME_EPSILON = 1e-7;

export function measuresInLoop<T extends Pick<MeasurePosition, 'time'>>(
  measures: readonly T[], start: number | null, end: number | null, duration: number,
): T[] {
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || end - start <= TIME_EPSILON) return [];
  return measures.filter((measure, index) => {
    const measureEnd = measures[index + 1]?.time ?? duration;
    // A loop is [start, end): touching either boundary is not an overlap.
    return measure.time < end - TIME_EPSILON && measureEnd > start + TIME_EPSILON;
  });
}

/** Restore only known old note boundaries; never snap arbitrary user times. */
export function canonicalLoopBounds(
  start: number | null, end: number | null, corrections: readonly LoopTimeCorrection[] = [],
): { start: number | null; end: number | null } {
  const convert = (time: number | null) => {
    if (time === null || !Number.isFinite(time)) return time;
    const matches = corrections.filter((correction) => Math.abs(correction.from - time) <= TIME_EPSILON);
    if (!matches.length || matches.some((correction) => Math.abs(correction.to - matches[0].to) > TIME_EPSILON)) return time;
    return matches[0].to;
  };
  return { start: convert(start), end: convert(end) };
}
