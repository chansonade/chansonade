/**
 * Probabilistic YIN frame observations. Threshold probabilities and candidate
 * priors are adapted from librosa 1.0.0 (core/pitch.py). The finite-window
 * difference is computed exactly (type II), subtracting both end energies.
 * https://github.com/librosa/librosa/blob/1.0.0/librosa/core/pitch.py
 * Mauch & Dixon, ICASSP 2014: https://doi.org/10.1109/ICASSP.2014.6853678
 *
 * Copyright (c) 2013--2026, librosa development team.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import { Autocorrelator } from 'pitchy';

import { PITCH_CONFIG, type PitchConfig } from './pitch-config';
export { PITCH_CONFIG, type PitchConfig } from './pitch-config';

export interface PitchCandidate {
  /** Measured frequency after sub-sample period interpolation, never a note grid. */
  frequency: number;
  probability: number;
  /** Quantized state used only for tracking, not for the displayed frequency. */
  bin: number;
}
export interface PitchObservation {
  time: number;
  rms: number;
  /** Acoustic voiced probability before temporal decoding, not a posterior. */
  voicedProbability: number;
  candidates: PitchCandidate[];
}

/** Keep the competing periodicities until temporal decoding can distinguish them. */
export class VoicePitchDetector {
  private readonly autocorrelator: Autocorrelator<Float32Array>;
  private readonly samples: Float32Array;
  private readonly correlation: Float32Array;
  private readonly difference: Float64Array;
  private readonly thresholdMass: Float64Array;
  private readonly boltzmann: Float64Array;
  private readonly boltzmannSum: Float64Array;
  readonly bins: number;

  constructor(readonly inputLength: number, private readonly config: PitchConfig = PITCH_CONFIG) {
    this.autocorrelator = Autocorrelator.forFloat32Array(inputLength);
    this.samples = new Float32Array(inputLength);
    this.correlation = new Float32Array(inputLength);
    this.difference = new Float64Array(inputLength);
    this.bins = Math.floor(12 * Math.log2(config.maxHz / config.minHz) * config.binsPerSemitone) + 1;
    // The closed-form CDF for Beta(2, 18) avoids a special-functions dependency.
    // These are the published pYIN prior parameters, not recording-specific fits.
    const betaCDF = (x: number) => 1 - (1 - x) ** 18 * (1 + 18 * x);
    this.thresholdMass = Float64Array.from({ length: config.thresholds }, (_, index) =>
      betaCDF((index + 1) / config.thresholds) - betaCDF(index / config.thresholds));
    this.boltzmann = Float64Array.from({ length: inputLength }, (_, rank) => Math.exp(-config.boltzmannParameter * rank));
    this.boltzmannSum = new Float64Array(inputLength + 1);
    for (let rank = 0; rank < inputLength; rank++) this.boltzmannSum[rank + 1] = this.boltzmannSum[rank] + this.boltzmann[rank];
  }

  observe(input: Float32Array, sampleRate: number, time: number): PitchObservation {
    if (input.length !== this.inputLength) throw new Error('The pitch window length changed.');
    const { minHz, maxHz, minRms, binsPerSemitone, thresholds, noTroughProbability } = this.config;
    const minPeriod = Math.max(2, Math.floor(sampleRate / maxHz));
    const maxPeriod = Math.ceil(sampleRate / minHz);
    if (maxPeriod + 1 >= input.length || maxHz >= sampleRate / 2) throw new Error('The pitch window cannot cover the configured range.');
    let mean = 0;
    for (const value of input) mean += value;
    mean /= input.length;
    let energy = 0;
    for (let index = 0; index < input.length; index++) {
      const centered = input[index] - mean;
      this.samples[index] = centered;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / input.length);
    const observation: PitchObservation = { time, rms, voicedProbability: 0, candidates: [] };
    if (rms < minRms) return observation;

    this.autocorrelator.autocorrelate(this.samples, this.correlation);
    let prefixEnergy = 0, tailEnergy = 0, cumulativeDifference = 0;
    this.difference[0] = 0;
    for (let period = 1; period <= maxPeriod + 1; period++) {
      prefixEnergy += this.samples[period - 1] ** 2;
      tailEnergy += this.samples[input.length - period] ** 2;
      // Exact finite-window type-II difference:
      // sum(i < N-period) (x[i] - x[i+period])². Both end energies are
      // removed, so a truly periodic waveform has zero difference at its period.
      const difference = Math.max(0, 2 * (this.correlation[0] - this.correlation[period]) - prefixEnergy - tailEnergy);
      cumulativeDifference += difference;
      this.difference[period] = cumulativeDifference > 0 ? difference * period / cumulativeDifference : 1;
    }

    const depths: number[] = [];
    for (let period = minPeriod; period <= maxPeriod; period++) {
      const left = this.difference[period - 1], middle = this.difference[period], right = this.difference[period + 1];
      if (middle >= left || middle > right) continue;
      const curvature = left - 2 * middle + right;
      const shift = curvature ? 0.5 * (left - right) / curvature : 0;
      const interpolated = sampleRate / (period + (Math.abs(shift) < 1 ? shift : 0));
      // Less than 1.8 cents of parabolic interpolation error must not discard
      // an exact boundary tone and leave only its octave as an alternative.
      if (interpolated < minHz * 0.999 || interpolated > maxHz * 1.001) continue;
      const frequency = Math.max(minHz, Math.min(maxHz, interpolated));
      observation.candidates.push({ frequency, probability: 0, bin: Math.max(0, Math.min(this.bins - 1, Math.round(12 * Math.log2(frequency / minHz) * binsPerSemitone))) });
      depths.push(middle);
    }
    if (!depths.length) return observation;
    let minimum = 0;
    for (let index = 1; index < depths.length; index++) if (depths[index] < depths[minimum]) minimum = index;
    for (let threshold = 0; threshold < thresholds; threshold++) {
      const height = (threshold + 1) / thresholds;
      let count = 0;
      for (const depth of depths) if (depth < height) count++;
      if (!count) {
        observation.candidates[minimum].probability += this.thresholdMass[threshold] * noTroughProbability;
        continue;
      }
      const probability = this.thresholdMass[threshold] / this.boltzmannSum[count];
      let rank = 0;
      for (let index = 0; index < depths.length; index++) {
        if (depths[index] < height) observation.candidates[index].probability += probability * this.boltzmann[rank++];
      }
    }
    observation.voicedProbability = Math.min(1, observation.candidates.reduce((sum, candidate) => sum + candidate.probability, 0));
    return observation;
  }
}
