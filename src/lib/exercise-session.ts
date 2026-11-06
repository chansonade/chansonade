import type { AudioPlayer, ExerciseStart } from './audio';
import { exerciseSecondsAt, type ExercisePassage } from './exercises';
import type { MicrophoneSession } from './microphone';
import type { PitchResult } from './pitch';

export type ExercisePitch = { captureTime: number; time: number; frequency: number; expectedMidi: number | null; cents: number | null };
export type ExerciseSessionState =
  | { phase: 'idle' }
  | { phase: 'preparing'; passage: ExercisePassage }
  | ({ phase: 'playing' | 'ended' | 'stopped'; passage: ExercisePassage; time: number } & ExerciseStart);
type Run = {
  passage: ExercisePassage;
  origin: ExerciseStart | null;
  context: AudioContext | null;
  offset: number;
  latencyMs: number;
  stoppedAt: number | null;
  confirmed: PitchResult[];
  pending: PitchResult[];
};
type Region = { context: AudioContext; from: number; to: number | null };

/** Passage snapshots and capture-time routing, independent of score geometry.
 * Keep routing boundaries for the microphone session, not old curves. Worker
 * delivery order or current UI settings cannot change a measurement's target. */
export class ExerciseSession {
  private run: Run | null = null;
  private regions: Region[] = [];
  constructor(private readonly audio: AudioPlayer, private readonly microphone: MicrophoneSession) {}

  enter() {
    const context = this.microphone.context;
    if (!context) return;
    const last = this.regions.at(-1);
    if (last?.context === context && last.to === null) return;
    // PitchInput discards messages from a closed session. No old clock survives it.
    if (last?.context !== context) this.regions = [];
    this.regions.push({ context, from: context.currentTime, to: null });
  }
  leave() {
    const region = this.regions.at(-1);
    if (region && region.to === null) region.to = region.context.currentTime;
    this.stop();
  }
  reset() { this.leave(); this.run = null; }

  async start(passage: ExercisePassage, options: { deviceId: string; latencyMs: number }): Promise<void> {
    this.endPassage();
    const run: Run = {
      passage, origin: null, context: null, offset: 0, latencyMs: options.latencyMs,
      stoppedAt: null, confirmed: [], pending: [],
    };
    this.run = run;
    try {
      // Preparing the shared instrument creates its context synchronously, in the
      // gesture. Open/reuse the microphone before giving the starting chord.
      const prepared = this.audio.prepareAuxiliary();
      let capture: Promise<boolean>;
      if (passage.mode === 'listen') {
        this.microphone.release('exercises');
        capture = Promise.resolve(true);
      } else capture = this.microphone.acquire('exercises', this.audio.context ?? undefined, options.deviceId);
      const [, ready] = await Promise.all([prepared, capture]);
      if (this.run !== run || run.stoppedAt !== null) return;
      if (!ready) { this.stop(); return; }
      this.enter();
      run.context = this.microphone.context;
      // One paired clock observation, frozen for this passage. A shared context
      // has exactly zero offset; separate running contexts have different origins.
      run.offset = run.context && run.context !== this.audio.context
        ? this.audio.context!.currentTime - run.context.currentTime : 0;
      run.origin = await this.audio.startExercise(passage);
      if (this.run === run && run.origin) {
        run.confirmed = run.confirmed.filter(result => this.locate(result));
        run.pending = run.pending.filter(result => this.locate(result));
      }
      if (this.run === run && run.stoppedAt === null && !run.origin) this.stop();
    } catch (error) {
      if (this.run !== run || run.stoppedAt !== null) return;
      this.stop();
      throw error;
    }
  }
  private endPassage() {
    if (this.run && this.run.stoppedAt === null) this.run.stoppedAt = this.audio.context?.currentTime ?? 0;
    this.audio.stopAuxiliary();
  }
  stop() { this.endPassage(); this.microphone.release('exercises'); }
  clear() { this.endPassage(); this.run = null; }

  private owns(time: number) {
    const context = this.microphone.context;
    return this.regions.some(region => region.context === context && time >= region.from && (region.to === null || time < region.to));
  }
  confirm(result: PitchResult): boolean {
    if (!this.owns(result.time)) return false;
    const run = this.run;
    if (run && run.passage.mode !== 'listen' && run.context === this.microphone.context
      && (!run.origin || this.locate(result))) run.confirmed.push(result);
    return true;
  }
  preview(results: PitchResult[]): PitchResult[] {
    const run = this.run;
    // Stopping the input emits an empty preview after active becomes false.
    // Retain its last real frontier, still provisional, instead of erasing it.
    if (run && this.microphone.active) run.pending = run.passage.mode !== 'listen' && run.context === this.microphone.context
      ? results.filter(result => this.owns(result.time) && (!run.origin || this.locate(result))) : [];
    return results.filter(result => !this.owns(result.time));
  }
  private locate(result: PitchResult): ExercisePitch | null {
    const run = this.run;
    if (!run?.origin) return null;
    const absolute = result.time + run.offset - run.latencyMs / 1000;
    const time = absolute - run.origin.startedAt;
    if (time < 0 || time > run.origin.duration || (run.stoppedAt !== null && absolute > run.stoppedAt)) return null;
    const expected = run.passage.notes.find(note => note.role === 'voice'
      && time >= exerciseSecondsAt(run.passage, note.startTick) && time < exerciseSecondsAt(run.passage, note.endTick));
    return { captureTime: result.time, time, frequency: result.frequency, expectedMidi: expected?.midi ?? null,
      cents: result.frequency > 0 && expected ? (69 + 12 * Math.log2(result.frequency / 440) - expected.midi) * 100 : null };
  }
  private project(results: PitchResult[]): ExercisePitch[] {
    return results.flatMap(result => { const point = this.locate(result); return point ? [point] : []; });
  }
  get confirmed() { return this.project(this.run?.confirmed ?? []); }
  get pending() { return this.project(this.run?.pending ?? []); }
  get canStop() { return (!!this.run && this.run.stoppedAt === null) || this.microphone.owner === 'exercises'; }
  get microphoneActive() { return this.microphone.active; }
  get state(): ExerciseSessionState {
    const run = this.run;
    if (!run) return { phase: 'idle' };
    if (!run.origin) return run.stoppedAt === null ? { phase: 'preparing', passage: run.passage } : { phase: 'idle' };
    const time = Math.max(0, Math.min(run.origin.duration, (run.stoppedAt ?? this.audio.context!.currentTime) - run.origin.startedAt));
    return { phase: run.stoppedAt !== null ? 'stopped' : this.audio.exerciseState.phase === 'ended' ? 'ended' : 'playing', passage: run.passage, ...run.origin, time };
  }
}
