import { microphoneWav } from './wav';
import { PITCH_CONFIG } from './pitch-config';
import { recordingMaxSamples } from './recording-limits';

export type MicrophoneConfig = { readonly deviceId: string; readonly echoCancellation: boolean };
export type MicrophoneInfo = { label: string; settings: MediaTrackSettings };

export type MicrophoneState = 'idle' | 'starting' | 'active';

export interface PitchResult {
  frequency: number;
  /** Most probable acoustic candidate before temporal decoding. */
  rawFrequency?: number;
  /** Acoustic voiced probability; the HMM makes the voiced/unvoiced decision. */
  clarity: number;
  rms: number;
  /** Nearest MIDI note, or -1 when no reliable pitch is present. */
  midi: number;
  /** Signed deviation from the nearest MIDI note. */
  cents: number;
  /** Midpoint of the captured window, in AudioContext seconds. */
  time: number;
}

/** One atomic update: final history and the replaceable frontier of its path. */
export type PitchFrame = { type: 'pitch'; confirmed: PitchResult[]; pending: PitchResult[] };

export interface RecordingStart {
  /** First captured frame, in the microphone AudioContext clock. */
  startedAt: number;
  sampleRate: number;
}

export interface MicrophoneRecording extends RecordingStart {
  audio: Blob;
  duration: number;
  samples: number;
  analysisComplete: boolean;
}

export type RecordingEndReason = 'limit' | 'interrupted';

type RecordingWaiter<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type CaptureMessage =
  | { type?: 'pitch'; samples: Float32Array; time: number }
  | ({ type: 'recording-started'; id: number } & RecordingStart)
  | { type: 'recording-chunk'; id: number; samples: Float32Array }
  | ({ type: 'recording-stopped'; id: number; duration: number; samples: number; reason?: 'manual' | 'limit' } & RecordingStart);

// A shared audio context can outlive several microphone sessions. Registering
// the same processor again would fail, so load its module once per context.
const captureModules = new WeakMap<AudioContext, Promise<void>>();

export class PitchInput {
  private context: AudioContext | null = null;
  private readonly stateListeners = new Set<(state: MicrophoneState) => void>();
  private readonly trackConfigurationChange = () => this.notifyState();
  private contextStateChange: (() => void) | null = null;
  private ownsContext = false;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mainsFilter: BiquadFilterNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private revision = 0;
  private running = false;
  private starting: Promise<void> | null = null;
  private recordingId = 0;
  private recordingData: { id: number; chunks: Float32Array[]; startedAt: number; sampleRate: number; interrupted: boolean } | null = null;
  private recordingCompletion: Promise<MicrophoneRecording> | null = null;
  private interruptionTimer: ReturnType<typeof setTimeout> | null = null;
  private interrupted = false;
  private workerFailed = false;
  private recordingStart: Promise<RecordingStart> | null = null;
  private recordingStop: Promise<MicrophoneRecording> | null = null;
  private startWaiter: RecordingWaiter<RecordingStart> | null = null;
  private stopWaiter: RecordingWaiter<MicrophoneRecording> | null = null;
  private flushId = 0;
  private flushWaiters = new Map<number, RecordingWaiter<void>>();

  constructor(private readonly callback: (result: PitchResult) => void, private readonly previewCallback: (results: PitchResult[]) => void = () => {}, private readonly onRecordingEnd: (reason: RecordingEndReason) => void = () => {}) {}

  get state(): MicrophoneState {
    return this.interrupted ? 'idle' : this.running ? 'active' : this.starting ? 'starting' : 'idle';
  }
  subscribeState(listener: (state: MicrophoneState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => { this.stateListeners.delete(listener); };
  }
  private notifyState() { for (const listener of this.stateListeners) listener(this.state); }

  get contextClock(): AudioContext | null { return this.context; }

  get active(): boolean {
    return this.running;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get inputInfo(): MicrophoneInfo | null {
    const track = this.stream?.getAudioTracks()[0];
    return track ? { label: track.label, settings: track.getSettings() } : null;
  }

  get recording(): boolean {
    return !!this.recordingData && this.recordingData.startedAt >= 0;
  }

  async startRecording(): Promise<RecordingStart> {
    if (!this.running || !this.capture || !this.context) throw new Error('Activez le micro avant d’enregistrer.');
    if (this.recordingStop) throw new Error('L’enregistrement précédent est encore en cours de sauvegarde.');
    if (this.recordingStart) return this.recordingStart;
    const revision = this.revision;
    await this.context.resume();
    if (revision !== this.revision || !this.capture || !this.context) throw new Error('Le micro a été arrêté.');
    if (this.recordingStart) return this.recordingStart;
    const id = ++this.recordingId;
    this.interrupted = false;
    this.recordingCompletion = null;
    this.recordingData = { id, chunks: [], startedAt: -1, sampleRate: this.context.sampleRate, interrupted: false };
    this.recordingStart = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancelRecording(new Error('Le démarrage de l’enregistrement a pris trop de temps.')), 5000);
      this.startWaiter = { resolve, reject, timer };
    });
    this.capture.port.postMessage({ type: 'recording-start', id });
    return this.recordingStart;
  }

  async stopRecording(): Promise<MicrophoneRecording> {
    if (this.recordingStop) return this.recordingStop;
    if (!this.recordingStart || !this.recordingData) throw new Error('Aucun enregistrement en cours.');
    await this.recordingStart;
    if (this.recordingStop) return this.recordingStop;
    if (!this.recordingData) throw new Error('Le micro a été arrêté.');
    if (this.recordingCompletion) return this.consumeRecording(this.recordingCompletion);
    const recording = this.recordingData;
    this.recordingStop = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.completeRecording(recording, false), 5000);
      this.stopWaiter = { resolve, reject, timer };
    });
    if (this.capture && !this.interrupted) this.capture.port.postMessage({ type: 'recording-stop', id: recording.id });
    else if (this.capture && this.context?.state === 'running') this.capture.port.postMessage({ type: 'recording-stop', id: recording.id });
    else this.completeRecording(recording, false);
    return this.recordingStop!;
  }

  private consumeRecording(completion: Promise<MicrophoneRecording>): Promise<MicrophoneRecording> {
    if (this.recordingStop) return this.recordingStop;
    const pending = completion.finally(() => {
      if (this.recordingStop === pending) {
        this.recordingData = null; this.recordingStart = null;
        this.recordingCompletion = null; this.recordingStop = null;
      }
    });
    this.recordingStop = pending;
    return pending;
  }

  private completeRecording(recording: NonNullable<PitchInput['recordingData']>, complete: boolean) {
    if (this.recordingData !== recording || this.recordingCompletion) return;
    if (this.interruptionTimer) { clearTimeout(this.interruptionTimer); this.interruptionTimer = null; }
    // The worklet acknowledged the audio; the decoder gets its own timeout.
    if (this.stopWaiter) clearTimeout(this.stopWaiter.timer);
    const samples = recording.chunks.reduce((total, chunk) => total + chunk.length, 0);
    this.recordingCompletion = (complete && !recording.interrupted && !this.workerFailed ? this.flushPitch().then(() => true, () => false) : Promise.resolve(false)).then(analysisComplete => ({
      audio: microphoneWav(recording.chunks, recording.sampleRate), sampleRate: recording.sampleRate,
      startedAt: recording.startedAt, duration: samples / recording.sampleRate, samples, analysisComplete,
    }));
    if (this.stopWaiter) {
      const waiter = this.stopWaiter;
      this.stopWaiter = null;
      void this.recordingCompletion.then(value => {
        waiter.resolve(value);
        if (this.recordingData === recording) {
          this.recordingData = null; this.recordingStart = null;
          this.recordingCompletion = null; this.recordingStop = null;
        }
      }, error => { waiter.reject(error instanceof Error ? error : new Error(String(error))); });
    }
  }

  private handleRecording(data: Exclude<CaptureMessage, { type?: 'pitch' }>) {
    const recording = this.recordingData;
    if (!recording || data.id !== recording.id || this.recordingCompletion) return;
    if (data.type === 'recording-chunk') {
      recording.chunks.push(data.samples);
    } else if (data.type === 'recording-started') {
      recording.startedAt = data.startedAt;
      recording.sampleRate = data.sampleRate;
      if (this.startWaiter) {
        clearTimeout(this.startWaiter.timer);
        this.startWaiter.resolve({ startedAt: data.startedAt, sampleRate: data.sampleRate });
        this.startWaiter = null;
      }
    } else {
      const samples = recording.chunks.reduce((total, chunk) => total + chunk.length, 0);
      this.completeRecording(recording, samples === data.samples);
      if (data.reason === 'limit') this.onRecordingEnd('limit');
    }
  }

  private interruptCapture(canFlush: boolean) {
    if (this.interrupted) return;
    this.interrupted = true;
    this.running = false;
    this.notifyState();
    const recording = this.recordingData;
    if (recording) {
      recording.interrupted = true;
      if (recording.startedAt < 0) {
        this.cancelRecording(new Error('Le microphone a été interrompu avant le début de l’enregistrement.'));
      } else if (canFlush && this.capture && this.context?.state === 'running') {
        this.capture.port.postMessage({ type: 'recording-stop', id: recording.id });
        this.interruptionTimer = setTimeout(() => this.completeRecording(recording, false), 1000);
      } else this.completeRecording(recording, false);
    }
    this.onRecordingEnd('interrupted');
  }

  private flushPitch(): Promise<void> {
    if (!this.worker || this.workerFailed) return Promise.reject(new Error('Le décodeur de hauteur est arrêté.'));
    const id = ++this.flushId;
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.flushWaiters.delete(id); reject(new Error('Le décodeur de hauteur ne répond pas.')); }, 4000);
      this.flushWaiters.set(id, { resolve, reject, timer });
    });
    this.worker.postMessage({ type: 'flush', id });
    return completion;
  }

  private cancelRecording(error: Error) {
    if (this.recordingData && this.capture) this.capture.port.postMessage({ type: 'recording-stop', id: this.recordingData.id });
    for (const waiter of [this.startWaiter, this.stopWaiter]) {
      if (waiter) { clearTimeout(waiter.timer); waiter.reject(error); }
    }
    this.startWaiter = null;
    this.stopWaiter = null;
    if (this.interruptionTimer) clearTimeout(this.interruptionTimer);
    this.interruptionTimer = null;
    this.recordingCompletion = null;
    this.recordingData = null;
    this.recordingStart = null;
    this.recordingStop = null;
  }

  async start(config: MicrophoneConfig, sharedAudioContext?: AudioContext): Promise<void> {
    if (this.running) return;
    if (this.recordingData) throw new Error('L’enregistrement précédent est encore en cours de sauvegarde.');
    if (this.interrupted) this.stop();
    if (this.starting) return this.starting;
    const revision = ++this.revision;
    const pending = this.connect(sharedAudioContext, revision, config);
    this.starting = pending;
    this.notifyState();
    try {
      await pending;
    } finally {
      if (this.starting === pending) { this.starting = null; this.notifyState(); }
    }
  }

  private async connect(shared: AudioContext | undefined, revision: number, config: MicrophoneConfig): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Le microphone nécessite HTTPS ou localhost.');
      }
      const context = shared ?? new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      this.ownsContext = !shared;
      // Called from the user's click, before opening the microphone prompt.
      const resumed = context.resume();
      // Keep rejection handled even if the permission prompt remains open.
      void resumed.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...(config.deviceId ? { deviceId: { exact: config.deviceId } } : {}),
          channelCount: 1,
          echoCancellation: config.echoCancellation,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (revision !== this.revision) {
        stream.getTracks().forEach((track) => track.stop());
        await resumed.catch(() => {});
        return;
      }
      this.stream = stream;
      stream.getAudioTracks()[0]?.addEventListener('configurationchange', this.trackConfigurationChange);
      await resumed;
      let module = captureModules.get(context);
      if (!module) {
        module = context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio/capture-worklet.js`);
        captureModules.set(context, module);
        void module.catch(() => captureModules.delete(context));
      }
      await module;
      if (revision !== this.revision) return;

      const worker = new Worker(new URL('./pitch-worker.ts', import.meta.url), { type: 'module' });
      const capture = new AudioWorkletNode(context, 'chansonade-pitch-capture', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { maxRecordingSamples: recordingMaxSamples(context.sampleRate), windowSize: Math.round(context.sampleRate * PITCH_CONFIG.windowMs / 1000), hopSize: Math.round(context.sampleRate / PITCH_CONFIG.hopHz) },
      });
      this.worker = worker;
      this.workerFailed = false;
      this.interrupted = false;
      this.capture = capture;
      capture.onprocessorerror = () => { if (revision === this.revision) this.interruptCapture(false); };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (revision === this.revision) this.interruptCapture(true); }, { once: true }));
      this.contextStateChange = () => { if (revision === this.revision && this.running && context.state !== 'running') this.interruptCapture(false); };
      context.addEventListener('statechange', this.contextStateChange);
      worker.onerror = worker.onmessageerror = () => {
        if (revision !== this.revision || worker !== this.worker) return;
        this.workerFailed = true;
        for (const waiter of this.flushWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Le décodeur de hauteur est arrêté.')); }
        this.flushWaiters.clear();
        this.interruptCapture(true);
      };
      this.source = context.createMediaStreamSource(stream);
      worker.onmessage = (event: MessageEvent<PitchFrame | { type: 'flushed'; id: number }>) => {
        if (revision !== this.revision || !this.running) return;
        if (event.data.type === 'flushed') {
          const waiter = this.flushWaiters.get(event.data.id);
          if (waiter) { clearTimeout(waiter.timer); waiter.resolve(); this.flushWaiters.delete(event.data.id); }
        } else {
          for (const result of event.data.confirmed) this.callback(result);
          this.previewCallback(event.data.pending);
        }
      };
      capture.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
        if (revision !== this.revision) return;
        if ('id' in event.data) {
          this.handleRecording(event.data);
        } else {
          worker.postMessage({ ...event.data, sampleRate: context.sampleRate }, [event.data.samples.buffer]);
        }
      };
      // Input 0 keeps the browser capture (raw unless AEC is chosen). Input 1 feeds
      // pitch analysis after a continuous, narrow 50 Hz mains rejection.
      const filter = context.createBiquadFilter();
      filter.type = 'notch'; filter.frequency.value = PITCH_CONFIG.mainsNotchHz; filter.Q.value = PITCH_CONFIG.mainsNotchQ;
      this.mainsFilter = filter;
      this.source.connect(capture, 0, 0);
      this.source.connect(filter);
      filter.connect(capture, 0, 1);
      // The processor emits silence: connecting it keeps capture alive without
      // sending microphone audio to speakers (and without acoustic feedback).
      capture.connect(context.destination);
      this.running = true;
      this.notifyState();
    } catch (error) {
      if (revision === this.revision) this.stop();
      throw error;
    }
  }

  stop(): void {
    // Preserve all delivered audio even if the graph disappears during a save.
    const recording = this.recordingData;
    if (recording && recording.startedAt >= 0) {
      recording.interrupted = true;
      this.completeRecording(recording, false);
    } else this.cancelRecording(new Error('Le micro a été arrêté avant la sauvegarde de l’enregistrement.'));
    ++this.revision;
    this.running = false;
    this.interrupted = false;
    if (this.contextStateChange) this.context?.removeEventListener('statechange', this.contextStateChange);
    this.contextStateChange = null;
    this.starting = null;
    this.notifyState();
    this.previewCallback([]);
    this.source?.disconnect();
    this.source = null;
    this.mainsFilter?.disconnect();
    this.mainsFilter = null;
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.port.postMessage('stop');
      this.capture.port.close();
      this.capture.disconnect();
      this.capture = null;
    }
    this.worker?.terminate();
    this.worker = null;
    for (const waiter of this.flushWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Le décodeur de hauteur est arrêté.')); }
    this.flushWaiters.clear();
    this.stream?.getAudioTracks()[0]?.removeEventListener('configurationchange', this.trackConfigurationChange);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.ownsContext && this.context?.state !== 'closed') {
      void this.context?.close().catch(() => {});
    }
    this.context = null;
    this.ownsContext = false;
  }
}
