import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import ts from 'typescript';

// Use the project's TypeScript compiler; no test runner or Node TS loader.
const source = await readFile(new URL('../src/lib/loop.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { alignNoteTimings, measuresInLoop, canonicalLoopBounds } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const toolkit = new VerovioToolkit(await createVerovioModule());
toolkit.setOptions({ xmlIdChecksum: true });
assert.ok(toolkit.loadData(await readFile(new URL('../public/scores/une-souris-verte-chant-piano.musicxml', import.meta.url), 'utf8')));
const events = toolkit.renderToTimemap({ includeMeasures: true, includeRests: true });
const notes = {};
for (const event of events) for (const id of event.on || []) notes[id] = toolkit.getMIDIValuesForElement(id);
const measures = events.filter((event) => event.measureOn).map((event) => ({ id: event.measureOn, time: event.tstamp / 1000 }));
const duration = events.at(-1).tstamp / 1000;
const ids = (selected) => selected.map((measure) => measure.id);

// Regression: the third bar really starts at 3077 ms in the public score,
// while its MIDI note lookup returns 3076 ms. The old comparison included bar 2.
const third = events.filter((event) => event.measureOn)[2];
const firstId = third.on[0];
const rawStart = notes[firstId].time / 1000;
assert.equal(third.tstamp, 3077);
assert.equal(notes[firstId].time, 3076);
assert.ok(measures[2].time > rawStart);
const oldSelection = measures.filter((measure, index) => measure.time < measures[3].time && (measures[index + 1]?.time ?? duration) > rawStart);
assert.deepEqual(ids(oldSelection), ids(measures.slice(1, 3)));

const legacyLoopTimes = alignNoteTimings(notes, events);
for (const event of events) {
  for (const id of event.on || []) assert.equal(notes[id].time, event.tstamp, `onset ${id}`);
  for (const id of event.off || []) assert.equal(notes[id].time + notes[id].duration, event.tstamp, `release ${id}`);
}
assert.deepEqual(ids(measuresInLoop(measures, notes[firstId].time / 1000, measures[3].time, duration)), [measures[2].id]);
const restored = canonicalLoopBounds(rawStart, measures[3].time, legacyLoopTimes);
assert.equal(restored.start, 3.077);
assert.deepEqual(ids(measuresInLoop(measures, restored.start, restored.end, duration)), [measures[2].id]);
assert.deepEqual(canonicalLoopBounds(.123456, null, legacyLoopTimes), { start: .123456, end: null });
for (const event of events) {
  const canonical = event.tstamp / 1000;
  assert.deepEqual(canonicalLoopBounds(canonical, canonical, legacyLoopTimes), { start: canonical, end: canonical }, 'canonical boundaries must not migrate twice');
}
assert.deepEqual(canonicalLoopBounds(1, 2, [{ from: 1, to: 1.001 }, { from: 1, to: 1.002 }]), { start: 1, end: 2 }, 'ambiguous legacy mappings must stay untouched');
const collision = { a: { time: 1000, duration: 1000 }, b: { time: 1001, duration: 999 } };
const collisionMapping = alignNoteTimings(collision, [{ tstamp: 1001, on: ['a'] }, { tstamp: 1002, on: ['b'] }, { tstamp: 2000, off: ['a', 'b'] }]);
assert.ok(!collisionMapping.some((entry) => entry.from === 1.001), 'an old time matching a canonical onset must remain canonical');
const ambiguous = { a: { time: 1000, duration: 1000 }, b: { time: 1000, duration: 1000 } };
const ambiguousMapping = alignNoteTimings(ambiguous, [{ tstamp: 1001, on: ['a'] }, { tstamp: 1002, on: ['b'] }, { tstamp: 2000, off: ['a', 'b'] }]);
assert.ok(!ambiguousMapping.some((entry) => entry.from === 1), 'ambiguous source note times must not get a migration');

// Every exact full-bar range includes its own bar, never a neighbouring one.
for (let index = 0; index < measures.length; index++) {
  const start = measures[index].time, end = measures[index + 1]?.time ?? duration;
  assert.deepEqual(ids(measuresInLoop(measures, start, end, duration)), [measures[index].id]);
  assert.deepEqual(ids(measuresInLoop(measures, start - 1e-15, end + 1e-15, duration)), [measures[index].id]);
}
assert.deepEqual(measuresInLoop(measures, null, 1, duration), []);
assert.deepEqual(measuresInLoop(measures, 1, 1, duration), []);
assert.deepEqual(measuresInLoop(measures, 2, 1, duration), []);
assert.deepEqual(measuresInLoop(measures, NaN, 1, duration), []);

// Selecting notes in either direction gives the same interval; a partial bar
// still highlights that bar, and crossing a line cannot change the time range.
const noteIds = events.filter((event) => event.measureOn).map((event) => event.on[0]);
const select = (first, last) => {
  const start = Math.min(first.time, last.time) / 1000;
  const end = Math.max(first.time + first.duration, last.time + last.duration, Math.min(first.time, last.time) + 120) / 1000;
  return ids(measuresInLoop(measures, start, end, duration));
};
assert.deepEqual(select(notes[noteIds[2]], notes[noteIds[2]]), [measures[2].id]);
assert.deepEqual(select(notes[noteIds[2]], notes[noteIds[5]]), ids(measures.slice(2, 6)));
assert.deepEqual(select(notes[noteIds[5]], notes[noteIds[2]]), ids(measures.slice(2, 6)));

// A real submillisecond overlap remains visible: the epsilon is not an
// arbitrary one-frame/one-millisecond expansion of the selected passage.
assert.deepEqual(ids(measuresInLoop(measures, measures[2].time - .00001, measures[3].time, duration)), ids(measures.slice(1, 3)));
console.log(`Loop ranges: ${measures.length} exact bars, canonical note on/off times, reversed note selection legacy boundary migration and boundary regressions passed.`);
