/** Shared analysis settings; importing them does not load the FFT implementation. */
export const PITCH_CONFIG = Object.freeze({
  name: 'Probabilistic YIN + fixed-lag tracker',
  windowMs: 85,
  hopHz: 35,
  minHz: 55,
  maxHz: 1800,
  minRms: 0.005,
  binsPerSemitone: 5,
  lookaheadFrames: 5,
  pitchTransitionOctavesPerSecond: 3.5,
  switchProbability: 0.01,
  thresholds: 100,
  betaAlpha: 2,
  betaBeta: 18,
  boltzmannParameter: 2,
  noTroughProbability: 0.01,
  mainsNotchHz: 50,
  mainsNotchQ: 20,
});

export type PitchConfig = typeof PITCH_CONFIG;
