import { PITCH_CONFIG } from './pitch-config';
import { readPreference, writePreference, writePreferenceIfMissing } from './preferences';

type ExerciseStep = readonly [degree: number, beats: number, syllable: string];
type ExerciseDefinition = {
  id: string;
  nameKey: string;
  steps: readonly ExerciseStep[];
  gate: number;
};

const arpeggioSteps = [
  [1, 1, 'ma'], [3, 1, 'ma'], [5, 1, 'ma'], [8, 1, 'ma'],
  [5, 1, 'ma'], [3, 1, 'ma'], [1, 2, 'ma'],
] as const satisfies readonly ExerciseStep[];

export const EXERCISES = [
  { id: 'five-note', nameKey: 'Gamme de cinq notes', gate: 0.9, steps: [
    [1, 1, 'mi'], [2, 1, 'me'], [3, 1, 'ma'], [4, 1, 'mo'], [5, 1, 'mu'],
    [4, 1, 'mo'], [3, 1, 'ma'], [2, 1, 'me'], [1, 2, 'mi'],
  ] },
  { id: 'arpeggio', nameKey: 'Arpège majeur', gate: 0.9, steps: arpeggioSteps },
  { id: 'hum', nameKey: 'Tierce fredonnée', gate: 0.9, steps: [[1, 1, 'm'], [3, 1, 'm'], [1, 2, 'm']] },
  { id: 'fifth', nameKey: 'Aller-retour de quinte', gate: 0.9, steps: [[1, 1, 'mou'], [5, 1, 'mou'], [1, 2, 'mou']] },
  { id: 'octave', nameKey: 'Aller-retour d’octave', gate: 0.9, steps: [[1, 1, 'ma'], [8, 1, 'ma'], [1, 2, 'ma']] },
  { id: 'staccato', nameKey: 'Arpège staccato', gate: 0.35, steps: arpeggioSteps },
  { id: 'sustained', nameKey: 'Note tenue', gate: 1, steps: [[1, 8, 'ma']] },
] as const satisfies readonly ExerciseDefinition[];

export type ExerciseId = typeof EXERCISES[number]['id'];
export type ExerciseMode = 'listen' | 'guide' | 'solo';
export type VocalRange = { low: number; high: number };
export type ExercisePreferences = {
  exerciseId: ExerciseId;
  bpm: number;
  step: 1 | 2;
  /** Null until the singer chooses an extent; the preset label is derived from its bounds. */
  voice: (VocalRange & { tonic: number }) | null;
};
export const VOICE_RANGES = [
  { nameKey: 'Soprano', low: 60, high: 84 },
  { nameKey: 'Mezzo-soprano', low: 57, high: 81 },
  { nameKey: 'Alto', low: 53, high: 76 },
  { nameKey: 'Ténor', low: 48, high: 72 },
  { nameKey: 'Baryton', low: 43, high: 67 },
  { nameKey: 'Basse', low: 40, high: 64 },
] as const;

// Editable extents must remain observable by the existing detector; it is unchanged.
export const EXERCISE_PITCH_LIMITS = {
  low: Math.ceil(69 + 12 * Math.log2(PITCH_CONFIG.minHz / 440)),
  high: Math.floor(69 + 12 * Math.log2(PITCH_CONFIG.maxHz / 440)),
} as const;
export const EXERCISE_TICKS_PER_BEAT = 480;
const major = [0, 2, 4, 5, 7, 9, 11];
const cue = { degrees: [1, 3, 5], octave: -1, beats: 1, restBeats: 1 } as const;
const defaults: ExercisePreferences = { exerciseId: 'five-note', bpm: 80, step: 1, voice: null };
const offset = (degree: number) => major[(degree - 1) % 7] + 12 * Math.floor((degree - 1) / 7);
const definition = (id: unknown) => EXERCISES.find(exercise => exercise.id === id);
const validBpm = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 40 && Number(value) <= 160;
function validRange(value: VocalRange): boolean {
  return Number.isInteger(value.low) && Number.isInteger(value.high)
    && value.low >= EXERCISE_PITCH_LIMITS.low && value.high <= EXERCISE_PITCH_LIMITS.high && value.low <= value.high;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Tonics whose entire sung motif fits, not just its first note. Chord voicing is accompaniment. */
export function exerciseTonicBounds(id: ExerciseId, range: VocalRange): VocalRange | null {
  const exercise = definition(id);
  if (!exercise || !validRange(range)) return null;
  const offsets = exercise.steps.map(([degree]) => offset(degree));
  const low = range.low - Math.min(...offsets), high = range.high - Math.max(...offsets);
  return low <= high ? { low, high } : null;
}

/** Recover optional browser settings; preserve a valid narrow extent even if this motif cannot fit. */
export function normalizeExercisePreferences(value: unknown): ExercisePreferences {
  if (!object(value)) return { ...defaults };
  const exerciseId = definition(value.exerciseId)?.id ?? defaults.exerciseId;
  let voice: ExercisePreferences['voice'] = null;
  if (object(value.voice)) {
    const { low, high, tonic } = value.voice;
    const range = { low: low as number, high: high as number };
    if (validRange(range)) {
      const bounds = exerciseTonicBounds(exerciseId, range);
      const requested = Number.isInteger(tonic) ? tonic as number : range.low;
      voice = { ...range, tonic: bounds ? Math.max(bounds.low, Math.min(bounds.high, requested)) : range.low };
    }
  }
  return { exerciseId, voice, bpm: validBpm(value.bpm) ? value.bpm : defaults.bpm, step: value.step === 2 ? 2 : 1 };
}

/** A manual chromatic step never wraps or silently clamps at an extent boundary. */
export function stepExercise(preferences: ExercisePreferences, direction: -1 | 1): ExercisePreferences | null {
  if (!preferences.voice || ![-1, 1].includes(direction) || ![1, 2].includes(preferences.step)) return null;
  const bounds = exerciseTonicBounds(preferences.exerciseId, preferences.voice);
  const tonic = preferences.voice.tonic + direction * preferences.step;
  if (!bounds || tonic < bounds.low || tonic > bounds.high || !Number.isInteger(tonic)) return null;
  return { ...preferences, voice: { ...preferences.voice, tonic } };
}

export type ExerciseNote = {
  readonly role: 'cue' | 'voice';
  readonly midi: number;
  /** Offsets from passage start, in ticks; end is exclusive. */
  readonly startTick: number;
  readonly endTick: number;
  readonly syllable: string;
};
export type ExercisePassage = {
  readonly exerciseId: ExerciseId;
  readonly bpm: number;
  readonly tonic: number;
  readonly mode: ExerciseMode;
  readonly durationTicks: number;
  readonly notes: readonly ExerciseNote[];
};

/** A self-contained snapshot for both playback and drawing. No clock, microphone or score dependency. */
export function createExercisePassage(preferences: ExercisePreferences, mode: ExerciseMode): ExercisePassage {
  const exercise = definition(preferences.exerciseId);
  if (!exercise || !validBpm(preferences.bpm) || !['listen', 'guide', 'solo'].includes(mode)) throw new Error('Réglages d’exercice invalides.');
  if (!preferences.voice) throw new Error('Choisissez une étendue vocale pour commencer.');
  const bounds = exerciseTonicBounds(preferences.exerciseId, preferences.voice), tonic = preferences.voice.tonic;
  if (!bounds || !Number.isInteger(tonic) || tonic < bounds.low || tonic > bounds.high) throw new Error('Ce motif dépasse votre étendue vocale.');
  const ticks = EXERCISE_TICKS_PER_BEAT;
  const notes: ExerciseNote[] = cue.degrees.map(degree => ({
    role: 'cue', midi: tonic + offset(degree) + 12 * cue.octave, startTick: 0, endTick: cue.beats * ticks, syllable: '',
  }));
  let start = (cue.beats + cue.restBeats) * ticks;
  for (const [degree, beats, syllable] of exercise.steps) {
    notes.push({ role: 'voice', midi: tonic + offset(degree), startTick: start, endTick: start + Math.round(beats * ticks * exercise.gate), syllable });
    start += beats * ticks;
  }
  return { exerciseId: exercise.id, bpm: preferences.bpm, tonic, mode, durationTicks: start, notes };
}

const tempoMicros = (bpm: number) => Math.round(60_000_000 / bpm);
/** Match the MIDI tempo's integer microseconds exactly, including tempos such as 83 BPM. */
export function exerciseSecondsAt(passage: ExercisePassage, tick: number): number {
  return tick / EXERCISE_TICKS_PER_BEAT * tempoMicros(passage.bpm) / 1_000_000;
}

/** Minimal SMF type 0 encoder for the compiled passage, not a general MIDI editor. */
export function exerciseMIDI(passage: ExercisePassage): ArrayBuffer {
  const tempo = tempoMicros(passage.bpm);
  const events = [
    { tick: 0, bytes: [0xff, 0x51, 3, tempo >> 16, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, bytes: [0xc0, 0] }, { tick: 0, bytes: [0xc1, 0] },
  ];
  for (const note of passage.notes) {
    if (note.role === 'voice' && passage.mode === 'solo') continue;
    const channel = note.role === 'cue' ? 0 : 1;
    events.push({ tick: note.startTick, bytes: [0x90 + channel, note.midi, channel ? 90 : 60] });
    events.push({ tick: note.endTick, bytes: [0x80 + channel, note.midi, 0] });
  }
  // Spessa ends at its last voice event, not EOT: retain the whole silent solo window.
  events.push({ tick: passage.durationTicks, bytes: [0xb1, 123, 0] });
  events.push({ tick: passage.durationTicks, bytes: [0xff, 0x2f, 0] });
  events.sort((a, b) => a.tick - b.tick);
  const track: number[] = [];
  let previous = 0;
  for (const event of events) {
    let delta = event.tick - previous;
    const bytes = [delta & 127];
    while ((delta >>>= 7) > 0) bytes.unshift((delta & 127) | 128);
    track.push(...bytes, ...event.bytes);
    previous = event.tick;
  }
  const length = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    EXERCISE_TICKS_PER_BEAT >> 8, EXERCISE_TICKS_PER_BEAT & 255,
    0x4d, 0x54, 0x72, 0x6b, length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255,
    ...track,
  ]).buffer;
}

function preferenceKey(scope: string): string { return `chansonade.exercises.${scope}`; }
function decodePreferences(raw: string | null): ExercisePreferences | null {
  try { const value: unknown = JSON.parse(raw ?? 'null'); return object(value) ? normalizeExercisePreferences(value) : null; }
  catch { return null; }
}
export function readExercisePreferences(scope: string): ExercisePreferences {
  return decodePreferences(readPreference(preferenceKey(scope))) ?? { ...defaults };
}
export function writeExercisePreferences(scope: string, value: ExercisePreferences): void {
  writePreference(preferenceKey(scope), JSON.stringify(normalizeExercisePreferences(value)));
}
/** Call on a confirmed connection. Never overwrite even a damaged account entry or copy another account. */
export function adoptAnonymousExercisePreferences(scope: string): void {
  if (!scope.startsWith('user:') || scope.length === 5) return;
  const anonymous = decodePreferences(readPreference(preferenceKey('anonymous')));
  if (anonymous) writePreferenceIfMissing(preferenceKey(scope), JSON.stringify(anonymous));
}
