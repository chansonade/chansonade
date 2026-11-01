import { microphoneWav } from './wav';
import { PITCH_CONFIG } from './pitch-config';

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

type RecordingWaiter<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type CaptureMessage =
  | { type?: 'pitch'; samples: Float32Array; time: number }
  | ({ type: 'recording-started'; id: number } & RecordingStart)
  | { type: 'recording-chunk'; id: number; samples: Float32Array }
  | ({ type: 'recording-stopped'; id: number; duration: number; samples: number } & RecordingStart);

/** Fractional MIDI pitch; use Math.round() for the nearest note. */
export function frequencyToMidi(frequency: number): number {
  return frequency > 0 ? 69 + 12 * Math.log2(frequency / 440) : -1;
}

// A shared audio context can outlive several microphone sessions. Registering
// the same processor again would fail, so load its module once per context.
const captureModules = new WeakMap<AudioContext, Promise<void>>();

export class PitchInput {
  private context: AudioContext | null = null;
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
  private recordingData: { id: number; chunks: Float32Array[]; startedAt: number; sampleRate: number } | null = null;
  private recordingStart: Promise<RecordingStart> | null = null;
  private recordingStop: Promise<MicrophoneRecording> | null = null;
  private startWaiter: RecordingWaiter<RecordingStart> | null = null;
  private stopWaiter: RecordingWaiter<MicrophoneRecording> | null = null;
  private flushId = 0;
  private flushWaiters = new Map<number, RecordingWaiter<void>>();

  constructor(private readonly callback: (result: PitchResult) => void, private readonly previewCallback: (results: PitchResult[]) => void = () => {}) {}

  get active(): boolean {
    return this.running;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get inputInfo(): { label: string; settings: MediaTrackSettings } | null {
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
    this.recordingData = { id, chunks: [], startedAt: -1, sampleRate: this.context.sampleRate };
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
    if (!this.recordingData || !this.capture) throw new Error('Le micro a été arrêté.');
    if (this.recordingStop) return this.recordingStop;
    this.recordingStop = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancelRecording(new Error('La fin de l’enregistrement a pris trop de temps.')), 5000);
      this.stopWaiter = { resolve, reject, timer };
    });
    this.capture.port.postMessage({ type: 'recording-stop', id: this.recordingData.id });
    return this.recordingStop;
  }

  private handleRecording(data: Exclude<CaptureMessage, { type?: 'pitch' }>) {
    const recording = this.recordingData;
    if (!recording || data.id !== recording.id) return;
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
      if (samples !== data.samples) {
        this.cancelRecording(new Error('L’enregistrement audio est incomplet.'));
        return;
      }
      // Resolve only after the temporal decoder has emitted its pending tail.
      // Its callbacks must reach App before the take's metadata is frozen.
      const finish = (analysisComplete: boolean) => {
        if (this.recordingData !== recording || !this.stopWaiter) return;
        clearTimeout(this.stopWaiter.timer);
        this.stopWaiter.resolve({ audio: microphoneWav(recording.chunks, recording.sampleRate), sampleRate: recording.sampleRate, startedAt: recording.startedAt, duration: samples / recording.sampleRate, samples, analysisComplete });
        this.stopWaiter = null;
        this.recordingData = null;
        this.recordingStart = null;
        this.recordingStop = null;
      };
      // A decoder failure must never discard an already complete recording.
      void this.flushPitch().then(() => finish(true), () => finish(false));
    }
  }

  private flushPitch(): Promise<void> {
    if (!this.worker) return Promise.reject(new Error('Le décodeur de hauteur est arrêté.'));
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
    this.recordingData = null;
    this.recordingStart = null;
    this.recordingStop = null;
  }

  async start(sharedAudioContext?: AudioContext, deviceId = ''): Promise<void> {
    if (this.running) return;
    if (this.starting) return this.starting;
    const revision = ++this.revision;
    const pending = this.connect(sharedAudioContext, revision, deviceId);
    this.starting = pending;
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = null;
    }
  }

  private async connect(shared: AudioContext | undefined, revision: number, deviceId: string): Promise<void> {
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
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: false,
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
        processorOptions: { windowSize: Math.round(context.sampleRate * PITCH_CONFIG.windowMs / 1000), hopSize: Math.round(context.sampleRate / PITCH_CONFIG.hopHz) },
      });
      this.worker = worker;
      this.capture = capture;
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
      // Input 0 stays completely unfiltered for WAV recording. Input 1 feeds
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
    } catch (error) {
      if (revision === this.revision) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.cancelRecording(new Error('Le micro a été arrêté avant la sauvegarde de l’enregistrement.'));
    ++this.revision;
    this.running = false;
    this.previewCallback([]);
    this.starting = null;
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
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.ownsContext && this.context?.state !== 'closed') {
      void this.context?.close().catch(() => {});
    }
    this.context = null;
    this.ownsContext = false;
  }
}
