import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** A small, browser-local player. Times are seconds in the original MIDI. */
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private sequencer: Sequencer | null = null;
  private initialization: Promise<void> | null = null;
  private soundBank: Promise<ArrayBuffer> | null = null;
  private pianoSynth: WorkletSynthesizer | null = null;
  private pianoInitialization: Promise<void> | null = null;
  private pianoHeld = new Map<number, number>();
  private pianoSounding = new Set<number>();
  private loadQueue: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private loaded = false;
  private finished = false;
  private requestedRate = 1;
  private loop: { start: number; end: number } | null = null;
  private pendingSeek: { seconds: number; requestedAt: number } | null = null;
  private preview: { channel: number; pitch: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private destroyed = false;

  get context() { return this.audioContext; }
  get ready() { return this.loaded; }
  get ended() { return this.loaded && this.finished; }
  get playing() { return this.loaded && !!this.sequencer && !this.sequencer.paused; }
  get duration() { return this.loaded ? this.sequencer?.duration ?? 0 : 0; }
  get currentTempo() { return (this.sequencer?.currentTempo ?? 120) * this.requestedRate; }
  get rate() { return this.requestedRate; }

  get time() {
    if (!this.loaded || !this.sequencer) return 0;
    if (this.finished) return this.duration;
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
        const synth = new WorkletSynthesizer(context);
        this.synth = synth;
        synth.setLogLevel(false, true, false);
        synth.connect(context.destination);
        await synth.isReady;
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        // addSoundBank transfers its buffer; retain the original for the piano.
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
            this.seek(this.loop.start);
            sequencer.play();
          } else if (this.loaded) this.finished = true;
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
      await new Promise<void>((resolve, reject) => {
        const id = `chansonade-load-${generation}`;
        const cleanup = () => {
          clearTimeout(timeout);
          sequencer.eventHandler.removeEvent('songChange', id);
          sequencer.eventHandler.removeEvent('midiError', id);
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Le chargement audio a pris trop de temps.'));
        }, 20_000);
        sequencer.eventHandler.addEvent('songChange', id, () => {
          cleanup();
          resolve();
        });
        sequencer.eventHandler.addEvent('midiError', id, (error) => {
          cleanup();
          reject(error);
        });
        try {
          sequencer.loadNewSongList([{ binary: bytes.buffer, fileName: 'partition.mid' }]);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
      if (generation !== this.loadGeneration || this.destroyed) return;
      sequencer.loopCount = 0;
      sequencer.playbackRate = this.requestedRate;
      sequencer.pause();
      sequencer.currentTime = 0;
      this.pendingSeek = { seconds: 0, requestedAt: performance.now() };
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
    this.stopPreview();
    if (this.time >= this.duration - 0.02 || (this.loop && this.time >= this.loop.end)) {
      this.seek(this.loop?.start ?? 0);
    }
    this.finished = false;
    this.sequencer.play();
  }

  pause() {
    this.stopPreview();
    this.sequencer?.pause();
    this.synth?.stopAll(true);
  }

  stop() {
    this.pause();
    this.finished = false;
    if (this.sequencer) {
      this.sequencer.currentTime = this.loop?.start ?? 0;
      this.pendingSeek = { seconds: this.loop?.start ?? 0, requestedAt: performance.now() };
    }
  }

  seek(seconds: number) {
    if (!this.loaded || !this.sequencer) return;
    this.finished = false;
    const position = clamp(seconds, 0, this.duration);
    this.stopPreview();
    this.synth?.stopAll(true);
    this.pendingSeek = { seconds: position, requestedAt: performance.now() };
    this.sequencer.currentTime = position;
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

  setGain(gain: number) {
    this.synth?.setSystemParameter('gain', clamp(gain, 0, 2));
  }

  private async initializePiano() {
    if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
    if (!this.pianoInitialization) {
      this.pianoInitialization = (async () => {
        await this.initialize();
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        const synth = new WorkletSynthesizer(this.audioContext!);
        this.pianoSynth = synth;
        synth.setLogLevel(false, true, false);
        synth.connect(this.audioContext!.destination);
        await synth.isReady;
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        const soundBank = await this.loadSoundBank();
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        await synth.soundBankManager.addSoundBank(soundBank.slice(0), 'chansonade-piano');
        if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
        synth.programChange(0, 0);
        synth.setSystemParameter('gain', 0.65);
      })().catch((error) => {
        this.pianoSynth?.destroy();
        this.pianoSynth = null;
        this.pianoInitialization = null;
        this.pianoHeld.clear();
        this.pianoSounding.clear();
        throw error;
      });
    }
    await this.pianoInitialization;
  }

  /** Each source must pair its noteOn with a noteOff, including repeated keys. */
  async pianoNoteOn(midi: number): Promise<void> {
    if (this.destroyed) throw new Error('Le lecteur audio a été fermé.');
    const note = Math.round(clamp(midi, 0, 127));
    this.pianoHeld.set(note, (this.pianoHeld.get(note) ?? 0) + 1);
    const initialization = this.initializePiano();
    // initialize creates the context synchronously, so resume stays in the gesture.
    await Promise.all([initialization, this.audioContext?.resume()]);
    if (!this.destroyed && this.pianoHeld.has(note) && !this.pianoSounding.has(note)) {
      this.pianoSynth!.noteOn(0, note, 95);
      this.pianoSounding.add(note);
    }
  }

  pianoNoteOff(midi: number): void {
    const note = Math.round(clamp(midi, 0, 127));
    const held = this.pianoHeld.get(note) ?? 0;
    if (held > 1) {
      this.pianoHeld.set(note, held - 1);
      return;
    }
    this.pianoHeld.delete(note);
    if (this.pianoSounding.delete(note)) this.pianoSynth?.noteOff(0, note);
  }

  stopPiano(): void {
    this.pianoHeld.clear();
    this.pianoSounding.clear();
    this.pianoSynth?.stopAll(true);
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
    this.stopPiano();
    this.pause();
    this.pianoSynth?.destroy();
    this.pianoSynth = null;
    this.synth?.destroy();
    this.synth = null;
    this.sequencer = null;
    await this.audioContext?.close();
    this.audioContext = null;
    this.soundBank = null;
  }
}
