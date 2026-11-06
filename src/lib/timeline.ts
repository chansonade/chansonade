export type TransportMoment = { captureTime: number; scoreTime: number; rate: number; playing: boolean; targetChannel: number; transpose: number; epoch: number };

/** Transport and musical context, expressed in the microphone's own clock. */
export class CaptureTimeline {
  private segments: TransportMoment[] = [];
  private revision = 0;
  private last: TransportMoment | null = null;

  get epoch() { return this.revision; }

  reset() { this.segments = []; this.last = null; this.revision++; }

  observe(moment: Omit<TransportMoment, 'epoch'>, discontinuity = false): boolean {
    const { captureTime, scoreTime, rate, playing } = moment;
    if (this.last && captureTime < this.last.captureTime) this.reset();
    const previous = this.last;
    const predicted = previous ? previous.scoreTime + (previous.playing ? (captureTime - previous.captureTime) * previous.rate : 0) : scoreTime;
    const jumped = !!previous && Math.abs(scoreTime - predicted) > 0.08;
    if (discontinuity || jumped) this.revision++;
    const value = { ...moment, epoch: this.revision };
    const boundary = !previous || discontinuity || jumped || previous.playing !== playing || previous.rate !== rate || previous.targetChannel !== moment.targetChannel || previous.transpose !== moment.transpose;
    if (boundary) this.segments.push(value);
    // Fixed-lag observations need only recent transport boundaries. Keep the
    // last boundary before that horizon, even during a long uninterrupted note.
    while (this.segments.length > 1 && this.segments[1].captureTime < captureTime - 3) this.segments.shift();
    this.last = value;
    return boundary;
  }

  at(captureTime: number): TransportMoment | null {
    if (!this.segments.length || captureTime < this.segments[0].captureTime) return null;
    let lo = 0, hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.segments[mid].captureTime <= captureTime) lo = mid;
      else hi = mid - 1;
    }
    const segment = this.segments[lo];
    return { ...segment, captureTime, scoreTime: Math.max(0, segment.scoreTime + (segment.playing ? (captureTime - segment.captureTime) * segment.rate : 0)) };
  }
}
