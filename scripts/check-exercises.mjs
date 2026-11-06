// Same isolated Vite/CDP runner as the other client checks; no application data.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
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
const contexts = [context];
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
    let notifications = 0;
    const unsubscribe = (await import('/src/lib/exercises.ts')).subscribeExercisePreferences(a, () => notifications++);
    write(a, own); check(notifications === 1, 'Successful local writes notify the active scope');
    write(b, guest); check(notifications === 1, 'Other scopes do not notify this view');
    window.dispatchEvent(new StorageEvent('storage', { key: key(a) }));
    check(notifications === 2, 'Native storage events notify the same preference subscription');
    unsubscribe(); write(a, own);
    check(notifications === 2, 'Unmounted subscriptions release both listeners');

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

  await page.evaluate(async () => {
    const { ExerciseSession } = await import('/src/lib/exercise-session.ts');
    const { MicrophoneSession } = await import('/src/lib/microphone.ts');
    const { createExercisePassage } = await import('/src/lib/exercises.ts');
    const check = (value, message) => { if (!value) throw Error(message); };
    let rejectInput, openings = 0;
    const denied = new Promise((_resolve, reject) => { rejectInput = reject; });
    const lease = new MicrophoneSession({ active: false, start() { openings++; return denied; }, stop() {} });
    const studio = lease.acquire('studio', undefined, ''), borrowed = lease.acquire('exercises', undefined, '');
    rejectInput(Error('Synthetic denied shared request'));
    const failures = await Promise.allSettled([studio, borrowed]);
    check(openings === 1 && failures.every(result => result.status === 'rejected'), 'One physical acquisition broadcasts its failure to all borrowers');
    const audioClock = { currentTime: 100 }, captureClock = { currentTime: 12 };
    const input = { context: captureClock, owner: 'studio', active: true,
      acquire: async () => true, release() {} };
    const audio = { context: audioClock, exerciseState: { phase: 'playing' }, prepareAuxiliary: async () => {}, stopAuxiliary() {},
      startExercise: async passage => ({ startedAt: audioClock.currentTime + .25, duration: passage.durationTicks / 480 * 60 / passage.bpm }) };
    const practice = new ExerciseSession(audio, input);
    const config = { exerciseId: 'sustained', bpm: 80, step: 1, voice: { low: 48, high: 72, tonic: 57 } };
    practice.enter();
    await practice.start(createExercisePassage(config, 'guide'), { deviceId: '', latencyMs: 120 });
    const result = (time, frequency) => ({ time, frequency, clarity: .9, rms: .1, midi: 69, cents: 0 });
    const captured = 100.25 - 88 + .12 + 1.6;
    check(practice.confirm(result(captured, 440)), 'Exercise capture is consumed before score projection');
    practice.confirm(result(captured + .05, 0));
    practice.preview([result(captured + .1, 440)]);
    check(practice.confirmed.length === 2 && practice.pending.length === 1, 'The frontier never enters confirmed history');
    check(Math.abs(practice.confirmed[0].time - 1.6) < 1e-9 && Math.abs(practice.confirmed[0].cents - 1200) < 1e-9,
      'Absolute octave error, paired clocks and compensation are preserved');
    const earliest = practice.confirmed[0].captureTime;
    for (let i = 7; i < 350; i++) practice.confirm(result(captured + i / 60, 440));
    check(practice.confirmed[0].captureTime === earliest && practice.confirmed.length > 300, 'Keep the entire passage without a sliding horizon');
    const fullCount = practice.confirmed.length;
    practice.confirm(result(captured + 100, 440));
    check(practice.confirmed.length === fullCount, 'Continued microphone input after the passage does not grow its history');
    audioClock.currentTime = 120; captureClock.currentTime = 32;
    config.voice.tonic = 59; config.bpm = 160;
    await practice.start(createExercisePassage(config, 'solo'), { deviceId: '', latencyMs: 120 });
    practice.confirm(result(captured, 440));
    check(practice.confirmed.length === 0, 'Old delayed results cannot enter the next key');
    practice.confirm(result(120.25 - 88 + .12 + 1, 440));
    check(practice.confirmed[0].expectedMidi === 59 && practice.state.passage.bpm === 160 && practice.state.passage.mode === 'solo', 'Frozen mode, tempo, key and expected note');
    audioClock.currentTime = 124; captureClock.currentTime = 36;
    practice.leave();
    check(practice.confirm(result(34, 440)), 'Delayed exercise results stay consumed after returning to the studio');
    check(!practice.confirm(result(37, 440)), 'New studio capture is routed back to the score');
    check(practice.preview([result(34, 440), result(37, 440)]).length === 1, 'Preview follows the identical capture ownership rule');
  });
  console.log('PASS exercise timeline: capture ownership, frozen contexts/clocks/compensation, late frames, full history, silence and independent provisional frontier');

  const fixtureXML = `<score-partwise version="4.0"><work><work-title>Synthetic exercise studio</work-title></work>
    <part-list><score-part id="P1"><part-name>Synthetic voice</part-name>
      <midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
    </score-part></part-list><part id="P1">${Array.from({ length: 12 }, (_, i) => `<measure number="${i + 1}">
      ${i ? '' : '<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="80"/></direction>'}
      <note><pitch><step>${['C','D','E','G'][i % 4]}</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>`).join('')}</part></score-partwise>`;
  const accountA = { id: 'exercise-ui-a', email: 'exercise-a@example.invalid' };
  const accountB = { id: 'exercise-ui-b', email: 'exercise-b@example.invalid' };
  const url = process.env.CHANSONADE_TEST_URL;
  const ui = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1280, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
  contexts.push(ui);
  ui.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const syntheticMicrophone = () => {
    if (location.origin === 'null') return;
    window.__micOpens = 0; window.__micStops = 0; window.__micFrequency = 220;
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__denyMic) throw new DOMException('Synthetic microphone permission denied', 'NotAllowedError');
      const audio = new AudioContext(), destination = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      await audio.resume(); oscillator.frequency.value = window.__micFrequency; gain.gain.value = .15;
      oscillator.connect(gain).connect(destination); oscillator.start();
      window.__signal = { context: audio, frequency: oscillator.frequency, gain: gain.gain };
      window.__micOpens++;
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      let stopped = false;
      track.stop = () => { if (stopped) return; stopped = true; window.__micStops++; stop(); oscillator.stop(); void audio.close(); };
      if (window.__holdMic) await new Promise(resolve => { window.__releaseMic = resolve; });
      return destination.stream;
    };
  };
  await ui.addInitScript(syntheticMicrophone);
  await ui.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('chansonade.language', 'fr'); });
  let sessionUser = null;
  await ui.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.split('/api/v1/')[1];
    if (path === 'session') {
      if (request.method() === 'POST') sessionUser = request.postDataJSON().email === accountB.email ? accountB : accountA;
      if (request.method() === 'DELETE') sessionUser = null;
      return route.fulfill({ json: { user: sessionUser, registration: 'open' } });
    }
    // Keep all data local: no external API or production credentials.
    return route.fulfill({ status: 503, json: { message: 'Synthetic unavailable service' } });
  });
  await ui.route('**/scores/*.musicxml', route => route.fulfill({ contentType: 'application/xml', body: fixtureXML }));
  const fixturePath = '/exercise-view-fixture';
  await ui.route(url + fixturePath, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="app"></div>
    <script type="module">
      import { AudioPlayer } from '/src/lib/audio.ts';
      import { PitchInput } from '/src/lib/pitch.ts';
      import { ExerciseSession } from '/src/lib/exercise-session.ts';
      import { scoreId, writeSettings, readSettings } from '/src/lib/storage.ts';
      const id = await scoreId(${JSON.stringify(fixtureXML)});
      if (!await readSettings(id, 'anonymous')) await writeSettings(id, {
        rate: .8, loopEnabled: true, loopA: 1.5, loopB: 9, target: 0,
        parts: [{channel: 0, program: 73, volume: 35, transpose: 2, muted: false, solo: true}]
      }, 'anonymous');
      window.__exerciseStarts = [];
      window.__inputs = new Set();
      const inputStart = PitchInput.prototype.start, sessionStart = ExerciseSession.prototype.start;
      PitchInput.prototype.start = function (...args) { window.__inputs.add(this); window.__exerciseInput = this; return inputStart.apply(this, args); };
      ExerciseSession.prototype.start = function (...args) { window.__exerciseSession = this; return sessionStart.apply(this, args); };
      const load = AudioPlayer.prototype.load, start = AudioPlayer.prototype.startExercise;
      AudioPlayer.prototype.load = function (...args) { window.__exerciseAudio = this; return load.apply(this, args); };
      AudioPlayer.prototype.startExercise = function (passage) {
        window.__exerciseStarts.push({ mode: passage.mode, tonic: passage.tonic, bpm: passage.bpm });
        return start.call(this, passage);
      };
      await import('/src/main.ts');
    </script>` }));
  const exercisePage = await ui.newPage();
  await exercisePage.goto(url + fixturePath);
  const studioReady = () => exercisePage.waitForFunction(() => document.querySelector('.transport .play-button')?.disabled === false);
  await studioReady();
  const chooseExercises = () => exercisePage.getByRole('button', { name: 'Exercices', exact: true }).click();
  const panel = exercisePage.locator('.exercise-view');
  const studioSnapshot = () => exercisePage.evaluate(async () => {
    const a = window.__exerciseAudio;
    return { time: a.time, playing: a.playing, rate: a.sequencer.playbackRate,
      channels: a.synth.midiChannels.map(c => ({ ...c.systemParameters, patch: { ...c.patch } })), loop: a.loop };
  });
  // The snapshot is taken directly from the engine; avoid depending on the engraving IDs.
  const geometryBefore = await exercisePage.locator('.score-viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
  await exercisePage.getByRole('button', { name: 'Lire', exact: true }).click();
  await chooseExercises();
  assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.playing), true, 'Entering Exercises alone must not pause the studio');
  await panel.getByText('Choisissez une tessiture pour commencer, puis adaptez les notes basse et haute à votre voix.', { exact: true }).waitFor();
  assert(await panel.getByRole('button', { name: 'Écouter', exact: true }).isDisabled());
  await panel.getByLabel('Tessiture indicative').selectOption('3');
  await panel.getByLabel('Motif', { exact: true }).selectOption('hum');
  await panel.getByLabel('Tempo des exercices (BPM)').fill('160');
  await panel.getByLabel('Tempo des exercices (BPM)').press('Tab');
  await panel.getByRole('button', { name: 'Écouter', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  const pausedStudio = await studioSnapshot();
  assert.equal(pausedStudio.playing, false);
  assert.equal(pausedStudio.rate, .8);
  assert.deepEqual(pausedStudio.loop, { start: 1.5, end: 9 });
  assert.equal(pausedStudio.channels[0].keyShift, 2);
  assert.equal(pausedStudio.channels[0].gain, .35);
  assert.deepEqual(await exercisePage.locator('.score-viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight })), geometryBefore, 'Exercise view must not resize the hidden studio');
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'ended');
  await panel.getByRole('button', { name: 'Seul', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  await panel.getByRole('button', { name: 'Tonalité suivante', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  assert.deepEqual(await exercisePage.evaluate(() => window.__exerciseStarts.at(-1)), { mode: 'solo', tonic: 49, bpm: 160 });
  await panel.getByLabel('Pas chromatique').selectOption('2');
  await panel.getByRole('button', { name: 'Tonalité suivante', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  assert.equal(await panel.locator('[data-exercise-tonic]').getAttribute('data-exercise-tonic'), '51');
  await panel.getByRole('button', { name: 'Tonalité précédente', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  assert.equal(await panel.locator('[data-exercise-tonic]').getAttribute('data-exercise-tonic'), '49');
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await panel.focus(); await exercisePage.keyboard.press('Space');
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  await exercisePage.keyboard.press('ArrowRight');
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseStarts.at(-1).mode), 'solo');
  await exercisePage.keyboard.press('Escape');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.phase), 'idle');
  const startsBeforeFieldKey = await exercisePage.evaluate(() => window.__exerciseStarts.length);
  await panel.getByLabel('Tempo des exercices (BPM)').focus();
  await exercisePage.keyboard.press('ArrowRight');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseStarts.length), startsBeforeFieldKey, 'Exercise shortcuts ignore editable fields');
  await panel.getByLabel('Note haute').selectOption('64');
  await panel.getByLabel('Note basse').selectOption('60');
  await panel.getByLabel('Motif', { exact: true }).selectOption('octave');
  assert(await panel.getByRole('button', { name: 'Écouter', exact: true }).isDisabled());
  await panel.getByText('Ce motif ne tient pas dans votre étendue. Élargissez les bornes ou choisissez un autre motif.', { exact: true }).waitFor();
  await panel.getByLabel('Motif', { exact: true }).selectOption('hum');
  assert(await panel.getByRole('button', { name: 'Tonalité précédente', exact: true }).isDisabled());
  assert(await panel.getByRole('button', { name: 'Tonalité suivante', exact: true }).isDisabled());
  await panel.getByLabel('Note haute').selectOption('72');
  await panel.getByLabel('Tonique de départ').selectOption('68');
  assert(await panel.getByRole('button', { name: 'Tonalité suivante', exact: true }).isDisabled());
  await panel.getByRole('button', { name: 'Tonalité précédente', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseStarts.at(-1).tonic), 66);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await exercisePage.getByRole('button', { name: 'Partition', exact: true }).click();
  assert.deepEqual(await studioSnapshot(), pausedStudio, 'Full manual loop preserves score position/rate/mix/loop without resuming');
  await exercisePage.getByRole('button', { name: 'Piano', exact: true }).click();
  await exercisePage.locator('.piano-keyboard:not(.compact)').focus();
  await exercisePage.keyboard.down('KeyQ');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.phase), 'idle', 'Piano keyboard does not start exercises');
  await exercisePage.keyboard.up('KeyQ');
  await exercisePage.getByRole('button', { name: 'Partition', exact: true }).click();

  // A real synthetic take protects entry; its WAV replay stays mounted and paused.
  await exercisePage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
  await exercisePage.locator('.take-button.recording').waitFor();
  assert(await exercisePage.getByRole('button', { name: 'Exercices', exact: true }).isDisabled());
  await exercisePage.waitForTimeout(1200);
  await exercisePage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
  await exercisePage.waitForFunction(() => document.querySelector('.take-button') && !document.querySelector('.take-button').disabled && !document.querySelector('.take-button.recording'));
  await exercisePage.getByRole('button', { name: 'Enregistrements', exact: true }).click();
  await exercisePage.locator('.take-card').getByRole('button', { name: 'Réécouter', exact: true }).click();
  await exercisePage.waitForFunction(() => document.querySelector('.transport audio')?.currentTime > .05);
  await chooseExercises();
  await exercisePage.evaluate(() => { window.__replayElement = document.querySelector('.transport audio'); });
  await panel.getByRole('button', { name: 'Écouter', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  const pausedReplay = await exercisePage.evaluate(() => window.__replayElement.currentTime);
  await exercisePage.waitForTimeout(100);
  assert(await exercisePage.evaluate(() => window.__replayElement === document.querySelector('.transport audio') && window.__replayElement.paused), 'Replay stays mounted and paused');
  assert.equal(await exercisePage.evaluate(() => window.__replayElement.currentTime), pausedReplay);
  await exercisePage.getByRole('button', { name: 'Partition', exact: true }).click();
  assert(await exercisePage.evaluate(() => window.__replayElement.paused), 'Returning to studio does not resume WAV');
  await exercisePage.getByRole('button', { name: 'Quitter la réécoute', exact: true }).click();
  await chooseExercises();

  const anonymousPreferences = await exercisePage.evaluate(async () => (await import('/src/lib/exercises.ts')).readExercisePreferences('anonymous'));
  await exercisePage.evaluate(async a => (await import('/src/lib/sync.ts')).login(a.email, 'synthetic'), accountA);
  await exercisePage.waitForFunction(() => !document.querySelector('.exercise-view select')?.disabled);
  assert.deepEqual(await exercisePage.evaluate(async () => (await import('/src/lib/exercises.ts')).readExercisePreferences('user:exercise-ui-a')), anonymousPreferences, 'Confirmed connection adopts anonymous preferences');
  await panel.getByLabel('Tempo des exercices (BPM)').fill('111'); await panel.getByLabel('Tempo des exercices (BPM)').press('Tab');
  await panel.getByRole('button', { name: 'Écouter', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
  await exercisePage.evaluate(async a => (await import('/src/lib/sync.ts')).login(a.email, 'synthetic'), accountB);
  assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.phase), 'idle', 'Changing account cancels exercise');
  assert.equal(await panel.getByLabel('Tempo des exercices (BPM)').inputValue(), String(anonymousPreferences.bpm), 'B adopts anonymous, not A');
  await exercisePage.evaluate(async a => (await import('/src/lib/sync.ts')).login(a.email, 'synthetic'), accountA);
  assert.equal(await panel.getByLabel('Tempo des exercices (BPM)').inputValue(), '111', 'A retains its own settings');
  await exercisePage.reload(); await studioReady(); await chooseExercises();
  assert.equal(await panel.getByLabel('Tempo des exercices (BPM)').inputValue(), '111', 'Scoped UI settings survive reload');

  // Layout and translations do not restart audio. Capture only synthetic content.
  await panel.getByLabel('Motif', { exact: true }).selectOption('five-note');
  await panel.getByLabel('Tonique de départ').selectOption('60');
  for (const [language, name] of [['en','Exercises'], ['de','Übungen'], ['nl','Oefeningen'], ['fr','Exercices']]) {
    await exercisePage.evaluate(async language => (await import('/src/lib/i18n.ts')).setLanguage(language), language);
    assert.equal(await exercisePage.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
  }
  const screenshotDir = process.env.CHANSONADE_TEST_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const [width, height, theme] of [[390,844,'dark'], [844,390,'light'], [1280,900,'light']]) {
    await exercisePage.setViewportSize({ width, height });
    await exercisePage.evaluate(async theme => (await import('/src/lib/theme.ts')).themePreference.set(theme), theme);
    await exercisePage.waitForTimeout(180);
    const rect = await panel.boundingBox();
    assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1, 'Exercise panel fits viewport');
    for (const button of await panel.locator('button').all()) {
      const box = await button.boundingBox(); assert(box.width >= 44 && box.height >= 44, 'Exercise touch targets are at least 44px');
    }
    const before = await panel.boundingBox();
    const listen = panel.getByRole('button', { name: 'Écouter', exact: true });
    if (width === 390) await listen.tap(); else await listen.click();
    await exercisePage.waitForFunction(() => window.__exerciseAudio.exerciseState.phase === 'playing');
    assert.deepEqual(await panel.boundingBox(), before, 'Playback does not resize landscape rows');
    const origin = await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.startedAt);
    if (width === 390) {
      await exercisePage.setViewportSize({ width: 844, height: 390 });
      await exercisePage.waitForTimeout(180);
      assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.startedAt), origin, 'Rotation preserves the exercise clock');
      await exercisePage.setViewportSize({ width, height });
      await exercisePage.waitForTimeout(180);
    }
    if (width === 1280) {
      await exercisePage.evaluate(async () => {
        (await import('/src/lib/i18n.ts')).setLanguage('en');
        (await import('/src/lib/theme.ts')).themePreference.set('dark');
      });
      assert.equal(await exercisePage.evaluate(() => window.__exerciseAudio.exerciseState.startedAt), origin, 'Language and theme do not restart exercise audio');
      await exercisePage.evaluate(async () => {
        (await import('/src/lib/i18n.ts')).setLanguage('fr');
        (await import('/src/lib/theme.ts')).themePreference.set('light');
      });
    }

    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    if (width === 390) await panel.locator('.exercise-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    if (screenshotDir && width !== 844) await exercisePage.screenshot({ path: `${screenshotDir}/exercises-${width === 390 ? 'phone-portrait' : 'desktop'}.png` });
  }
  assert.deepEqual(errors, [], 'No unhandled exercise UI errors');
  // Detailed exercise microphone/trace checks follow in the same isolated app.

  console.log('PASS exercise UI: first use, editable extents/bounds, manual listen/solo/steps, keyboard, independent studio/replay, recording protection, confirmed adoption/accounts/reload, translations/themes and portrait/landscape');


  const setSignal = async (frequency, level = .15) => exercisePage.evaluate(({ frequency, level }) => {
    window.__micFrequency = frequency;
    const signal = window.__signal;
    if (signal?.context.state === 'running') {
      signal.frequency.cancelScheduledValues(signal.context.currentTime);
      signal.gain.cancelScheduledValues(signal.context.currentTime);
      signal.frequency.setValueAtTime(frequency, signal.context.currentTime);
      signal.gain.setValueAtTime(level, signal.context.currentTime);
    }
  }, { frequency, level });
  const waitPlaying = () => exercisePage.waitForFunction(() => window.__exerciseSession?.state.phase === 'playing');
  await panel.getByLabel('Motif', { exact: true }).selectOption('sustained');
  await panel.getByLabel('Tempo des exercices (BPM)').fill('160'); await panel.getByLabel('Tempo des exercices (BPM)').press('Tab');
  await panel.getByLabel('Note basse').selectOption('48');
  await panel.getByLabel('Tonique de départ').selectOption('57');
  const beforeSinging = await studioSnapshot();
  const listenOpens = await exercisePage.evaluate(() => window.__micOpens);
  await panel.getByRole('button', { name: 'Écouter', exact: true }).click(); await waitPlaying();
  assert.equal(await exercisePage.evaluate(() => window.__micOpens), listenOpens, 'Listen does not open the microphone');
  await setSignal(440);
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click(); await waitPlaying();
  await exercisePage.waitForFunction(() => window.__exerciseSession.confirmed.some(point => point.time > 1 && point.cents > 1150));
  const frontier = await exercisePage.evaluate(() => {
    const session = window.__exerciseSession;
    return { confirmed: session.confirmed.map(point => point.captureTime), pending: session.pending.map(point => point.captureTime), first: session.confirmed[0].captureTime };
  });
  assert(frontier.pending.length > 0 && frontier.pending.every(time => !frontier.confirmed.includes(time)), 'Real decoder pending points never enter confirmed history');
  await panel.locator('.exercise-pending').waitFor({ state: 'attached' });
  await exercisePage.evaluate(() => {
    const signal = window.__signal, now = signal.context.currentTime;
    signal.gain.setValueAtTime(0, now);
    signal.frequency.setValueAtTime(220, now + .55);
    signal.gain.setValueAtTime(.15, now + .55);
  });
  await exercisePage.waitForFunction(() => window.__exerciseSession.state.phase === 'ended');
  await exercisePage.waitForFunction(() => window.__exerciseSession.confirmed.at(-1)?.time > 3.5);
  const sung = await exercisePage.evaluate(() => {
    const session = window.__exerciseSession;
    return { points: session.confirmed, pending: session.pending, key: session.state.passage.tonic, mode: session.state.passage.mode,
      path: document.querySelector('.exercise-confirmed')?.getAttribute('d'), opens: window.__micOpens };
  });
  assert.equal(sung.points[0].captureTime, frontier.first, 'The first captured point survives until passage end');
  assert(sung.points.length > 120 && sung.points.some(point => point.frequency === 0), 'Keep the full passage and real decoded silences');
  assert(sung.points.some(point => Math.abs(point.frequency - 440) < 3 && point.cents > 1150), 'A genuine octave error remains visible as about +1200 cents');
  assert(sung.points.some(point => Math.abs(point.frequency - 220) < 3 && point.cents !== null && Math.abs(point.cents) < 30), 'Known corrected sine keeps its actual pitch');
  assert((sung.path.match(/M/g) || []).length >= 2, 'Silence interrupts the SVG path');
  assert.deepEqual(await studioSnapshot(), beforeSinging, 'Microphone and trace do not change score position, tempo, mix or loop');
  const stopsBeforeStop = await exercisePage.evaluate(() => window.__micStops);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await exercisePage.waitForFunction(() => !window.__exerciseInput.active);
  assert.equal(await exercisePage.evaluate(() => window.__micStops), stopsBeforeStop + 1, 'Stop releases an input opened by the view');

  await setSignal(330);
  await panel.getByRole('button', { name: 'Seul', exact: true }).click(); await waitPlaying();
  await exercisePage.waitForFunction(() => window.__exerciseSession.confirmed.some(point => point.time > 1 && Math.abs(point.frequency - 330) < 3));
  const oldCapture = await exercisePage.evaluate(async () => {
    const worker = window.__exerciseInput.worker, receive = worker.onmessage;
    window.__heldExerciseFrames = [];
    worker.onmessage = event => window.__heldExerciseFrames.push(event.data);
    window.__releaseExerciseFrames = () => {
      worker.onmessage = receive;
      for (const data of window.__heldExerciseFrames) receive.call(worker, { data });
    };
    await new Promise(resolve => setTimeout(resolve, 220));
    return { opens: window.__micOpens, count: window.__heldExerciseFrames.length, first: window.__exerciseSession.confirmed[0].captureTime };
  });
  assert(oldCapture.count > 0, 'Hold real decoded frames, without replacing YIN or the temporal decoder');
  await panel.getByRole('button', { name: 'Tonalité suivante', exact: true }).click(); await waitPlaying();
  await exercisePage.evaluate(() => window.__releaseExerciseFrames());
  assert.equal(await exercisePage.evaluate(() => window.__micOpens), oldCapture.opens, 'Next key reuses the same microphone and worker');
  await exercisePage.waitForFunction(() => window.__exerciseSession.confirmed.some(point => point.time > 1 && point.expectedMidi !== null));
  const nextKey = await exercisePage.evaluate(() => ({
    points: window.__exerciseSession.confirmed, pending: window.__exerciseSession.pending,
    passage: window.__exerciseSession.state.passage, origin: window.__exerciseSession.state.startedAt,
  }));
  assert.equal(nextKey.passage.mode, 'solo'); assert.equal(nextKey.passage.tonic, 59);
  assert(nextKey.points.every(point => point.captureTime > oldCapture.first && point.time >= 0), 'Delayed old-key frames do not enter the new passage');
  assert(nextKey.points.filter(point => point.expectedMidi !== null).every(point => point.expectedMidi === 59), 'Solo uses its frozen expected note');
  assert(nextKey.points.some(point => Math.abs(point.frequency - 330) < 3 && Math.abs(point.cents - 500) < 30), 'Solo traces the real voice without any sung guide notes');
  await exercisePage.getByRole('button', { name: 'Partition', exact: true }).click();
  await exercisePage.waitForFunction(() => !window.__exerciseInput.active);

  // Borrow the studio input; neither repeating, listening nor leaving may close it.
  await exercisePage.getByRole('button', { name: 'Écouter ma voix', exact: true }).click();
  await exercisePage.waitForFunction(() => window.__exerciseInput.active);
  const borrowed = await exercisePage.evaluate(() => ({ opens: window.__micOpens, stops: window.__micStops }));
  await chooseExercises();
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click(); await waitPlaying();
  assert.deepEqual(await exercisePage.evaluate(() => ({ opens: window.__micOpens, stops: window.__micStops })), borrowed, 'Guide borrows the active studio input without a stop/reopen');
  await panel.getByRole('button', { name: 'Écouter', exact: true }).click(); await waitPlaying();
  assert.equal(await exercisePage.evaluate(() => window.__exerciseSession.confirmed.length), 0, 'Listen does not trace borrowed microphone input');
  await exercisePage.getByRole('button', { name: 'Partition', exact: true }).click();
  assert(await exercisePage.evaluate(() => window.__exerciseInput.active), 'Leaving preserves a microphone opened by the studio');
  await exercisePage.getByRole('button', { name: 'Arrêter le microphone', exact: true }).click();
  await exercisePage.waitForFunction(() => !window.__exerciseInput.active);

  // A permission prompt completing after Stop must not revive capture or sound.
  await chooseExercises();
  await exercisePage.evaluate(() => { window.__holdMic = true; });
  const startsBeforePrompt = await exercisePage.evaluate(() => window.__exerciseStarts.length);
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click();
  await exercisePage.waitForFunction(() => !!window.__releaseMic);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await exercisePage.evaluate(() => { window.__holdMic = false; window.__releaseMic(); });
  await exercisePage.waitForTimeout(250);
  assert(await exercisePage.evaluate(() => !window.__exerciseInput.active && window.__exerciseAudio.exerciseState.phase === 'idle'), 'Late permission completion stays stopped');
  assert.equal(await exercisePage.evaluate(() => window.__exerciseStarts.length), startsBeforePrompt);
  await exercisePage.evaluate(() => { window.__denyMic = true; });
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Synthetic microphone permission denied' }).waitFor();
  assert.equal(await exercisePage.evaluate(() => window.__exerciseStarts.length), startsBeforePrompt, 'Permission refusal never starts the accompaniment');
  await exercisePage.evaluate(() => { window.__denyMic = false; });

  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click(); await waitPlaying();
  await exercisePage.waitForFunction(() => window.__exerciseSession.pending.length > 0);
  await exercisePage.evaluate(() => {
    const session = window.__exerciseSession, stop = session.stop.bind(session);
    session.stop = () => {
      const before = session.pending, confirmed = session.confirmed.length;
      stop();
      window.__stoppedTrace = { before, after: session.pending, confirmedBefore: confirmed, confirmedAfter: session.confirmed.length };
    };
  });
  await exercisePage.evaluate(() => window.dispatchEvent(new Event('blur')));
  await exercisePage.waitForFunction(() => !window.__exerciseInput.active && window.__exerciseAudio.exerciseState.phase === 'idle');
  const stoppedTrace = await exercisePage.evaluate(() => window.__stoppedTrace);
  assert(stoppedTrace.before.length > 0, 'Stop regression observes a real provisional frontier');
  assert.deepEqual(stoppedTrace.after, stoppedTrace.before, 'Stopping capture keeps its last frontier dotted');
  assert.equal(stoppedTrace.confirmedBefore, stoppedTrace.confirmedAfter, 'Stop never promotes provisional samples into confirmed points');
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click(); await waitPlaying();
  await exercisePage.evaluate(async a => (await import('/src/lib/sync.ts')).login(a.email, 'synthetic'), accountB);
  assert(await exercisePage.evaluate(() => !window.__exerciseInput.active && !window.__exerciseSession.confirmed.length), 'Account switch releases owned capture and removes the old trace');
  await exercisePage.evaluate(async a => (await import('/src/lib/sync.ts')).login(a.email, 'synthetic'), accountA);
  assert.equal(await exercisePage.evaluate(() => window.__inputs.size), 1, 'Studio, takes and exercises use one PitchInput instance');

  // Required screenshots show the genuine decoder trace, not injected points.
  if (await exercisePage.locator('.toast').count()) await exercisePage.getByRole('button', { name: 'Fermer le message', exact: true }).click();
  await panel.getByLabel('Motif', { exact: true }).selectOption('sustained');
  await panel.getByLabel('Tonique de départ').selectOption('57');
  await setSignal(440);
  await panel.getByRole('button', { name: 'Avec guide', exact: true }).click(); await waitPlaying();
  await exercisePage.waitForFunction(() => window.__exerciseSession.state.phase === 'ended' && window.__exerciseSession.confirmed.at(-1)?.time > 3.5);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  for (const [width, height, theme] of [[1280,900,'light'], [390,844,'dark']]) {
    await exercisePage.setViewportSize({ width, height });
    await exercisePage.evaluate(async theme => (await import('/src/lib/theme.ts')).themePreference.set(theme), theme);
    await exercisePage.waitForTimeout(180);
    await panel.locator('.exercise-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    for (const button of await panel.locator('button').all()) {
      const box = await button.boundingBox(); assert(box.width >= 44 && box.height >= 44, 'All six actions keep 44px touch targets');
    }
    if (width === 390) {
      for (const language of ['en', 'de', 'nl', 'fr']) {
        await exercisePage.evaluate(async language => (await import('/src/lib/i18n.ts')).setLanguage(language), language);
        assert(await panel.locator('.exercise-actions button').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth + 1)), 'Translated action text stays inside its touch target');
      }
    }
    if (screenshotDir) await exercisePage.screenshot({ path: `${screenshotDir}/exercises-${width === 390 ? 'phone-portrait' : 'desktop'}.png` });
  }
  assert.deepEqual(errors, [], 'No unhandled exercise microphone errors');
  console.log('PASS exercise microphone: real sine pitches/octave/silence/full trace, separate frontier, late decoded frames/key changes, solo, reuse/borrow/cleanup, permission cancellation/refusal, blur, accounts and one PitchInput');

  // Cached identity is not a confirmed connection. Adoption updates an already open view.
  const cached = await browser.newContext({ serviceWorkers: 'block' }); contexts.push(cached);
  await cached.addInitScript(syntheticMicrophone);
  cached.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const guest = { exerciseId: 'arpeggio', bpm: 83, step: 2, voice: { low: 48, high: 72, tonic: 55 } };
  await cached.addInitScript(({ account, guest }) => {
    if (location.origin === 'null') return;
    localStorage.setItem('chansonade.account', JSON.stringify(account));
    localStorage.setItem('chansonade.language', 'fr');
    localStorage.setItem('chansonade.exercises.anonymous', JSON.stringify(guest));
  }, { account: accountA, guest });
  let confirmSession;
  const confirmed = new Promise(resolve => { confirmSession = resolve; });
  await cached.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/session')) { await confirmed; return route.fulfill({ json: { user: accountA, registration: 'open' } }); }
    return route.fulfill({ status: 503, json: { message: 'Synthetic unavailable' } });
  });
  let releaseScore;
  const scoreReady = new Promise(resolve => { releaseScore = resolve; });
  await cached.route('**/scores/*.musicxml', async route => { await scoreReady; return route.fulfill({ contentType: 'application/xml', body: fixtureXML }); });
  const cachedPage = await cached.newPage();
  await cachedPage.goto(url);
  await cachedPage.evaluate(async () => {
    const { PitchInput } = await import('/src/lib/pitch.ts');
    const { ExerciseSession } = await import('/src/lib/exercise-session.ts');
    const startInput = PitchInput.prototype.start, startSession = ExerciseSession.prototype.start;
    PitchInput.prototype.start = function (...args) { window.__separateInput = this; return startInput.apply(this, args); };
    ExerciseSession.prototype.start = function (...args) { window.__separateSession = this; return startSession.apply(this, args); };
  });
  await cachedPage.getByRole('button', { name: 'Écouter ma voix', exact: true }).click();
  await cachedPage.waitForFunction(() => window.__separateInput?.active);
  await cachedPage.getByRole('button', { name: 'Voix & instruments', exact: true }).click();
  await cachedPage.locator('#latency').evaluate(input => { input.value = '120'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await cachedPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
  await cachedPage.getByRole('button', { name: 'Exercices', exact: true }).click();
  assert.equal(await cachedPage.locator('.exercise-view').getByLabel('Tessiture indicative').inputValue(), '', 'Cached account alone does not adopt anonymous preferences');
  confirmSession();
  await cachedPage.waitForFunction(() => document.querySelector('.exercise-view input[type="number"]')?.value === '83');
  assert.equal(await cachedPage.locator('.exercise-view').getByLabel('Tessiture indicative').inputValue(), '3', 'Confirmed adoption refreshes an already mounted view');
  console.log('PASS exercise connection: cached account does not adopt before server confirmation; live adoption refreshes without remount');
  await cachedPage.evaluate(async () => {
    const { AudioPlayer } = await import('/src/lib/audio.ts');
    const start = AudioPlayer.prototype.startExercise;
    AudioPlayer.prototype.startExercise = function (passage) { window.__earlyExerciseAudio = this; return start.call(this, passage); };
  });
  await cachedPage.locator('.exercise-view').getByRole('button', { name: 'Avec guide', exact: true }).click();
  await cachedPage.waitForFunction(() => window.__earlyExerciseAudio?.exerciseState.phase === 'playing');
  assert.equal(await cachedPage.evaluate(() => window.__earlyExerciseAudio.loaded), false, 'Exercises can start before the initial score loads');
  await cachedPage.waitForFunction(() => window.__separateSession.confirmed.some(point => point.frequency > 0 && point.time > 1));
  assert(await cachedPage.evaluate(() => window.__separateInput.contextClock !== window.__earlyExerciseAudio.context), 'Borrowed studio input keeps its separate AudioContext');
  const clock = await cachedPage.evaluate(() => {
    const run = window.__separateSession.run, point = window.__separateSession.confirmed.find(point => point.time > 1 && point.frequency > 0);
    return { offset: run.offset, latencyMs: run.latencyMs, error: point.time - (point.captureTime + run.offset - run.latencyMs / 1000 - run.origin.startedAt), opens: window.__micOpens };
  });
  assert(Math.abs(clock.offset) > .1 && Math.abs(clock.error) < 1e-9 && clock.latencyMs === 120 && clock.opens === 1, 'Clock conversion and frozen microphone compensation use capture times without reopening');

  releaseScore();
  await cachedPage.waitForFunction(() => window.__earlyExerciseAudio.loaded);
  assert.notEqual(await cachedPage.evaluate(() => window.__earlyExerciseAudio.exerciseState.phase), 'idle', 'Late studio loading must not cancel a newer exercise');
  assert.deepEqual(errors, [], 'No unhandled exercise/adoption/loading errors');
  console.log('PASS exercise loading: sound before any score, late initial studio loading preserves newer auxiliary activity');


} finally { for (const context of contexts) await context.close(); await browser.close(); }
