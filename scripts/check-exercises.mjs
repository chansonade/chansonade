// Same isolated Vite/CDP runner as the other client checks; no application data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { BasicMIDI, SpessaLog } from 'spessasynth_core';
import { chromium } from 'playwright';

const moduleURL = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const preferencesURL = moduleURL(await readFile(new URL('../src/lib/preferences.ts', import.meta.url), 'utf8'));
const configURL = moduleURL(await readFile(new URL('../src/lib/pitch-config.ts', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/lib/exercises.ts', import.meta.url), 'utf8');
const e = await import(moduleURL(source.replace("'./preferences'", JSON.stringify(preferencesURL)).replace("'./pitch-config'", JSON.stringify(configURL))));
const { EXERCISES, VOICE_RANGES, EXERCISE_PITCH_LIMITS, EXERCISE_TICKS_PER_BEAT: ticks,
  exerciseTonicBounds, normalizeExercisePreferences: normalize, stepExercise,
  createExercisePassage: passage, exerciseSecondsAt: secondsAt, exerciseMIDI: midi } = e;
SpessaLog.setLogLevel(false, true, false);
const defaults = { exerciseId: 'five-note', bpm: 80, step: 1, voice: null };
assert.deepEqual(normalize(null), defaults);
assert.throws(() => passage(defaults, 'listen'), /Choisissez une étendue/);
assert.equal(EXERCISES.length, 7); assert.equal(VOICE_RANGES.length, 6);
assert.deepEqual(EXERCISE_PITCH_LIMITS, { low: 33, high: 93 });
assert.deepEqual(VOICE_RANGES.map(({ low, high }) => [low, high]), [[60,84], [57,81], [53,76], [48,72], [43,67], [40,64]]);
for (const invalid of [undefined, null, true, [], 'wrong', 42]) assert.deepEqual(normalize(invalid), defaults);
for (const bpm of [0, -1, 39, 161, 80.5, Infinity, NaN, '80']) {
  assert.equal(normalize({ bpm }).bpm, 80);
  assert.throws(() => passage({ ...defaults, bpm }, 'listen'), /invalides/);
}
assert.deepEqual(normalize({ exerciseId: 'unknown', step: 7, voice: { low: 50, high: 49 } }), defaults);
for (const voice of [{low:32,high:84}, {low:40,high:94}, {low:40.5,high:84}, {low:'40',high:84}, {low:40,high:Infinity}, []]) assert.equal(normalize({ voice }).voice, null);
assert.deepEqual(normalize({ voice: { low: 48, high: 72, tonic: 999 } }).voice, { low: 48, high: 72, tonic: 65 });
assert.deepEqual(normalize({ voice: { low: 48, high: 72 } }).voice, { low: 48, high: 72, tonic: 48 });
const narrow = normalize({ exerciseId: 'octave', voice: { low: 60, high: 65, tonic: 60 } });
assert.deepEqual(narrow.voice, { low: 60, high: 65, tonic: 60 });
assert.equal(exerciseTonicBounds('octave', narrow.voice), null);
assert.throws(() => passage(narrow, 'guide'), /dépasse votre étendue/);
assert.equal(stepExercise(narrow, 1), null);
assert.equal(stepExercise(defaults, 1), null);

const base = normalize({ voice: { low: 48, high: 72, tonic: 60 } });
const five = passage(base, 'guide');
assert.deepEqual(five.notes.filter(n => n.role === 'voice').map(n => n.midi), [60,62,64,65,67,65,64,62,60]);
assert.deepEqual(five.notes.filter(n => n.role === 'voice').map(n => n.syllable), ['mi','me','ma','mo','mu','mo','ma','me','mi']);
assert.deepEqual(five.notes.filter(n => n.role === 'cue').map(n => [n.midi, n.startTick, n.endTick]), [[48,0,ticks], [52,0,ticks], [55,0,ticks]]);
assert.equal(five.notes[3].startTick, 2 * ticks, 'One-beat chord followed by one silent beat');
assert.equal(five.durationTicks, 12 * ticks);
assert.equal(secondsAt(five, ticks), 0.75);
assert.equal(secondsAt(five, five.durationTicks), 9);
const immutable = structuredClone(base); Object.freeze(immutable.voice); Object.freeze(immutable);
assert.deepEqual(passage(immutable, 'guide'), five);
const mutable = structuredClone(base), snapshot = passage(mutable, 'guide');
mutable.voice.tonic = 72; mutable.bpm = 160;
assert.deepEqual(snapshot, five, 'A passage owns its musical context');
assert.notEqual(normalize(null), normalize(null), 'Defaults are not a shared mutable preference');
assert.equal(stepExercise(base, 1).voice.tonic, 61);
assert.equal(stepExercise({ ...base, step: 2 }, -1).voice.tonic, 58, 'Step means semitones, not scale degrees');
assert.deepEqual(base.voice, { low: 48, high: 72, tonic: 60 });
assert.equal(stepExercise({ ...base, voice: { ...base.voice, tonic: 65 } }, 1), null);
assert.equal(stepExercise({ ...base, step: 2, voice: { ...base.voice, tonic: 64 } }, 1), null, 'Do not clamp a two-semitone step to a one-semitone step');
assert.equal(stepExercise({ ...base, voice: { ...base.voice, tonic: 48 } }, -1), null);
assert.throws(() => passage(base, 'unknown'), /invalides/);

let sequences = 0;
for (const exercise of EXERCISES) {
  for (const range of [...VOICE_RANGES, { low: 33, high: 93 }, { low: 60, high: 60 }]) {
    const bounds = exerciseTonicBounds(exercise.id, range);
    if (!bounds) continue;
    for (const tonic of [bounds.low, bounds.high]) {
      const config = normalize({ exerciseId: exercise.id, voice: { ...range, tonic } });
      for (const note of passage(config, 'guide').notes.filter(n => n.role === 'voice')) assert(note.midi >= range.low && note.midi <= range.high);
      for (const forbidden of [bounds.low - 1, bounds.high + 1]) assert.throws(() => passage({ ...config, voice: { ...range, tonic: forbidden } }, 'guide'), /dépasse votre étendue/);
    }
  }
  for (const bpm of [40, 83, 160]) {
    const config = { ...base, exerciseId: exercise.id, bpm };
    const guide = passage(config, 'guide'), listen = passage(config, 'listen'), solo = passage(config, 'solo');
    assert.deepEqual(listen.notes, guide.notes); assert.deepEqual(solo.notes, guide.notes);
    assert.deepEqual(midi(listen), midi(guide));
    assert.deepEqual(midi({ ...guide }), midi(guide), 'MIDI compilation is deterministic');
    const before = JSON.stringify(guide);
    for (const plan of [guide, solo]) {
      const file = midi(plan), parsed = BasicMIDI.fromArrayBuffer(file);
      assert.equal(parsed.timeDivision, ticks); assert.equal(parsed.tracks.length, 1);
      assert(Math.abs(parsed.duration - secondsAt(plan, plan.durationTicks)) < 1e-9, 'Spessa keeps the full silent window, not just the chord');
      const events = parsed.tracks[0].events;
      const expected = plan.notes.filter(n => plan.mode !== 'solo' || n.role === 'cue');
      const ons = events.filter(ev => (ev.statusByte & 0xf0) === 0x90);
      assert.equal(ons.length, expected.length);
      assert.equal(events.filter(ev => (ev.statusByte & 0xf0) === 0x80).length, expected.length);
      for (const note of expected) {
        const channel = note.role === 'cue' ? 0 : 1;
        assert(ons.some(ev => ev.ticks === note.startTick && ev.statusByte === 0x90 + channel && ev.data[0] === note.midi));
        assert(events.some(ev => ev.ticks === note.endTick && ev.statusByte === 0x80 + channel && ev.data[0] === note.midi), 'Every note has an explicit release');
        assert(Math.abs(parsed.midiTicksToSeconds(note.startTick) - secondsAt(plan, note.startTick)) < 1e-9);
      }
      assert(file.byteLength < 512, 'A bounded single-pattern sequence, no score or sound bank embedded');
      sequences++;
    }
    assert.equal(JSON.stringify(guide), before, 'Encoding does not mutate the display calendar');
  }
}
const staccato = passage({ ...base, exerciseId: 'staccato' }, 'guide');
assert.equal(staccato.notes[3].endTick - staccato.notes[3].startTick, ticks * 0.35);
const held = passage({ ...base, exerciseId: 'sustained' }, 'solo');
assert.equal(held.notes[3].endTick - held.notes[3].startTick, 8 * ticks);
console.log(`PASS exercises: seven motifs, six editable extents, complete range bounds, chromatic steps, snapshots and ${sequences} MIDI parses with matching clocks and silent solo windows`);

const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP);
const context = await browser.newContext({ serviceWorkers: 'block' });
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  await context.route('**/exercise-preferences-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic exercise preferences</title>' }));
  const page = await context.newPage();
  await page.goto(`${process.env.CHANSONADE_TEST_URL}/exercise-preferences-fixture`);
  await page.evaluate(async () => {
    const { readExercisePreferences: read, writeExercisePreferences: write, adoptAnonymousExercisePreferences: adopt, EXERCISES, VOICE_RANGES } = await import('/src/lib/exercises.ts');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const key = scope => `chansonade.exercises.${scope}`;
    const a = 'user:exercise-a', b = 'user:exercise-b';
    const guest = { exerciseId: 'arpeggio', bpm: 83, step: 2, voice: { low: 48, high: 72, tonic: 55 } };
    const own = { ...guest, bpm: 120 };
    check(read(a).voice === null && read(a).bpm === 80, 'No voice assumed at first use');
    localStorage.setItem('chansonade.language', 'de');
    localStorage.setItem('chansonade.practice.synthetic', 'untouched');
    write('anonymous', guest); adopt(a);
    check(JSON.stringify(read(a)) === JSON.stringify(read('anonymous')), 'Missing account adopts validated anonymous settings');
    write(a, own); adopt(a);
    check(read(a).bpm === 120 && read('anonymous').bpm === 83 && read(b).bpm === 80, 'Account isolation, no anonymous fallback on read');
    adopt(b); check(read(b).bpm === 83, 'Adoption never copies A into B');
    localStorage.setItem(key(b), '{broken'); adopt(b);
    check(localStorage.getItem(key(b)) === '{broken' && read(b).bpm === 80, 'Even damaged existing account preferences are not overwritten');
    localStorage.setItem(key(b), 'null'); adopt(b); check(localStorage.getItem(key(b)) === 'null', 'Present null is not an absent entry');
    localStorage.setItem(key(b), JSON.stringify({ exerciseId: 'invalid', bpm: 999, step: 5, voice: { low: 0, high: 200 } }));
    check(read(b).bpm === 80 && read(b).exerciseId === 'five-note' && read(b).voice === null, 'Untrusted stored values recover to defaults');
    write(b, { ...guest, bpm: NaN }); check(read(b).bpm === 80, 'Writes also normalize their input');
    const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function(k) { if (k === key(a)) throw new DOMException('Synthetic denied read', 'SecurityError'); return originalGet.call(this, k); };
    adopt(a); check(originalGet.call(localStorage, key(a)).includes('120'), 'Refused destination read must not overwrite an existing account');
    check(read(a).bpm === 80, 'Read refusal gives defaults'); Storage.prototype.getItem = originalGet;
    Storage.prototype.setItem = () => { throw new DOMException('Synthetic denied write', 'QuotaExceededError'); };
    write(a, guest); adopt('user:no-write');
    Storage.prototype.setItem = originalSet;
    check(read(a).bpm === 120 && localStorage.getItem(key('user:no-write')) === null, 'Refused writes preserve stored data and anonymous source');
    localStorage.setItem(key('anonymous'), '{broken'); adopt('user:bad-source');
    check(localStorage.getItem(key('user:bad-source')) === null, 'Malformed anonymous JSON is not adopted');
    write('anonymous', guest);
    const { setLanguage, translate } = await import('/src/lib/i18n.ts');
    const { componentMessages } = await import('/src/lib/messages-components.ts');
    const errorKeys = ['Réglages d’exercice invalides.', 'Choisissez une étendue vocale pour commencer.', 'Ce motif dépasse votre étendue vocale.'];
    for (const language of ['en', 'de', 'nl']) {
      setLanguage(language);
      for (const { nameKey } of [...EXERCISES, ...VOICE_RANGES]) check(Object.hasOwn(componentMessages[language], nameKey), `${language}: missing label ${nameKey}`);
      for (const key of errorKeys) check(translate(key) !== key, `${language}: missing exercise error`);
    }
    check(localStorage.getItem('chansonade.practice.synthetic') === 'untouched', 'Exercise settings do not touch score practice');
    const ownStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Synthetic denied getter', 'SecurityError'); } });
    check(read(a).bpm === 80 && read(a).voice === null, 'Denied getter gives defaults');
    write(a, guest); adopt(a);
    Object.defineProperty(window, 'localStorage', ownStorage);
    check(read(a).bpm === 120, 'Getter refusal has no persistence side effects');
  });
  await page.reload();
  assert.equal(await page.evaluate(async () => (await import('/src/lib/exercises.ts')).readExercisePreferences('user:exercise-a').bpm), 120, 'Preferences survive a real page reload');
  assert.deepEqual(errors, []);
  console.log('PASS exercise preferences: scoped persistence/reload, explicit anonymous adoption, malformed values, denied getter/read/write, existing-entry protection and translated metadata');
} finally { await context.close(); await browser.close(); }
