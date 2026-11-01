import { PITCH_CONFIG, type PitchConfig } from './pitch-config';
import type { PitchObservation } from './pitch-detector';

export interface TrackedPitch {
  time: number;
  frequency: number;
  /** Most probable acoustic candidate before temporal decoding. */
  rawFrequency: number;
  /** Acoustic probability, intentionally distinct from the decoded voiced state. */
  voicedProbability: number;
  rms: number;
}
interface HistoryFrame {
  observation: PitchObservation;
  parents: Uint16Array;
}

/**
 * One fixed-lag path decoder chooses among the measured YIN candidates.
 * As in pYIN, every pitch has a voiced and an unvoiced state, retaining pitch
 * context across brief consonants. The log-frequency transition prior is a
 * normalized Laplace distribution: changes are penalized softly, never banned.
 * This finite cost permits genuine large note changes without an octave rule.
 * Five future observations resolve short ambiguities; committed output is final.
 * No median, pitch correction, score input, or filling of unvoiced frames.
 */
export class PitchTracker {
  private readonly bins: number;
  private readonly states: number;
  private readonly normalizationLog: Float64Array;
  private readonly stepCost: number;
  private readonly sameLog: number;
  private readonly switchLog: number;
  private previous: Float64Array;
  private scores: Float64Array;
  private readonly emission: Float64Array;
  private readonly voicedPrediction: Float64Array;
  private readonly unvoicedPrediction: Float64Array;
  private readonly voicedParents: Uint16Array;
  private readonly unvoicedParents: Uint16Array;
  private readonly history: HistoryFrame[] = [];
  private best = 0;

  constructor(private readonly config: PitchConfig = PITCH_CONFIG) {
    this.bins = Math.floor(12 * Math.log2(config.maxHz / config.minHz) * config.binsPerSemitone) + 1;
    this.states = 2 * this.bins;
    // Scale = expected absolute octave displacement in one analysis hop.
    const scaleBins = config.pitchTransitionOctavesPerSecond / config.hopHz * 12 * config.binsPerSemitone;
    this.stepCost = 1 / scaleBins;
    this.normalizationLog = new Float64Array(this.bins);
    for (let source = 0; source < this.bins; source++) {
      let sum = 0;
      for (let target = 0; target < this.bins; target++) sum += Math.exp(-Math.abs(source - target) * this.stepCost);
      this.normalizationLog[source] = Math.log(sum);
    }
    this.sameLog = Math.log(1 - config.switchProbability);
    this.switchLog = Math.log(config.switchProbability);
    this.previous = new Float64Array(this.states);
    this.scores = new Float64Array(this.states);
    this.emission = new Float64Array(this.bins);
    this.voicedPrediction = new Float64Array(this.bins);
    this.unvoicedPrediction = new Float64Array(this.bins);
    this.voicedParents = new Uint16Array(this.bins);
    this.unvoicedParents = new Uint16Array(this.bins);
    this.reset();
  }

  reset(): void {
    this.previous.fill(-Math.log(this.states));
    this.history.length = 0;
    this.best = 0;
  }

  /**
   * max_i(previous[i] - log(normalizer[i]) - |i-j|/scale) has a left and
   * a right recurrence. Two linear passes exactly replace the dense N² search.
   */
  private predict(offset: number, result: Float64Array, parents: Uint16Array): void {
    let best = -Infinity, parent = offset;
    for (let target = 0; target < this.bins; target++) {
      const direct = this.previous[target + offset] - this.normalizationLog[target];
      if (direct > best - this.stepCost) { best = direct; parent = target + offset; }
      else best -= this.stepCost;
      result[target] = best;
      parents[target] = parent;
    }
    best = -Infinity;
    parent = offset + this.bins - 1;
    for (let target = this.bins - 1; target >= 0; target--) {
      const direct = this.previous[target + offset] - this.normalizationLog[target];
      if (direct >= best - this.stepCost) { best = direct; parent = target + offset; }
      else best -= this.stepCost;
      if (best > result[target]) { result[target] = best; parents[target] = parent; }
    }
  }

  push(observation: PitchObservation): TrackedPitch | null {
    this.emission.fill(0);
    for (const candidate of observation.candidates) this.emission[candidate.bin] += candidate.probability;
    this.predict(0, this.voicedPrediction, this.voicedParents);
    this.predict(this.bins, this.unvoicedPrediction, this.unvoicedParents);
    const unvoicedEmission = Math.log(Math.max(1e-15, (1 - observation.voicedProbability) / this.bins));
    const parents = new Uint16Array(this.states);
    for (let target = 0; target < this.bins; target++) {
      const stayVoiced = this.voicedPrediction[target] + this.sameLog;
      const becomeVoiced = this.unvoicedPrediction[target] + this.switchLog;
      const stayUnvoiced = this.unvoicedPrediction[target] + this.sameLog;
      const becomeUnvoiced = this.voicedPrediction[target] + this.switchLog;
      this.scores[target] = Math.max(stayVoiced, becomeVoiced) + Math.log(this.emission[target]);
      this.scores[target + this.bins] = Math.max(stayUnvoiced, becomeUnvoiced) + unvoicedEmission;
      parents[target] = stayVoiced >= becomeVoiced ? this.voicedParents[target] : this.unvoicedParents[target];
      parents[target + this.bins] = becomeUnvoiced >= stayUnvoiced ? this.voicedParents[target] : this.unvoicedParents[target];
    }
    this.best = 0;
    for (let state = 1; state < this.states; state++) if (this.scores[state] > this.scores[this.best]) this.best = state;
    const maximum = this.scores[this.best];
    for (let state = 0; state < this.states; state++) this.scores[state] -= maximum;
    [this.previous, this.scores] = [this.scores, this.previous];
    this.history.push({ observation, parents });
    if (this.history.length <= this.config.lookaheadFrames) return null;
    let state = this.best;
    for (let index = this.history.length - 1; index > 0; index--) state = this.history[index].parents[state];
    // Future paths must agree with all displayed frames. Without this commit,
    // successive tracebacks can revise the past and emit inconsistent jumps.
    for (let terminal = 0; terminal < this.states; terminal++) {
      if (this.previous[terminal] === -Infinity) continue;
      let ancestor = terminal;
      for (let index = this.history.length - 1; index > 0; index--) ancestor = this.history[index].parents[ancestor];
      if (ancestor !== state) this.previous[terminal] = -Infinity;
    }
    return this.result(this.history.shift()!.observation, state);
  }

  /** Current frontier of the same best path. It may still change before commit. */
  pending(): TrackedPitch[] {
    const result = new Array<TrackedPitch>(this.history.length);
    let state = this.best;
    for (let index = this.history.length - 1; index >= 0; index--) {
      result[index] = this.result(this.history[index].observation, state);
      state = this.history[index].parents[state];
    }
    return result;
  }

  /** Drain the measured tail when capture stops; no fabricated future audio. */
  flush(): TrackedPitch[] {
    const result = this.pending();
    this.reset();
    return result;
  }

  private result(observation: PitchObservation, state: number): TrackedPitch {
    let selected: typeof observation.candidates[number] | undefined;
    let raw: typeof selected;
    for (const candidate of observation.candidates) {
      if (!raw || candidate.probability > raw.probability) raw = candidate;
      if (state < this.bins && candidate.bin === state && (!selected || candidate.probability > selected.probability)) selected = candidate;
    }
    return { time: observation.time, rms: observation.rms, voicedProbability: observation.voicedProbability, rawFrequency: raw?.frequency || 0, frequency: selected?.frequency || 0 };
  }
}
