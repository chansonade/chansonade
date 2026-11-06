// Run through check-client.mjs, or supply an isolated Vite URL and Chromium CDP.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = `${process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194'}/check-audio-transport`;
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio transport regression</title><button id="check-audio-start">Start synthetic audio</button>' }));
  await page.goto(url);
  await page.evaluate(async () => {
    const { AudioPlayer } = await import('/src/lib/audio.ts');
    const { Score } = await import('/src/lib/score.ts');
    const engine = new Score();
    // Two 2/4 bars at 78 bpm place G4 at 3.077 s in Verovio's rounded timemap.
    // Sustained half notes also exercise held notes after a normal pause/resume.
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1">
        <part-name>Synthetic</part-name>
        <midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
      </score-part></part-list>
      <part id="P1">${Array.from({ length: 8 }, (_, i) => `
        <measure number="${i + 1}">
          ${i ? '' : `<attributes>
            <divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time>
            <clef><sign>G</sign><line>2</line></clef>
          </attributes><direction><sound tempo="78"/></direction>`}
          <note><pitch><step>${['C', 'D', 'G', 'A'][i % 4]}</step><octave>4</octave></pitch>
            <duration>2</duration><type>half</type></note>
        </measure>`).join('')}
      </part>
    </score-partwise>`;
    window.__transportXML = xml;
    let score;
    try { score = await engine.load(xml, 'vertical', 900, 1); }
    finally { engine.destroy(); }
    window.__transportMIDI = score.musical.midi;
    const audio = new AudioPlayer();
    const button = document.querySelector('#check-audio-start');
    button.onclick = () => {
      window.__audioCheck = (async () => {
        await audio.load(score.musical.midi);
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const snapshots = [];
        await audio.context.resume();
        audio.seek(3.077);
        for (let i = 0; i < 12; i++) { snapshots.push({ time: audio.time, playing: audio.playing }); await sleep(100); }
        const analyser = audio.context.createAnalyser();
        analyser.fftSize = 4096;
        audio.synth.connect(analyser);
        const waveform = new Float32Array(analyser.fftSize);
        const rms = () => { analyser.getFloatTimeDomainData(waveform); return Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length); };
        const firstNotes = [];
        audio.synth.eventHandler.addEvent('noteOn', 'check-first-note', event => firstNotes.push(event));
        await audio.play();
        const resumed = audio.time;
        await sleep(180);
        const advanced = audio.time;
        const firstRms = rms();
        audio.synth.eventHandler.removeEvent('noteOn', 'check-first-note');
        audio.pause();
        const paused = audio.time;
        await sleep(700);
        const pausedLater = audio.time;
        await audio.play();
        const resumedAgain = audio.time;
        await sleep(100);
        const resumedRms = rms();
        audio.pause();
        audio.setLoop(3.077, 3.4);
        audio.seek(3.077);
        await sleep(700);
        await audio.play();
        const loopStart = audio.time;
        await sleep(70);
        const loopRms = rms();
        let jumped = false;
        for (let i = 0; i < 80; i++) { if (audio.update()) { jumped = true; break; } await sleep(10); }
        const afterJump = audio.time;
        audio.pause();
        return { snapshots, firstNotes, firstRms, resumed, advanced, paused, pausedLater, resumedAgain, resumedRms, loopStart, loopRms, jumped, afterJump };
      })().finally(() => audio.destroy());
    };
  });
  await page.locator('#check-audio-start').click();
  const result = await page.evaluate(() => window.__audioCheck);
  assert.deepEqual(errors, [], 'No unhandled audio transport errors');
  console.log(JSON.stringify(result));
  assert(result.snapshots.every(point => point.time === 3.077 && !point.playing), 'paused seek must remain exactly fixed');
  assert(Math.abs(result.resumed - 3.077) < .02, 'play must resume at requested seek');
  assert(result.firstNotes.some(note => note.channel === 0 && note.midiNote === 67), 'first selected melody note must sound immediately');
  assert(result.firstRms > .001, 'first selected note must produce audio');
  assert(result.resumedRms > .001, 'normal pause/resume must preserve held notes');
  assert(result.loopRms > .001, 'loop start must produce audio');
  assert(result.advanced > 3.15 && result.advanced < 3.4, 'playback must advance from the requested seek');
  assert.equal(result.pausedLater, result.paused, 'pause must freeze time');
  assert(Math.abs(result.resumedAgain - result.paused) < .02, 'resume must preserve paused position');
  assert(Math.abs(result.loopStart - 3.077) < .02, 'paused loop must start at A');
  assert(result.jumped && Math.abs(result.afterJump - 3.077) < .02, 'loop wrap must return to A');
  console.log('Audio transport: paused seek, resume, pause freeze and loop wrap passed.');
  // Exercise audio runs on a second sequencer of the existing piano synth.
  await page.evaluate(async () => {
    const { AudioPlayer } = await import('/src/lib/audio.ts');
    const { createExercisePassage, exerciseSecondsAt } = await import('/src/lib/exercises.ts');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const passage = (mode = 'guide', tonic = 60) => createExercisePassage({
      exerciseId: 'staccato', bpm: 160, step: 1, voice: { low: 48, high: 84, tonic },
    }, mode);
    document.querySelector('#check-audio-start').onclick = () => {
      window.__exerciseCheck = (async () => {
        const audio = new AudioPlayer();
        try {
          await audio.load(window.__transportMIDI);
          await audio.context.resume();
          audio.seek(3.077); audio.setRate(1.25);
          audio.setProgram(0, 73); audio.setTranspose(0, 3); audio.setVolume(0, 47); audio.setMuted(0, true);
          await sleep(50);
          const snapshot = () => JSON.stringify({
            time: audio.time, playing: audio.playing, rate: audio.sequencer.playbackRate,
            channels: audio.synth.midiChannels.map(channel => ({ ...channel.systemParameters, patch: { ...channel.patch } })),
          });
          const before = snapshot();
          // First piano use initializes exactly the instrument later used by exercises.
          await audio.pianoNoteOn(84);
          const instrument = audio.auxiliary;
          const primary = audio.sequencer;
          const stampEvents = [];
          instrument.node.port.addEventListener('message', event => {
            for (const message of event.data) {
              if (message.type === 'eventCall' && message.data.type === 'noteOn') {
                stampEvents.push({ time: message.currentTime, ...message.data.data });
              }
            }
          });
          // Observe real output inside the audio rendering thread, even while JS is blocked.
          const code = `class Capture extends AudioWorkletProcessor {
            process(inputs) {
              const samples = inputs[0][0];
              if (samples) {
                let energy = 0;
                for (const sample of samples) energy += sample * sample;
                this.port.postMessage({ time: currentTime, rms: Math.sqrt(energy / samples.length) });
              }
              return true;
            }
          } registerProcessor('exercise-check-capture', Capture);`;
          const blob = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          try { await audio.context.audioWorklet.addModule(blob); }
          finally { URL.revokeObjectURL(blob); }
          const capture = () => {
            const node = new AudioWorkletNode(audio.context, 'exercise-check-capture');
            const samples = [];
            node.port.onmessage = event => samples.push(event.data);
            node.connect(audio.context.destination);
            return { node, samples };
          };
          const voice = capture(), output = capture();
          instrument.synth.connectChannel(voice.node, 1);
          instrument.output.connect(output.node);

          // Stall delivery of the start acknowledgement, not the audio renderer.
          const play = instrument.sequencer.play;
          let stallEnd = 0;
          instrument.sequencer.play = function () {
            play.call(this);
            const end = performance.now() + 1250;
            while (performance.now() < end) { /* deliberate main-thread stall */ }
            stallEnd = audio.context.currentTime;
          };
          let start;
          try { start = await audio.startExercise(passage()); }
          finally { instrument.sequencer.play = play; }
          check(start && stallEnd - start.startedAt > 1, 'origin must be the Worklet clock before the blocked main thread received it');
          check(audio.auxiliary === instrument && audio.sequencer === primary, 'reuse piano synth and leave score sequencer intact');
          audio.pianoNoteOff(84); // stale keyboard cleanup must not stop the exercise
          check(audio.exerciseState.phase === 'playing', 'piano cleanup must not cancel exercise');
          await sleep(Math.max(0, (start.startedAt + start.duration - audio.context.currentTime) * 1000) + 120);
          check(audio.exerciseState.phase === 'ended', 'exercise ends at its full calendar duration');
          const melody = stampEvents.filter(note => note.channel === 1 && note.time >= start.startedAt);
          const expected = passage().notes.filter(note => note.role === 'voice');
          check(melody.length === expected.length, 'each guide note sounds exactly once');
          const offsets = melody.map((note, i) => note.time - start.startedAt - exerciseSecondsAt(passage(), expected[i].startTick));
          check(offsets.every(offset => Math.abs(offset) < .025), 'Worklet guide tempo stays stable while the main thread is blocked');
          const audibleOffsets = expected.map(note => {
            const onset = start.startedAt + exerciseSecondsAt(passage(), note.startTick);
            const sample = voice.samples.find(sample => sample.time >= onset - .01 && sample.time < onset + .08 && sample.rms > .001);
            check(sample, 'every scheduled guide note produces an audible onset');
            check(output.samples.some(sample => sample.time >= onset && sample.time < onset + .08 && sample.rms > .001),
              'guide must reach the actual auxiliary output, beyond the channel monitor');
            return sample.time - onset;
          });
          check(snapshot() === before, 'exercise must preserve score position, rate, program, transpose, gain and mute');

          const immediate = createExercisePassage({
            exerciseId: 'hum', bpm: 160, step: 1, cue: false, voice: { low: 48, high: 84, tonic: 60 },
          }, 'guide');
          const directStart = await audio.startExercise(immediate);
          await sleep(120);
          const directNotes = stampEvents.filter(note => note.time >= directStart.startedAt);
          check(directNotes.length === 1 && directNotes[0].channel === 1 && directNotes[0].midiNote === 60,
            'without cue the first sound is the first melody note, never a chord');
          check(Math.abs(directNotes[0].time - directStart.startedAt) < 1e-9,
            'the first sounding note starts at t=0 on the returned Worklet origin: ' + JSON.stringify({ directNotes, directStart }));
          check(output.samples.some(sample => sample.time >= directStart.startedAt && sample.time < directStart.startedAt + .08 && sample.rms > .001),
            'the first melody note is audible immediately');
          const directOffsets = [directNotes[0].time - directStart.startedAt];
          for (let repeat = 0; repeat < 5; repeat++) {
            const origin = await audio.startExercise(immediate);
            await sleep(80);
            const notes = stampEvents.filter(note => note.time >= origin.startedAt);
            check(notes.length === 1 && notes[0].channel === 1 && notes[0].midiNote === 60,
              'each cue-less replacement starts the melody exactly once');
            directOffsets.push(notes[0].time - origin.startedAt);
          }
          check(directOffsets.every(offset => Math.abs(offset) < 1e-9),
            'cue-less starts align exactly to their playback origin: ' + JSON.stringify(directOffsets));
          const silentStart = await audio.startExercise({ ...immediate, mode: 'solo' });
          await sleep(700);
          const silentOutput = output.samples.filter(sample => sample.time > silentStart.startedAt + .05);
          check(silentOutput.length > 100 && silentOutput.every(sample => sample.rms < .00001),
            'solo without cue stays silent, including the previous melody’s effect tails');
          check(!stampEvents.some(note => note.time >= silentStart.startedAt), 'solo without cue never sends a note-on');
          check(audio.exerciseState.phase === 'playing', 'silent solo preserves its full practice calendar');
          check(snapshot() === before, 'optional cue never changes the score transport or mix');

          // Solo retains the entire silent singing window (no guide events/audio).
          const solo = await audio.startExercise(passage('solo'));
          await sleep(1000);
          check(audio.exerciseState.phase === 'playing', 'solo stays active after its opening chord');
          await sleep((solo.startedAt + solo.duration - audio.context.currentTime) * 1000 + 100);
          check(!stampEvents.some(note => note.channel === 1 && note.time >= solo.startedAt), 'solo must not emit guide notes');
          check(voice.samples.filter(sample => sample.time >= solo.startedAt + .2).every(sample => sample.rms < .00001), 'solo guide channel stays silent');
          check(audio.exerciseState.phase === 'ended' && audio.exerciseState.time === solo.duration, 'solo does not end with the cue');
          check(snapshot() === before, 'solo must preserve score settings');

          const first = await audio.startExercise(passage());
          await sleep(850);
          const replacement = await audio.startExercise(passage('guide', 62));
          check(replacement.startedAt > first.startedAt && audio.exerciseState.passage.tonic === 62, 'new passage replaces previous one');
          await sleep(900);
          const replacementNotes = stampEvents.filter(note => note.channel === 1 && note.time >= replacement.startedAt);
          check(replacementNotes.length === 1 && replacementNotes[0].midiNote === 62, 'old exercise must not keep sequencing behind replacement');
          await audio.pianoNoteOn(79);
          check(audio.exerciseState.phase === 'idle' && audio.auxiliary === instrument, 'piano preempts exercise on the same synth');
          await sleep(80);
          check(stampEvents.some(note => note.midiNote === 79 && note.channel === 0), 'manual piano sounds after exercise');
          audio.pianoNoteOff(79);
          await audio.startExercise(passage());
          check(audio.auxiliaryActivity.kind === 'exercise', 'exercise preempts piano');
          audio.stopAuxiliary();
          const stoppedAt = audio.context.currentTime;
          await sleep(1000);
          check(audio.exerciseState.phase === 'idle', 'stop clears exercise state');
          const silence = output.samples.filter(sample => sample.time > stoppedAt + .05);
          check(silence.length > 100 && silence.every(sample => sample.rms < .00001), 'stop cuts voices and effect tails, with no later audio');
          check(!stampEvents.some(note => note.time > stoppedAt + .05), 'stopped exercise never emits later notes');
          check(snapshot() === before, 'stops and piano preemption must preserve score settings');

          // Delay the real songChange acknowledgement. A stopped load stays stopped.
          const events = instrument.sequencer.eventHandler;
          const addEvent = events.addEvent.bind(events);
          let releaseLoad;
          events.addEvent = (name, id, callback) => addEvent(name, id, name === 'songChange'
            ? event => { releaseLoad = () => callback(event); } : callback);
          const late = audio.startExercise(passage());
          while (!releaseLoad) await sleep(10);
          audio.stopAuxiliary();
          events.addEvent = addEvent;
          const afterLateStop = audio.context.currentTime;
          releaseLoad();
          check(await late === null, 'cancelled MIDI load resolves without starting');
          await sleep(950);
          check(audio.exerciseState.phase === 'idle', 'late songChange must not revive playback');
          check(output.samples.filter(sample => sample.time > afterLateStop + .05).every(sample => sample.rms < .00001), 'cancelled load stays silent');
          check(snapshot() === before, 'late loading leaves score untouched');

          releaseLoad = null;
          events.addEvent = (name, id, callback) => addEvent(name, id, name === 'songChange'
            ? event => { releaseLoad = () => callback(event); } : callback);
          const obsolete = audio.startExercise(passage());
          while (!releaseLoad) await sleep(10);
          const newest = audio.startExercise(passage('guide', 64));
          events.addEvent = addEvent;
          releaseLoad();
          check(await obsolete === null, 'replacement cancels a still-loading passage');
          const newestStart = await newest;
          await sleep(900);
          const newestNotes = stampEvents.filter(note => note.channel === 1 && note.time >= newestStart.startedAt);
          check(newestNotes.length === 1 && newestNotes[0].midiNote === 64, 'late acknowledgement cannot start the superseded passage');
          audio.stopAuxiliary();

          // A cancelled initialization cannot start either an exercise or an old key.
          const bank = await audio.loadSoundBank();
          const cold = new AudioPlayer();
          let releaseBank, bankRequested;
          const requested = new Promise(resolve => { bankRequested = resolve; });
          const bankGate = new Promise(resolve => { releaseBank = resolve; });
          cold.loadSoundBank = async () => { bankRequested(); await bankGate; return bank.slice(0); };
          try {
            const oldKey = cold.pianoNoteOn(81);
            const initializing = cold.startExercise(passage());
            await requested;
            cold.stopAuxiliary();
            const newKey = cold.pianoNoteOn(76);
            releaseBank();
            check(await initializing === null, 'stopped initialization must not start exercise later');
            await Promise.all([oldKey, newKey]);
            check(cold.auxiliaryActivity.kind === 'piano' && cold.auxiliaryActivity.sounding.size === 1
              && cold.auxiliaryActivity.sounding.has(76), 'old delayed piano key cannot join a newer piano session');
            cold.stopAuxiliary();
          } finally { releaseBank(); await cold.destroy(); }

          const closing = new AudioPlayer();
          let closeRelease, closeRequested;
          const closeGate = new Promise(resolve => { closeRelease = resolve; });
          const closeReady = new Promise(resolve => { closeRequested = resolve; });
          closing.loadSoundBank = async () => { closeRequested(); await closeGate; return bank.slice(0); };
          const closingStart = closing.startExercise(passage());
          await closeReady;
          await closing.destroy();
          closeRelease();
          check(await closingStart === null && closing.exerciseState.phase === 'idle' && !closing.context,
            'destroy during initialization must neither recreate a context nor start notes');

          voice.node.disconnect(); output.node.disconnect();
          return { offsets, audibleOffsets, directOffsets, originDelay: stallEnd - start.startedAt, duration: start.duration, soloDuration: solo.duration };
        } finally { await audio.destroy(); }
      })();
    };
  });
  await page.locator('#check-audio-start').click();
  const exercises = await page.evaluate(() => window.__exerciseCheck);
  console.log('Exercise audio:', JSON.stringify(exercises));
  assert.deepEqual(errors, [], 'No unhandled exercise audio errors');

  // Mount the real coordinator in a synthetic page: exercise API has no UI yet.
  const xml = await page.evaluate(() => window.__transportXML);
  const lifecycleUrl = url + '-lifecycle';
  await context.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  await context.route('**/scores/*.musicxml', route => route.fulfill({ contentType: 'application/xml', body: xml }));
  await context.route(lifecycleUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <div id="app"></div><script type="module">
      import { AudioPlayer } from '/src/lib/audio.ts';
      import { mount, unmount } from '/node_modules/.vite/deps/svelte.js';
      import App from '/src/App.svelte';
      import '/src/style.css';
      const load = AudioPlayer.prototype.load;
      AudioPlayer.prototype.load = function (...args) { window.__appAudio = this; return load.apply(this, args); };
      const app = mount(App, { target: document.getElementById('app') });
      window.__unmount = () => unmount(app);
    </script>` }));
  await page.goto(lifecycleUrl);
  await page.waitForFunction(() => window.__appAudio?.loaded);
  await page.evaluate(async () => {
    const { createExercisePassage } = await import('/src/lib/exercises.ts');
    window.__startPassage = () => window.__appAudio.startExercise(createExercisePassage({
      exerciseId: 'hum', bpm: 160, step: 1, voice: { low: 48, high: 84, tonic: 60 },
    }, 'guide'));
  });
  const assertIdle = async label => {
    await page.waitForFunction(() => window.__appAudio.exerciseState.phase === 'idle');
    assert.equal(await page.evaluate(() => window.__appAudio.auxiliary.output.gain.value), 0, label);
  };
  await page.evaluate(() => window.__startPassage());
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await assertIdle('blur silences auxiliary');
  await page.evaluate(() => window.__startPassage());
  // Headless Chromium has no OS task switcher: exercise the visibility handler.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await assertIdle('background silences auxiliary');
  await page.evaluate(() => window.__startPassage());
  await page.getByRole('button', { name: 'Piano', exact: true }).click();
  await assertIdle('view change silences auxiliary');
  await page.evaluate(() => window.__startPassage());
  await page.evaluate(async () => (await import('/src/lib/storage.ts')).setStorageScope('user:synthetic-exercise-account'));
  await assertIdle('scope change silences auxiliary');
  await page.waitForFunction(() => window.__appAudio.loaded);
  await page.evaluate(() => window.__startPassage());
  await page.evaluate(() => window.__unmount());
  assert.equal(await page.evaluate(() => window.__appAudio.exerciseState.phase), 'idle', 'unmount cancels exercise');
  await page.waitForFunction(() => window.__appAudio.context === null);
  assert.deepEqual(errors, [], 'No unhandled initialization/lifecycle errors');
  console.log('Exercise lifecycle: delayed initialization/loading, replacement, piano exclusivity, blur, background, view, account and unmount passed.');


} finally { await context.close(); await browser.close(); }
