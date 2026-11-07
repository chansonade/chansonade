import { readPreference, writePreference } from './preferences';
import type { PitchInput, MicrophoneState, MicrophoneConfig } from './pitch';

/** These input choices belong to the device, independently of the account. */
export function readMicrophoneConfig(): MicrophoneConfig {
  return { deviceId: readPreference('chansonade.microphone') || '', echoCancellation: readPreference('chansonade.echo-cancellation') === 'true' };
}
export function writeMicrophoneConfig(config: MicrophoneConfig): void {
  writePreference('chansonade.microphone', config.deviceId);
  writePreference('chansonade.echo-cancellation', String(config.echoCancellation));
}

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

  acquire(owner: MicrophoneOwner, config: MicrophoneConfig, context?: AudioContext): Promise<boolean> {
    if (this.lease && this.input.state !== 'idle') return this.lease.ready;
    const started = this.input.start(config, context);
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
