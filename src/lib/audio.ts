import { Sequencer, WorkletSynthesizer, type BasicSynthesizerReturnMessage } from 'spessasynth_lib';
import { exerciseMIDI, exerciseSecondsAt, exerciseSoundingNotes, type ExercisePassage } from './exercises';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Load acknowledgements are serialized separately for each sequencer. */
function loadSequence(sequencer: Sequencer, binary: ArrayBuffer, fileName: string) {
  return new Promise<void>((resolve, reject) => {
    const id = 'chansonade-load';
    const cleanup = () => {
      clearTimeout(timeout);
      sequencer.eventHandler.removeEvent('songChange', id);
      sequencer.eventHandler.removeEvent('midiError', id);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Le chargement audio a pris trop de temps.'));
    }, 20_000);
    sequencer.eventHandler.addEvent('songChange', id, () => { cleanup(); resolve(); });
    sequencer.eventHandler.addEvent('midiError', id, error => { cleanup(); reject(error); });
    try { sequencer.loadNewSongList([{ binary, fileName }]); }
    catch (error) { cleanup(); reject(error); }
  });
}

export type ExerciseStart = { readonly startedAt: number; readonly duration: number };
export type ExerciseState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'preparing'; readonly passage: ExercisePassage }
  | ({ readonly phase: 'playing' | 'ended'; readonly passage: ExercisePassage; readonly time: number } & ExerciseStart);
type AuxiliaryActivity =
  | { kind: 'piano'; held: Map<number, number>; sounding: Set<number> }
  | { kind: 'exercise'; passage: ExercisePassage; cancellation: AbortController; start: ExerciseStart | null };
type AuxiliaryInstrument = {
  synth: WorkletSynthesizer;
  sequencer: Sequencer;
  node: AudioWorkletNode;
  output: GainNode;
};

/** The initial tempo event marks actual playback, including silent solo passages.
 * Loading also emits timeChange; that is not a playback acknowledgement. Read
 * the processor timestamp here, never main-thread receipt time. */
function startExerciseSequence(instrument: AuxiliaryInstrument, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      instrument.node.port.removeEventListener('message', receive);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => { cleanup(); resolve(null); };
    const receive = (event: MessageEvent<BasicSynthesizerReturnMessage[]>) => {
      for (const message of event.data) {
        if (message.type !== 'sequencerReturn' || message.data.type !== 'metaEvent') continue;
        const midi = message.data.data.event;
        if (midi.statusByte !== 0x51 || midi.ticks !== 0) continue;
        cleanup();
        resolve(message.currentTime);
        return;
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Le chargement audio a pris trop de temps.'));
    }, 20_000);
    if (signal.aborted) { cancel(); return; }
    instrument.node.port.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, { once: true });
    // Each freshly loaded exercise starts at zero; one play command is enough.
    try { instrument.sequencer.play(); }
    catch (error) { cleanup(); reject(error); }
  });
}

/** A small, browser-local player. Times are seconds in the original MIDI. */
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private sequencer: Sequencer | null = null;
  private initialization: Promise<void> | null = null;
  private soundBank: Promise<ArrayBuffer> | null = null;
  private auxiliary: AuxiliaryInstrument | null = null;
  private auxiliaryInitialization: Promise<void> | null = null;
  private auxiliaryActivity: AuxiliaryActivity | null = null;
  private auxiliaryQueue: Promise<void> = Promise.resolve();
  private loadQueue: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private loaded = false;
  private finished = false;
  private requestedRate = 1;
  private pausedPosition: number | null = 0;
  private pausedSeek = true;
  private loop: { start: number; end: number } | null = null;
  private pendingSeek: { seconds: number; requestedAt: number } | null = null;
  private preview: { channel: number; pitch: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private destroyed = false;

  get context() { return this.audioContext; }
  get ended() { return this.loaded && this.finished; }
  get playing() { return this.loaded && !!this.sequencer && !this.sequencer.paused; }
  get duration() { return this.loaded ? this.sequencer?.duration ?? 0 : 0; }

  get time() {
    if (!this.loaded || !this.sequencer) return 0;
    if (this.finished) return this.duration;
    if (this.pausedPosition !== null) return this.pausedPosition;
    // The processor acknowledges seeks asynchronously. Expose the requested
    // position immediately, so the UI never jumps back for one animation frame.
    if (this.pendingSeek && performance.now() - this.pendingSeek.requestedAt < 500) {
      return this.pendingSeek.seconds;
    }
    return clamp(this.sequencer.currentHighResolutionTime, 0, this.duration);
  }

  private loadSoundBank() {
    if (!this.soundBank) {
      this.soundBank = fetch(`${import.meta.env.BASE_URL}audio/TimGM6mb.sf2`)
        .then(async (response) => {
          if (!response.ok) throw new Error('Impossible de charger la banque de sons.');
          return response.arrayBuffer();
        }).catch((error) => {
          this.soundBank = null;
          throw error;
        });
    }
    return this.soundBank;
  }

  private async initialize() {
    if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
    if (!this.initialization) {
      this.initialization = (async () => {
        const context = new AudioContext({ latencyHint: 'interactive' });
        this.audioContext = context;
        if (!context.audioWorklet) {
          throw new Error('Le moteur audio nécessite HTTPS ou localhost et un navigateur récent.');
        }
        await context.audioWorklet.addModule(processorUrl);
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        const synth = new WorkletSynthesizer(context);
        this.synth = synth;
        synth.setLogLevel(false, true, false);
        synth.connect(context.destination);
        await synth.isReady;
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        // addSoundBank transfers its buffer; retain the original for the auxiliary instrument.
        const soundBank = await this.loadSoundBank();
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        await synth.soundBankManager.addSoundBank(soundBank.slice(0), 'chansonade');
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        synth.setSystemParameter('gain', 0.65);

        const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
        this.sequencer = sequencer;
        sequencer.loopCount = 0;
        sequencer.eventHandler.addEvent('timeChange', 'chansonade-position', () => {
          this.pendingSeek = null;
        });
        sequencer.eventHandler.addEvent('songEnded', 'chansonade-end', () => {
          // Covers a B point at the very end, before the next UI frame arrives.
          if (this.loaded && this.loop) {
            this.startPlayback(this.loop.start);
          } else if (this.loaded) {
            this.finished = true;
            this.pausedPosition = this.duration;
          }
        });
      })().catch(async (error) => {
        this.synth?.destroy();
        this.synth = null;
        this.sequencer = null;
        await this.audioContext?.close().catch(() => {});
        this.audioContext = null;
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  async load(midiBase64: string) {
    const generation = ++this.loadGeneration;
    this.stop();
    this.loaded = false;
    this.finished = false;
    this.loop = null;
    this.requestedRate = 1;
    // Serialize loads: a late songChange from an old file must not resolve the
    // promise belonging to a new file. Superseded queued files are skipped.
    const task = this.loadQueue.catch(() => {}).then(async () => {
      await this.initialize();
      if (generation !== this.loadGeneration || this.destroyed) return;
      const sequencer = this.sequencer!;
      const synth = this.synth!;
      for (const channel of synth.midiChannels) {
        channel.setSystemParameter('presetLock', false);
        channel.setSystemParameter('isMuted', false);
        channel.setSystemParameter('gain', 1);
        channel.setSystemParameter('keyShift', 0);
      }
      const bytes = Uint8Array.from(atob(midiBase64), (c) => c.charCodeAt(0));
      await loadSequence(sequencer, bytes.buffer, 'partition.mid');
      if (generation !== this.loadGeneration || this.destroyed) return;
      sequencer.loopCount = 0;
      sequencer.playbackRate = this.requestedRate;
      sequencer.pause();
      this.pausedPosition = 0;
      this.pausedSeek = true;
      this.pendingSeek = null;
      this.loaded = true;
    });
    this.loadQueue = task;
    await task;
  }

  async play() {
    // Call resume while still inside the button's user activation.
    const resume = this.audioContext?.resume();
    await this.initialize();
    await (resume ?? this.audioContext!.resume());
    if (!this.loaded || !this.sequencer) throw new Error('Ouvre d’abord une partition.');
    if (this.playing) return;
    let position = this.time;
    const restart = position >= this.duration - 0.02 || !!(this.loop && position >= this.loop.end);
    if (restart) position = this.loop?.start ?? 0;
    this.startPlayback(position, this.pausedSeek || restart);
  }

  private startPlayback(position: number, reseek = true) {
    if (!this.sequencer) return;
    this.stopPreview();
    this.finished = false;
    this.pausedPosition = null;
    // Spessa snaps a paused seek to the next MIDI event. Unpause first, then
    // seek in the same worklet message queue, so playback starts at our time.
    this.sequencer.play();
    if (reseek) this.seek(position);
    this.pausedSeek = false;
  }

  pause() {
    const position = this.time;
    this.stopPreview();
    this.sequencer?.pause();
    if (this.pausedPosition === null) {
      this.pausedSeek = !!this.pendingSeek;
      // A plain pause keeps Spessa's held-note state for a normal resume.
      this.pausedPosition = this.pendingSeek ? position : clamp(this.sequencer?.currentTime ?? position, 0, this.duration);
    }
    this.pendingSeek = null;
    this.synth?.stopAll(true);
  }

  stop() {
    this.pause();
    this.finished = false;
    this.pausedPosition = this.loop?.start ?? 0;
    this.pausedSeek = true;
    this.pendingSeek = null;
  }

  seek(seconds: number) {
    if (!this.loaded || !this.sequencer) return;
    this.finished = false;
    const position = clamp(seconds, 0, this.duration);
    this.stopPreview();
    this.synth?.stopAll(true);
    if (this.pausedPosition !== null) {
      // Hold this logical position until play(). Late processor sync messages
      // must not change a paused cursor or the start of a recorded count-in.
      this.pausedPosition = position;
      this.pausedSeek = true;
      this.pendingSeek = null;
      return;
    }
    this.pendingSeek = { seconds: position, requestedAt: performance.now() };
    // Score selection uses Verovio's nearest-millisecond timemap. Its MIDI
    // onset may lie up to half a millisecond earlier; include that onset rather
    // than skipping the first note when seeking to its rounded display time.
    this.sequencer.currentTime = Math.max(0, position - 0.0005);
  }

  setRate(multiplier: number) {
    this.requestedRate = clamp(multiplier, 0.1, 4);
    if (this.sequencer) this.sequencer.playbackRate = this.requestedRate;
  }

  /** Pass null to disable. Call update() in the app's animation loop. */
  setLoop(startSeconds: number | null, endSeconds: number | null = null) {
    if (startSeconds === null || endSeconds === null || !this.loaded) {
      this.loop = null;
      return;
    }
    const start = clamp(startSeconds, 0, this.duration);
    const end = clamp(endSeconds, 0, this.duration);
    this.loop = end > start + 0.02 ? { start, end } : null;
  }

  /** POC A–B loop: at most one animation frame late, not sample-accurate. */
  update(): boolean {
    if (this.playing && this.loop && !this.pendingSeek && this.time >= this.loop.end) {
      this.seek(this.loop.start);
      return true;
    }
    return false;
  }

  setVolume(channel: number, volume: number) {
    // System gain preserves the score's own MIDI volume/expression changes.
    this.synth?.midiChannels[channel]?.setSystemParameter('gain', clamp(volume, 0, 127) / 100);
  }

  setMuted(channel: number, muted: boolean) {
    this.synth?.midiChannels[channel]?.setSystemParameter('isMuted', muted);
  }

  setProgram(channel: number, program: number) {
    const target = this.synth?.midiChannels[channel];
    if (!target || !this.synth) return;
    target.setSystemParameter('presetLock', false);
    this.synth.programChange(channel, Math.round(clamp(program, 0, 127)));
    target.setSystemParameter('presetLock', true);
  }

  setTranspose(channel: number, semitones: number) {
    this.stopPreview();
    this.synth?.midiChannels[channel]?.setSystemParameter('keyShift', Math.round(clamp(semitones, -48, 48)));
  }

  async prepareAuxiliary() {
    if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
    if (!this.auxiliaryInitialization) {
      this.auxiliaryInitialization = (async () => {
        await this.initialize();
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        const context = this.audioContext!;
        let node!: AudioWorkletNode;
        const synth = new WorkletSynthesizer(context, {
          audioNodeCreators: { worklet: (ctx, name, options) => {
            node = new AudioWorkletNode(ctx, name, options);
            return node;
          } },
        });
        const output = context.createGain();
        output.gain.value = 0;
        output.connect(context.destination);
        synth.connect(output);
        synth.setLogLevel(false, true, false);
        const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
        sequencer.loopCount = 0;
        this.auxiliary = { synth, sequencer, node, output };
        await synth.isReady;
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        const soundBank = await this.loadSoundBank();
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        await synth.soundBankManager.addSoundBank(soundBank.slice(0), 'chansonade-auxiliary');
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        synth.programChange(0, 0);
        synth.setSystemParameter('gain', 0.65);
      })().catch((error) => {
        this.auxiliary?.synth.destroy();
        this.auxiliary?.output.disconnect();
        this.auxiliary = null;
        this.auxiliaryInitialization = null;
        throw error;
      });
    }
    await Promise.all([this.auxiliaryInitialization, this.audioContext?.resume()]);
  }

  get exerciseState(): ExerciseState {
    const activity = this.auxiliaryActivity;
    if (activity?.kind !== 'exercise') return { phase: 'idle' };
    if (!activity.start) return { phase: 'preparing', passage: activity.passage };
    return {
      phase: this.auxiliary!.sequencer.isFinished ? 'ended' : 'playing',
      passage: activity.passage,
      ...activity.start,
      time: clamp(this.audioContext!.currentTime - activity.start.startedAt, 0, activity.start.duration),
    };
  }

  /** Last request owns the auxiliary instrument. No score transport or mix changes.
   * startedAt is in AudioContext seconds, on the same clock as microphone capture.
   * A superseded start resolves null, including initialization and MIDI loading. */
  async startExercise(passage: ExercisePassage): Promise<ExerciseStart | null> {
    this.stopAuxiliary();
    const activity: AuxiliaryActivity = { kind: 'exercise', passage, cancellation: new AbortController(), start: null };
    this.auxiliaryActivity = activity;
    try {
      await this.prepareAuxiliary();
      if (this.auxiliaryActivity !== activity) return null;
      const task = this.auxiliaryQueue.then(async () => {
        if (this.auxiliaryActivity !== activity) return null;
        const instrument = this.auxiliary!;
        await loadSequence(instrument.sequencer, exerciseMIDI(passage), 'exercice.mid');
        if (this.auxiliaryActivity !== activity) return null;
        // A silent passage must also silence the previous program’s effect tails.
        instrument.output.gain.value = exerciseSoundingNotes(passage).length ? 1 : 0;
        const startedAt = await startExerciseSequence(instrument, activity.cancellation.signal);
        if (startedAt === null || this.auxiliaryActivity !== activity) return null;
        activity.start = { startedAt, duration: exerciseSecondsAt(passage, passage.durationTicks) };
        return activity.start;
      });
      // Loading acknowledgements stay ordered even when a request is cancelled.
      this.auxiliaryQueue = task.then(() => {}, () => {});
      return await task;
    } catch (error) {
      if (this.auxiliaryActivity !== activity) return null;
      this.stopAuxiliary();
      throw error;
    }
  }

  /** Each source must pair its noteOn with a noteOff, including repeated keys. */
  async pianoNoteOn(midi: number): Promise<void> {
    if (this.auxiliaryActivity?.kind !== 'piano') {
      this.stopAuxiliary();
      this.auxiliaryActivity = { kind: 'piano', held: new Map(), sounding: new Set() };
    }
    const activity = this.auxiliaryActivity;
    const note = Math.round(clamp(midi, 0, 127));
    activity.held.set(note, (activity.held.get(note) ?? 0) + 1);
    try {
      await this.prepareAuxiliary();
      if (this.auxiliaryActivity !== activity || !activity.held.has(note) || activity.sounding.has(note)) return;
      this.auxiliary!.output.gain.value = 1;
      this.auxiliary!.synth.noteOn(0, note, 95);
      activity.sounding.add(note);
    } catch (error) {
      if (this.auxiliaryActivity !== activity) return;
      this.stopAuxiliary();
      throw error;
    }
  }

  pianoNoteOff(midi: number): void {
    const activity = this.auxiliaryActivity;
    if (activity?.kind !== 'piano') return;
    const note = Math.round(clamp(midi, 0, 127));
    const held = activity.held.get(note) ?? 0;
    if (held > 1) { activity.held.set(note, held - 1); return; }
    activity.held.delete(note);
    if (activity.sounding.delete(note)) this.auxiliary?.synth.noteOff(0, note);
  }

  stopAuxiliary(): void {
    const activity = this.auxiliaryActivity;
    this.auxiliaryActivity = null;
    if (activity?.kind === 'exercise') activity.cancellation.abort();
    this.auxiliary?.sequencer.pause();
    this.auxiliary?.synth.stopAll(true);
    // Cut effect tails as well as voices; late initialization never opens output.
    if (this.auxiliary) this.auxiliary.output.gain.value = 0;
  }

  async previewNote(channel: number, pitch: number) {
    const resume = this.audioContext?.resume();
    await this.initialize();
    await (resume ?? this.audioContext!.resume());
    if (this.playing || !this.synth?.midiChannels[channel]) return;
    this.stopPreview();
    const note = Math.round(clamp(pitch, 0, 127));
    this.synth.noteOn(channel, note, 95);
    const timer = setTimeout(() => this.stopPreview(), 450);
    this.preview = { channel, pitch: note, timer };
  }

  private stopPreview() {
    if (!this.preview) return;
    clearTimeout(this.preview.timer);
    this.synth?.noteOff(this.preview.channel, this.preview.pitch);
    this.preview = null;
  }

  async destroy() {
    this.destroyed = true;
    ++this.loadGeneration;
    this.loaded = false;
    this.loop = null;
    this.stopAuxiliary();
    this.pause();
    this.auxiliary?.synth.destroy();
    this.auxiliary?.output.disconnect();
    this.auxiliary = null;
    this.synth?.destroy();
    this.synth = null;
    this.sequencer = null;
    await this.audioContext?.close();
    this.audioContext = null;
    this.soundBank = null;
  }
}
