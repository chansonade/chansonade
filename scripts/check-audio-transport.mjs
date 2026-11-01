// Requires an isolated Vite server and a headless Chromium CDP endpoint.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194');
  await page.evaluate(async () => {
    const { AudioPlayer } = await import('/src/lib/audio.ts');
    const { Score } = await import('/src/lib/score.ts');
    const engine = new Score();
    const score = await engine.load(await (await fetch('/scores/une-souris-verte-chant-piano.musicxml')).text(), 'vertical', 900, 1);
    engine.destroy();
    const audio = new AudioPlayer();
    await audio.load(score.musical.midi);
    const button = document.createElement('button');
    button.id = 'check-audio-start'; button.textContent = 'Test audio';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:9999999';
    document.body.append(button);
    button.onclick = () => {
      window.__audioCheck = (async () => {
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
  await page.locator('#check-audio-start').click({ force: true });
  const result = await page.evaluate(() => window.__audioCheck);
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
} finally { await context.close(); await browser.close(); }
