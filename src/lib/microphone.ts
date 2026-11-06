import type { PitchInput, MicrophoneState } from './pitch';

export type MicrophoneOwner = 'studio' | 'take' | 'exercises';
type Lease = { owner: MicrophoneOwner; ready: Promise<boolean> };

/** The first requester owns the input; later users borrow it without reopening. */
export class MicrophoneSession {
  private lease: Lease | null = null;
  constructor(private readonly input: PitchInput) {}
  get owner() { return this.lease?.owner ?? null; }
  get active() { return this.input.active; }
  get starting() { return this.input.state === 'starting'; }
  subscribe(listener: (state: MicrophoneState) => void) { return this.input.subscribeState(listener); }
  get context() { return this.input.contextClock; }

  acquire(owner: MicrophoneOwner, context: AudioContext | undefined, deviceId: string): Promise<boolean> {
    if (this.lease && this.input.state !== 'idle') return this.lease.ready;
    const started = this.input.start(context, deviceId);
    const lease: Lease = { owner, ready: started.then(() => this.lease === lease && this.input.active, error => {
      if (this.lease !== lease) return false;
      this.stop();
      throw error;
    }) };
    this.lease = lease;
    return lease.ready;
  }
  release(owner: MicrophoneOwner) { if (this.lease?.owner === owner) this.stop(); }
  stop() { this.lease = null; this.input.stop(); }
}
