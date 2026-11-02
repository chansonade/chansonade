import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/audio/capture-worklet.js', import.meta.url), 'utf8');
function run(rate, limitOverride) {
  let Processor, chunkSamples = 0, stopped, sentAfterStop = 0;
  class AudioWorkletProcessor {
    port = { onmessage: null, postMessage(message) {
      if (message.type === 'recording-chunk') { chunkSamples += message.samples.length; if (stopped) sentAfterStop++; }
      if (message.type === 'recording-stopped') stopped = message;
    } };
  }
  const scope = { AudioWorkletProcessor, Float32Array, Math, sampleRate: rate, currentFrame: 0, registerProcessor(_name, processor) { Processor = processor; } };
  vm.runInNewContext(source, scope);
  const processor = new Processor({ processorOptions: { windowSize: 128, hopSize: 100000000, ...(limitOverride ? { maxRecordingSamples: limitOverride } : {}) } });
  const channel = new Float32Array(128).fill(0.25), inputs = [[channel], [channel]], outputs = [[new Float32Array(128)]];
  processor.port.onmessage({ data: { type: 'recording-start', id: 1 } });
  const expected = limitOverride || Math.min(rate * 600, Math.floor((64 * 1024 * 1024 - 45) / 2));
  while (!stopped && scope.currentFrame < expected + 256) { processor.process(inputs, outputs); scope.currentFrame += 128; }
  assert.ok(stopped, 'worklet must stop itself');
  assert.equal(stopped.reason, 'limit');
  assert.equal(stopped.samples, expected);
  assert.equal(chunkSamples, expected);
  assert.ok(44 + stopped.samples * 2 < 64 * 1024 * 1024);
  assert.ok(stopped.duration <= 600);
  for (let i = 0; i < 4; i++) { processor.process(inputs, outputs); scope.currentFrame += 128; }
  assert.equal(chunkSamples, expected);
  assert.equal(sentAfterStop, 0);
  return stopped;
}
for (const rate of [48000, 96000]) {
  const result = run(rate);
  console.log(`${rate} Hz: ${result.samples} samples, ${result.duration.toFixed(3)} s`);
}
assert.equal(run(48000, 137).samples, 137);
console.log('Sample limit and stop inside audio block: OK');

// Exercise the main-thread stop race with a deterministic clock: a late
// worklet acknowledgement must not let the old stop timer discard the WAV
// while the independent decoder flush is still waiting.
const ts = await import('typescript');
const pitchSource = (await readFile(new URL('../src/lib/pitch.ts', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env.BASE_URL', "'/'").replaceAll('import.meta.url', "'http://localhost/'");
const compiled = ts.transpileModule(pitchSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let now = 0, nextTimer = 1;
const timers = new Map();
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  now = end;
}
const vmExports = {};
const imports = {
  './wav': { microphoneWav: chunks => ({ samples: chunks.reduce((count, chunk) => count + chunk.length, 0) }) },
  './pitch-config': { PITCH_CONFIG: {} },
  './recording-limits': { recordingMaxSamples: () => 100 },
};
vm.runInNewContext(compiled, {
  exports: vmExports, require: name => imports[name], Float32Array, Promise, Error, Number, Math, Map, WeakMap,
  setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
  clearTimeout: id => timers.delete(id),
});
async function inputWithRecording(onEnd = () => {}) {
  const input = new vmExports.PitchInput(() => {}, () => {}, onEnd);
  input.running = true;
  input.context = { sampleRate: 48000, state: 'running', resume: async () => {} };
  input.capture = { port: { postMessage() {} } };
  input.worker = { postMessage() {} };
  const started = input.startRecording();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  input.handleRecording({ type: 'recording-started', id: 1, startedAt: 1, sampleRate: 48000 });
  await started;
  return input;
}
let input = await inputWithRecording();
let output, failure;
const ending = input.stopRecording().then(value => { output = value; }, error => { failure = error; });
for (let i = 0; i < 5; i++) await Promise.resolve();
advance(1500);
input.handleRecording({ type: 'recording-chunk', id: 1, samples: new Float32Array([0.1, 0.2, 0.3]) });
input.handleRecording({ type: 'recording-stopped', id: 1, samples: 3, reason: 'manual', startedAt: 1, sampleRate: 48000, duration: 3 / 48000 });
advance(3500);
await Promise.resolve();
assert.equal(output, undefined); assert.equal(failure, undefined);
advance(500);
await ending;
assert.equal(output.samples, 3); assert.equal(output.audio.samples, 3); assert.equal(output.analysisComplete, false);
let reasons = [];
input = await inputWithRecording(reason => reasons.push(reason));
input.handleRecording({ type: 'recording-chunk', id: 1, samples: new Float32Array([0.1, 0.2]) });
input.interruptCapture(false);
const partial = await input.stopRecording();
assert.equal(partial.samples, 2); assert.equal(partial.analysisComplete, false); assert.equal(input.active, false);
assert.deepEqual(reasons, ['interrupted']);
reasons = [];
input = await inputWithRecording(reason => reasons.push(reason));
input.handleRecording({ type: 'recording-chunk', id: 1, samples: new Float32Array([0.1]) });
input.handleRecording({ type: 'recording-stopped', id: 1, samples: 1, reason: 'limit', startedAt: 1, sampleRate: 48000, duration: 1 / 48000 });
advance(4000);
assert.equal((await input.stopRecording()).samples, 1);
assert.deepEqual(reasons, ['limit']);
console.log('Delayed stop acknowledgement, decoder timeout and interrupted capture: OK');

// JSON budgeting counts escaped UTF-8, including non-ASCII score text and
// delimiters, before allowing a pitch or transport event into the take.
const takeSource = await readFile(new URL('../src/lib/take-session.ts', import.meta.url), 'utf8');
const takeCode = ts.transpileModule(takeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const takeExports = {};
const takeImports = { fflate: {}, './pitch-config': { PITCH_CONFIG: {} }, './storage': {} };
vm.runInNewContext(takeCode, { exports: takeExports, require: name => takeImports[name], TextEncoder, JSON });
const captured = { scope: 'anonymous', folderId: null, startedAt: 1, createdAt: 1, scoreId: 'x', title: '"🎵é', scoreXML: '<score>é🎼"\\</score>', settings: { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] }, latencyMs: 0, pitches: [], transport: [] };
const baseline = new takeExports.TakeMetadataBudget(captured).used;
const point = { time: 1, frequency: 440, rawFrequency: 440, clarity: .9, rms: .1, midi: 69, cents: 0, scoreTime: 1, expectedPitch: null, noteId: '🎵', targetChannel: 0, playing: true };
const pointBytes = new TextEncoder().encode(JSON.stringify(point)).length + 1;
const budget = new takeExports.TakeMetadataBudget(captured, baseline + 2 * pointBytes);
assert.equal(budget.fits, true); assert.equal(budget.append(point), true); assert.equal(budget.append(point), true); assert.equal(budget.append(point), false);
assert.equal(new takeExports.TakeMetadataBudget(captured, baseline - 1).fits, false);
assert.equal(new takeExports.TakeMetadataBudget({ ...captured, scoreXML: captured.scoreXML + '🎵' }).used - baseline, 4);
console.log('UTF-8 metadata budget, exact boundary and oversized preflight: OK');
