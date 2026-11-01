class PitchCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { windowSize = 4096, hopSize = Math.round(sampleRate / 35) } = options.processorOptions ?? {};
    this.buffer = new Float32Array(windowSize);
    this.position = 0;
    this.filled = 0;
    this.sinceWindow = 0;
    this.hopSize = hopSize;
    this.running = true;
    this.commands = [];
    this.recording = null;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') this.running = false;
      else if (data?.type === 'recording-start' || data?.type === 'recording-stop') this.commands.push(data);
    };
  }

  flushRecording() {
    const recording = this.recording;
    if (!recording || !recording.position) return;
    const samples = recording.position === recording.buffer.length
      ? recording.buffer
      : recording.buffer.slice(0, recording.position);
    this.port.postMessage({ type: 'recording-chunk', id: recording.id, samples }, [samples.buffer]);
    recording.buffer = new Float32Array(8192);
    recording.position = 0;
  }

  process(inputs, outputs) {
    if (!this.running) return false;
    // Acknowledge at an audio-block boundary: the first recorded frame and the
    // stop frame share exactly the same clock as the pitch-window timestamps.
    for (const command of this.commands) {
      if (command.type === 'recording-start' && !this.recording) {
        this.recording = { id: command.id, frame: currentFrame, samples: 0, buffer: new Float32Array(8192), position: 0 };
        this.port.postMessage({ type: 'recording-started', id: command.id, startedAt: currentFrame / sampleRate, sampleRate });
      } else if (command.type === 'recording-stop' && this.recording?.id === command.id) {
        this.flushRecording();
        const recording = this.recording;
        this.port.postMessage({ type: 'recording-stopped', id: recording.id, startedAt: recording.frame / sampleRate, sampleRate, samples: recording.samples, duration: recording.samples / sampleRate });
        this.recording = null;
      }
    }
    this.commands.length = 0;
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    const analysisChannels = inputs[1]?.length ? inputs[1] : channels;
    const hasInput = !!channels?.length && !!channels[0].length;
    const length = channels?.[0]?.length || outputs[0]?.[0]?.length || 128;
    for (let index = 0; index < length; index++) {
      let value = 0;
      if (hasInput) {
        for (const channel of channels) value += channel[index];
        value /= channels.length;
      }
      if (this.recording) {
        this.recording.buffer[this.recording.position++] = value;
        this.recording.samples++;
        if (this.recording.position === this.recording.buffer.length) this.flushRecording();
      }
      if (hasInput) {
        let analyzed = 0;
        for (const channel of analysisChannels) analyzed += channel[index];
        this.buffer[this.position] = analyzed / analysisChannels.length;
        this.position = (this.position + 1) % this.buffer.length;
      }
    }
    if (!hasInput) return true;
    this.filled = Math.min(this.buffer.length, this.filled + length);
    this.sinceWindow += length;
    if (this.filled === this.buffer.length && this.sinceWindow >= this.hopSize) {
      this.sinceWindow %= this.hopSize;
      const samples = new Float32Array(this.buffer.length);
      samples.set(this.buffer.subarray(this.position));
      samples.set(this.buffer.subarray(0, this.position), this.buffer.length - this.position);
      const time = (currentFrame + length - this.buffer.length / 2) / sampleRate;
      this.port.postMessage({ type: 'pitch', samples, time }, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor('chansonade-pitch-capture', PitchCapture);
