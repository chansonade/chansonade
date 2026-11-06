// Isolated, synthetic browser regression checks. No real microphone or account.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194';
const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const contexts = [];
const errors = [];

async function isolatedContext(account = null, options = {}) {
  const context = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1150, height: 850 }, serviceWorkers: 'block', ...options });
  contexts.push(context);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.addInitScript(({ account }) => {
    if (location.origin === 'null') return; // The initial about:blank has no storage permission.
    localStorage.setItem('chansonade.language', 'fr');
    if (account) localStorage.setItem('chansonade.account', JSON.stringify(account));
    // Replace the capture source, not the pitch detector, recorder or storage.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 220; gain.gain.value = 0.15;
      oscillator.connect(gain).connect(destination); oscillator.start();
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.getSettings = () => ({ sampleRate: context.sampleRate, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
      track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      return destination.stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  }, { account });
  return context;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.transport .play-button')?.disabled === false, null, { timeout: 30_000 });
}
const progress = page => page.locator('.timeline-row input[type="range"]').inputValue().then(Number);

// Studio scenarios choose the imported row explicitly; upload itself only adds.
async function openImported(page, title) {
  await page.locator('.library-tree .file-open').filter({ has: page.getByText(title, { exact: true }) }).click();
}

try {
  const context = await isolatedContext();
  await context.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  const page = await context.newPage();
  await page.goto(url); await ready(page);
  const original = await readFile(new URL('../public/scores/une-souris-verte-chant-piano.musicxml', import.meta.url), 'utf8');
  const title = 'CI synthetic score';
  const xml = original.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${title}</work-title>`);
  await page.locator('input[type="file"]').setInputFiles({ name: 'ci-synthetic.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await openImported(page, title);
  await page.waitForFunction(title => document.querySelector('h1')?.textContent === title, title); await ready(page);
  const pagesBefore = await page.locator('.sheet-page').count();
  assert(pagesBefore > 0);
  await page.locator('input[type="file"]').setInputFiles({ name: 'ci-too-large.musicxml', mimeType: 'application/xml', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32) });
  await page.locator('.toast').filter({ hasText: '5 Mio' }).waitFor();
  assert.equal(await page.locator('h1').innerText(), title, 'Rejected import keeps the current document');
  assert.equal(await page.locator('.sheet-page').count(), pagesBefore, 'Rejected import keeps the engraving');
  console.log('PASS browser: valid import and oversized import without losing the document');
  const savedBefore = await page.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length);
  for (const invalid of [
    original.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${'x'.repeat(501)}</work-title>`),
    original.replace(/<creator type="composer">[^<]*<\/creator>/, `<creator type="composer">${'x'.repeat(501)}</creator>`),
  ]) {
    await page.locator('input[type="file"]').setInputFiles({ name: 'invalid-metadata.musicxml', mimeType: 'application/xml', buffer: Buffer.from(invalid) });
    await page.locator('.toast').filter({ hasText: '500 caractères' }).waitFor();
    assert.equal(await page.locator('h1').innerText(), title);
    assert.equal(await page.locator('.sheet-page').count(), pagesBefore);
    assert.equal(await page.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length), savedBefore);
  }
  console.log('PASS browser: rejected title/composer preserves active score and library');

  const measure = page.locator('.sheet-page .measure').first();
  const notes = measure.locator('.staff').first().locator('.note');
  assert(await notes.count() > 1, 'Synthetic score has a complete first vocal bar');
  await page.getByTitle('Sélectionner un passage à répéter (L)', { exact: true }).click();
  await notes.first().locator('.notehead').click();
  await notes.last().locator('.notehead').click();
  await page.waitForFunction(() => document.querySelectorAll('.loop-region').length === 1);
  const box = await page.evaluate(() => {
    const region = document.querySelector('.loop-region');
    const line = document.querySelector('.sheet-page .measure > .staff > path').getBoundingClientRect();
    const origin = document.querySelector('.score-content').getBoundingClientRect();
    return { left: Number.parseFloat(region.style.left), width: Number.parseFloat(region.style.width), height: Number.parseFloat(region.style.height), expectedLeft: line.left - origin.left, expectedWidth: line.width };
  });
  assert(Math.abs(box.left - box.expectedLeft) < 1 && Math.abs(box.width - box.expectedWidth) < 1 && box.height > 0, 'The loop rectangle covers exactly the selected bar');
  await page.getByRole('button', { name: 'Désactiver la boucle', exact: true }).click();
  console.log('PASS browser: one-bar loop and its visible rectangle');

  await page.locator('.transport .play-button').click();
  await page.waitForFunction(() => Number(document.querySelector('.timeline-row input').value) > 0.15);
  const before = await progress(page);
  await page.locator('.display-preferences summary').click();
  await page.locator('.display-preferences').getByRole('button', { name: 'English', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(await page.locator('.score-facts').innerText(), /bars/);
  await page.locator('.display-preferences summary').click();
  await page.locator('.display-preferences').getByRole('button', { name: 'Français', exact: true }).click();
  await page.getByTitle('Ruban horizontal fluide', { exact: true }).click();
  await page.locator('.score-viewport.horizontal').waitFor();
  await page.locator('.auto-mode').click();
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForFunction(() => !document.querySelector('.score-viewport').classList.contains('horizontal'));
  await page.setViewportSize({ width: 900, height: 500 });
  await page.locator('.score-viewport.horizontal').waitFor();
  assert(await page.locator('.transport .play-button').evaluate(button => button.classList.contains('is-playing')), 'Mode and rotation preserve playback');
  assert(await progress(page) > before, 'Transport keeps advancing across language, mode and orientation changes');
  await page.setViewportSize({ width: 1150, height: 850 });
  await page.locator('.transport .play-button').click();
  await page.getByRole('button', { name: 'Revenir au début', exact: true }).click();
  console.log('PASS browser: language, reading mode and phone rotation preserve transport');

  await page.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
  await page.getByRole('button', { name: 'Arrêter l’essai', exact: true }).waitFor();
  await page.waitForTimeout(5200); // A real synthetic WAV, including the three-second count-in.
  await page.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer un essai', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(async () => {
    const storage = await import('/src/lib/storage.ts');
    return (await storage.listTakes()).length === 1;
  });
  const take = await page.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts');
    const [summary] = await storage.listTakes(), take = await storage.getTake(summary.id);
    const bytes = new Uint8Array(await take.audio.arrayBuffer());
    const voiced = take.pitches.filter(point => point.frequency > 0).map(point => point.frequency).sort((a,b) => a-b);
    return { id: take.id, duration: take.duration, bytes: bytes.length, header: new TextDecoder().decode(bytes.subarray(0, 4)), format: new TextDecoder().decode(bytes.subarray(8, 12)), pitchCount: take.pitches.length, medianPitch: voiced[Math.floor(voiced.length / 2)], scope: storage.storageScope() };
  });
  assert.equal(take.scope, 'anonymous');
  assert(take.duration >= 4.8 && take.duration < 15 && take.bytes > 44);
  assert.equal(take.header, 'RIFF'); assert.equal(take.format, 'WAVE');
  assert(take.pitchCount > 20 && Math.abs(take.medianPitch - 220) < 3, 'Recorded pitch follows the synthetic 220 Hz input');
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: 'Enregistrements', exact: true }).click();
  await page.locator('.take-card').waitFor();
  await page.locator('.take-card').getByRole('button', { name: 'Réécouter', exact: true }).click();
  await page.locator('.replay-heading').waitFor();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > 0.1; });
  const replayRange = page.getByRole('slider', { name: 'Position dans l’enregistrement', exact: true });
  await replayRange.evaluate((input, time) => { input.value = String(time); input.dispatchEvent(new Event('input', { bubbles: true })); }, Math.min(take.duration - 0.4, 4));
  // A perfectly steady synthetic pitch draws a horizontal SVG path whose
  // geometric height is zero; Playwright's element visibility test excludes it.
  await page.locator('.pitch-confirmed').waitFor({ state: 'attached' });
  assert(await page.locator('.pitch-overlay').isVisible());
  assert((await page.locator('.pitch-confirmed').getAttribute('d')).length > 10, 'Replay restores the saved pitch trace');
  await page.getByRole('button', { name: 'Quitter la réécoute', exact: true }).click();
  console.log('PASS browser: synthetic recording, persisted WAV/pitch and replay after reload');

  const isolation = await page.evaluate(async (takeId) => {
    const s = await import('/src/lib/storage.ts');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const a = 'user:ci-scope-a', b = 'user:ci-scope-b', anonymous = s.ANONYMOUS_SCOPE;
    const source = await s.getTake(takeId, anonymous), [score] = await s.savedScores(anonymous);
    const id = crypto.randomUUID();
    await s.saveTake({ ...source, id, title: 'Scope A' }, a);
    await s.saveTake({ ...source, id, title: 'Scope B' }, b);
    await s.saveScore({ ...score, title: 'Score A' }, a);
    await s.saveScore({ ...score, title: 'Score B' }, b);
    await s.writeSettings(score.id, { ...source.settings, rate: 0.7 }, a);
    await s.writeSettings(score.id, { ...source.settings, rate: 1.2 }, b);
    check((await s.getTake(id, a)).title === 'Scope A' && (await s.getTake(id, b)).title === 'Scope B', 'Takes must be scoped by account');
    check(await s.getTake(id, anonymous) === null && await s.getTake(takeId, a) === null && await s.getTake(takeId, b) === null, 'Anonymous takes must not leak to another scope');
    check((await s.savedScores(a))[0].title === 'Score A' && (await s.savedScores(b))[0].title === 'Score B' && (await s.savedScores(anonymous))[0].title === score.title, 'Scores must be scoped by account');
    check((await s.readSettings(score.id, a)).rate === 0.7 && (await s.readSettings(score.id, b)).rate === 1.2, 'Settings must be scoped by account');
    await s.deleteTake(id, a);
    check(await s.getTake(id, a) === null && (await s.getTake(id, b)).title === 'Scope B' && !!await s.getTake(takeId, anonymous), 'Deleting in one scope must preserve the others');
    check((await s.pendingMutations(anonymous)).length === 0, 'Anonymous resources must not enter an account outbox');
    const liveA = crypto.randomUUID();
    await s.saveTake({ ...source, id: liveA, title: 'Account A to forget' }, a);
    const [staleMutation] = await s.pendingMutations(a);
    const [staleTransfer] = await s.pendingTakes(a);
    await s.forgetAccountScope(a);
    check((await s.savedScores(a)).length === 0 && (await s.listTakes(a)).length === 0 && (await s.takeSyncEntries(a)).length === 0, 'Forgetting an account removes its score and take records');
    check(await s.readSettings(score.id, a) === null && (await s.pendingMutations(a)).length === 0, 'Forgetting an account removes its settings and outbox');
    const rejected = async action => {
      try { await action(); } catch (error) { check(error.message === 'Ce compte a été supprimé.', 'Deleted scope rejection must be explicit'); return; }
      throw new Error('A delayed write restored a deleted account');
    };
    const lateScore = { kind: 'score', id: score.id, data: { ...score, title: 'Stale response' }, revision: 99, deleted: false };
    await rejected(() => s.applyRemoteChanges(a, [lateScore], 99));
    await rejected(() => s.applyRemoteTake(a, liveA, { ...source, id: liveA }));
    await rejected(() => s.acceptMutation(a, staleMutation.mutationId, 'applied', lateScore));
    await rejected(() => s.claimAnonymousLibrary(a));
    await rejected(() => s.claimAnonymousTakes(a));
    await rejected(() => s.failTakeTransfer(staleTransfer, 'Late failure'));
    await rejected(() => s.cacheTakeDigest(staleTransfer, '0'.repeat(64)));
    await rejected(() => s.rearmRejectedMutations(a));
    await rejected(() => s.queueRemoteTakes(a, [{ id: 'late-download', title: 'Synthetic', deleted: false, ready: true }]));
    check((await s.syncQueue(a)).length === 0, 'Deleted account must not regain transfer jobs');
    check((await s.savedScores(a)).length === 0 && (await s.listTakes(a)).length === 0 && await s.syncCursor(a) === 0, 'Stale responses must not recreate a deleted scope or cursor');
    check((await s.savedScores(anonymous))[0].title === score.title && !!await s.getTake(takeId, anonymous), 'A deleted scope cannot consume anonymous scores or takes');
    check((await s.savedScores(b))[0].title === 'Score B' && (await s.getTake(id, b)).title === 'Scope B' && (await s.readSettings(score.id, b)).rate === 1.2, 'Forgetting account A must leave account B intact');
    return { accountA: (await s.listTakes(a)).length, accountB: (await s.listTakes(b)).length, anonymous: (await s.listTakes(anonymous)).length };
  }, take.id);
  assert.deepEqual(isolation, { accountA: 0, accountB: 1, anonymous: 1 });
  console.log('PASS browser: scoped IndexedDB and account deletion reject stale writes without touching other scopes');

  {
    // Restore the score's musical defaults without resetting the practiced passage.
    const resetAccount = { id: 'ci-reset-a', email: 'reset-a@example.invalid' };
    const resetOther = { id: 'ci-reset-b', email: 'reset-b@example.invalid' };
    let resetSession = resetAccount;
    const resetContext = await isolatedContext(resetAccount);
    await resetContext.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname.split('/api/v1/')[1];
      if (path === 'session') return route.fulfill({ json: { user: resetSession, registration: 'open' } });
      if (path === 'changes') return route.fulfill({ json: { cursor: 0, changes: [] } });
      if (path === 'takes') return route.fulfill({ json: { takes: [] } });
      return route.fulfill({ status: 422, json: { message: 'Requête invalide.' } }); // Keep pending writes inspectable.
    });
    const resetPage = await resetContext.newPage(); await resetPage.goto(url); await ready(resetPage);
    const resetXML = `<score-partwise version="4.0"><work><work-title>Synthetic reset</work-title></work><part-list>${[1, 2].map(i => `<score-part id="P${i}"><part-name>Synthetic ${i}</part-name><midi-instrument id="I${i}"><midi-channel>${i}</midi-channel><midi-program>${i === 1 ? 54 : 43}</midi-program></midi-instrument></score-part>`).join('')}</part-list>${[1, 2].map(part => `<part id="P${part}">${Array.from({ length: 16 }, (_, i) => `<measure number="${i + 1}">${i ? '' : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="96"/></direction>'}${Array.from({ length: part === 1 ? 4 : 1 }, () => `<note><pitch><step>${part === 1 ? 'C' : 'E'}</step><octave>${part === 1 ? 4 : 3}</octave></pitch><duration>${part === 1 ? 1 : 4}</duration><type>${part === 1 ? 'quarter' : 'whole'}</type></note>`).join('')}</measure>`).join('')}</part>`).join('')}</score-partwise>`;
    await resetPage.locator('input[type=file]').setInputFiles({ name: 'synthetic-reset.musicxml', mimeType: 'application/xml', buffer: Buffer.from(resetXML) });
    await openImported(resetPage, 'Synthetic reset');
    await resetPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Synthetic reset'); await ready(resetPage);
    const resetId = await resetPage.evaluate(async xml => (await import('/src/lib/storage.ts')).scoreId(xml), resetXML);
    async function resetUI() {
      return resetPage.evaluate(() => ({ rate: document.querySelector('.tempo-control input') ? Number(document.querySelector('.tempo-control input').value) : null, bpm: document.querySelector('.tempo-value strong') ? Number(document.querySelector('.tempo-value strong').textContent) : null, target: Number(document.querySelector('#voice-target').value), parts: [...document.querySelectorAll('.instrument-card')].map(card => ({ volume: Number(card.querySelector('input').value), muted: card.querySelector('.mute-button').getAttribute('aria-pressed') === 'true', solo: card.querySelector('.solo-button').getAttribute('aria-pressed') === 'true', transpose: Number(card.querySelector('.transpose-control span').textContent), program: Number(card.querySelector('select').value) })) }));
    }
    async function resetStored(predicate, scope = `user:${resetAccount.id}`) {
      const deadline = Date.now() + 8000; let value;
      do {
        value = await resetPage.evaluate(async ({ id, scope }) => (await import('/src/lib/storage.ts')).readSettings(id, scope), { id: resetId, scope });
        if (predicate(value)) return value;
        await resetPage.waitForTimeout(25);
      } while (Date.now() < deadline);
      assert.fail(`Reset settings were not persisted: ${JSON.stringify(value)}`);
    }
    const resetNotes = resetPage.locator('.sheet-page .measure').first().locator('.staff').first().locator('.note .notehead');
    await resetPage.getByTitle('Sélectionner un passage à répéter (L)', { exact: true }).click();
    await resetNotes.first().click(); await resetNotes.last().click();
    await resetPage.locator('.loop-region').waitFor();
    await resetPage.locator('.atelier-button').click();
    const channels = await resetPage.locator('#voice-target option').evaluateAll(options => options.map(o => Number(o.value)));
    const defaults = await resetUI(); assert.equal(defaults.bpm, 96); assert.deepEqual(defaults.parts.map(p => p.program), [53, 42]);
    const initial = await resetStored(s => s?.loopEnabled === true);
    const expectedReset = { ...initial, rate: 1, target: channels[0], parts: defaults.parts.map((p, i) => ({ channel: channels[i], ...p })) };
    await resetPage.evaluate(async () => {
      const { AudioPlayer } = await import('/src/lib/audio.ts');
      window.__resetCalls = [];
      for (const method of ['setRate', 'setVolume', 'setMuted', 'setTranspose', 'setProgram', 'pause', 'load', 'seek']) {
        const original = AudioPlayer.prototype[method];
        AudioPlayer.prototype[method] = function(...args) { window.__resetAudio = this; window.__resetCalls.push([method, ...args]); return original.apply(this, args); };
      }
    });
    async function alterSound() {
      // Range input events are also the keyboard/touch path used by the application.
      await resetPage.locator('.tempo-control input').evaluate(input => { input.value = '0.6'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      await resetPage.locator('#voice-target').selectOption(String(channels[1]));
      const cards = resetPage.locator('.instrument-card');
      for (let i = 0; i < 2; i++) {
        await cards.nth(i).locator('select').selectOption('73');
        await cards.nth(i).locator('input').evaluate(input => { input.value = '35'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await cards.nth(i).locator('.transpose-control button').last().click();
      }
      await cards.first().locator('.mute-button').click(); await cards.last().locator('.solo-button').click();
    }
    await alterSound();
    await resetPage.locator('#latency').evaluate(input => { input.value = '120'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await resetStored(s => s?.rate === 0.6 && s.parts.every(p => p.program === 73 && p.volume === 35 && p.transpose === 1));
    await resetPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    await resetPage.locator('.transport .play-button').click();
    await resetPage.waitForFunction(() => document.querySelector('.transport .play-button').classList.contains('is-playing'));
    await resetPage.locator('.atelier-button').click();
    const audioBeforeReset = await resetPage.evaluate(() => {
      const audio = window.__resetAudio, analyser = audio.context.createAnalyser(); audio.synth.connect(analyser); window.__resetAnalyser = analyser;
      window.__resetCalls = []; return { time: audio.time, contextTime: audio.context.currentTime };
    });
    const resetButton = resetPage.getByRole('button', { name: 'Rétablir les réglages de la partition', exact: true });
    await resetButton.click();
    assert.deepEqual(await resetUI(), defaults);
    assert.equal(await resetPage.locator('#latency').inputValue(), '120');
    assert.deepEqual(await resetStored(s => JSON.stringify(s) === JSON.stringify(expectedReset)), expectedReset);
    const appliedReset = await resetPage.evaluate(() => ({ calls: window.__resetCalls, playing: window.__resetAudio.playing, rate: window.__resetAudio.sequencer.playbackRate, contextTime: window.__resetAudio.context.currentTime }));
    assert(appliedReset.playing && appliedReset.contextTime > audioBeforeReset.contextTime); assert.equal(appliedReset.rate, 1);
    assert.deepEqual(appliedReset.calls, [['setRate', 1], ...defaults.parts.flatMap((p, i) => [['setVolume', channels[i], p.volume], ['setMuted', channels[i], false], ['setTranspose', channels[i], 0], ['setProgram', channels[i], p.program]])]);
    await resetPage.waitForFunction(() => { const analyser = window.__resetAnalyser, values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); return values.some(v => Math.abs(v) > 0.001); });
    const queuedReset = await resetPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).pendingMutations('user:ci-reset-a')).filter(m => m.kind === 'settings' && m.id === id).at(-1)?.data, resetId);
    assert.deepEqual(queuedReset, expectedReset, 'Reset is a normal scoped settings mutation, including the unchanged loop');
    await resetPage.reload(); await ready(resetPage); await resetPage.locator('.atelier-button').click();
    assert.deepEqual(await resetUI(), defaults); assert(await resetPage.locator('.loop-region').count());
    assert.deepEqual(await resetStored(s => !!s), expectedReset);

    // Reset during capture is a single musical boundary, keeping the raw WAV/history.
    await alterSound();
    await resetPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    await resetPage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
    await resetPage.waitForFunction(() => document.querySelector('.take-button.recording') && !document.querySelector('.take-button.recording').textContent.includes('…'));
    await resetPage.locator('.atelier-button').click(); await resetButton.click();
    assert.deepEqual(await resetUI(), defaults);
    await resetPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    await resetPage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
    await resetPage.waitForFunction(() => document.querySelector('.take-button')?.disabled === false);
    const resetTake = await resetPage.evaluate(async () => {
      const s = await import('/src/lib/storage.ts'); const [summary] = await s.listTakes(); return s.getTake(summary.id);
    });
    assert.equal(resetTake.settings.rate, 0.6); assert.equal(resetTake.settings.target, channels[1]);
    assert(resetTake.transport.some(p => p.rate === 1 && p.targetChannel === channels[0] && p.transpose === 0));
    assert(await resetPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).getTake(id)).audio.size > 44, resetTake.id));
    await resetPage.getByRole('button', { name: 'Enregistrements', exact: true }).click(); await resetPage.locator('.take-card .review-play').click();
    await resetPage.locator('.replay-heading').waitFor(); await resetPage.locator('.atelier-button').click();
    assert(await resetButton.isEnabled(), 'Reset follows the individual mixer controls during replay');
    assert.equal(await resetPage.locator('#practice-reset-help').innerText(), 'Tempo, voix, mixage, sons et transpositions d’origine. La boucle et le décalage micro sont conservés.');
    async function replayState() {
      return resetPage.evaluate(async id => {
        const take = await (await import('/src/lib/storage.ts')).getTake(id);
        const { audio, ...metadata } = take;
        const player = document.querySelector('audio');
        return { wav: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await audio.arrayBuffer()))), metadata: JSON.stringify(metadata), src: player.getAttribute('src'), rate: player.playbackRate, volume: player.volume };
      }, resetTake.id);
    }
    const replayBefore = await replayState();
    await resetPage.locator('#voice-target').selectOption(String(channels[1]));
    await resetPage.locator('.instrument-card').first().locator('select').selectOption('73');
    await resetPage.locator('.instrument-card').first().locator('.transpose-control button').last().click();
    await resetStored(s => s?.target === channels[1] && s.parts[0].program === 73 && s.parts[0].transpose === 1);
    await resetButton.click();
    assert.deepEqual(await resetUI(), { ...defaults, rate: null, bpm: null });
    assert.deepEqual(await resetStored(s => JSON.stringify(s) === JSON.stringify(expectedReset)), expectedReset, 'Replay resets the current practice settings normally');
    assert.deepEqual(await replayState(), replayBefore, 'Neither individual edits nor reset modify the saved take, WAV or replay source/rate/volume');
    assert(await resetPage.locator('.replay-heading').isVisible());
    await resetPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    await resetPage.getByRole('button', { name: 'Quitter la réécoute', exact: true }).click();

    for (const viewport of [{ width: 600, height: 900 }, { width: 900, height: 500 }]) {
      await resetPage.setViewportSize(viewport); await resetPage.locator('.atelier-button').click();
      await resetButton.scrollIntoViewIfNeeded(); await resetButton.focus();
      const reachable = await resetButton.evaluate(button => { const r = button.getBoundingClientRect(); return r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && button.getAttribute('aria-describedby') === 'practice-reset-help'; });
      assert(reachable, 'Reset remains reachable by touch and keyboard in portrait/landscape');
      await resetPage.keyboard.press('Enter'); assert.deepEqual(await resetUI(), defaults);
      await resetPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    }
    await resetPage.evaluate(async () => {
      const i18n = await import('/src/lib/i18n.ts');
      for (const language of ['en', 'de', 'nl']) for (const key of ['Rétablir les réglages de la partition', 'Tempo, voix, mixage, sons et transpositions d’origine. La boucle et le décalage micro sont conservés.', 'Réglages de la partition rétablis.']) {
        i18n.setLanguage(language); if (i18n.translate(key) === key) throw Error(`Missing ${language} reset translation`);
      }
      i18n.setLanguage('fr');
    });
    const otherSettings = { ...expectedReset, rate: 0.8, target: channels[1], parts: expectedReset.parts.map(p => ({ ...p, transpose: -5 })) };
    await resetPage.evaluate(async ({ id, xml, settings }) => { const s = await import('/src/lib/storage.ts'); await s.saveScore({ id, xml, title: 'Synthetic account B', composer: 'Synthetic', added: 1 }, 'user:ci-reset-b'); await s.writeSettings(id, settings, 'user:ci-reset-b'); }, { id: resetId, xml: resetXML, settings: otherSettings });
    resetSession = resetOther;
    await resetPage.evaluate(async () => { const sync = await import('/src/lib/sync.ts'); await sync.synchronize(); });
    await resetPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Synthetic account B'); await ready(resetPage);
    await resetPage.locator('.atelier-button').click(); assert.equal((await resetUI()).rate, 0.8);
    await resetButton.click();
    assert.deepEqual(await resetStored(s => s?.rate === 1, 'user:ci-reset-b'), expectedReset);
    assert.deepEqual(await resetStored(s => !!s), expectedReset, 'Account A stays unchanged by resetting B');
    await alterSound();
    await resetStored(s => s?.rate === 0.6 && s.parts[0].transpose === 1, 'user:ci-reset-b');
    await resetPage.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function() {
        if (this.name !== 'reset-delayed.musicxml') return read.call(this);
        return new Promise(resolve => { window.__finishResetRead = async () => resolve(await read.call(this)); });
      };
    });
    await resetPage.locator('input[type=file]').setInputFiles({ name: 'reset-delayed.musicxml', mimeType: 'application/xml', buffer: Buffer.from(resetXML.replace('Synthetic reset', 'Synthetic delayed reset')) });
    await resetPage.waitForFunction(() => !!window.__finishResetRead);
    assert(await resetButton.isEnabled(), 'A pending import keeps the current document editable like individual controls');
    assert(await resetPage.locator('#voice-target').isEnabled());
    await resetButton.click();
    assert.deepEqual(await resetUI(), defaults);
    assert.deepEqual(await resetStored(s => s?.rate === 1, 'user:ci-reset-b'), expectedReset);
    await resetPage.evaluate(() => window.__finishResetRead());
    await openImported(resetPage, 'Synthetic delayed reset');
    await resetPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Synthetic delayed reset'); await ready(resetPage);
    assert(await resetButton.isEnabled());
    console.log('PASS score reset: score-derived defaults, live audio/capture, editable replay with immutable WAV, persisted/scoped sync, preserved loop/latency, mobile accessibility and EN/DE/NL');

  }

  // A microphone owns its context listener, even when the audio context outlives it.
  const lifecycleContext = await isolatedContext();
  await lifecycleContext.route('**/microphone-lifecycle', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic microphone lifecycle</title>' }));
  const lifecyclePage = await lifecycleContext.newPage(); await lifecyclePage.goto(`${url}/microphone-lifecycle`);
  const lifecycle = await lifecyclePage.evaluate(async () => {
    const { PitchInput } = await import('/src/lib/pitch.ts');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const add = AudioContext.prototype.addEventListener, remove = AudioContext.prototype.removeEventListener;
    const listeners = new Map();
    const count = context => listeners.get(context)?.size || 0;
    AudioContext.prototype.addEventListener = function(type, listener, options) {
      if (type === 'statechange') {
        if (!listeners.has(this)) listeners.set(this, new Set());
        listeners.get(this).add(listener);
      }
      return add.call(this, type, listener, options);
    };
    AudioContext.prototype.removeEventListener = function(type, listener, options) {
      if (type === 'statechange') listeners.get(this)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    const shared = new AudioContext();
    let foreignChanges = 0, onInterruption;
    const foreignListener = () => foreignChanges++;
    add.call(shared, 'statechange', foreignListener);
    const interruptions = [];
    const input = new PitchInput(() => {}, () => {}, reason => { interruptions.push(reason); onInterruption?.(reason); });
    const getUserMedia = navigator.mediaDevices.getUserMedia;
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        await input.start(shared);
        check(count(shared) === 1, 'One microphone listener must be registered per connection');
        input.stop(); input.stop();
        check(count(shared) === 0, 'Stopping must remove the exact statechange listener');
        check(shared.state === 'running', 'Stopping the microphone must leave its shared context open');
        await shared.suspend(); await shared.resume();
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      check(foreignChanges > 0 && interruptions.length === 0, 'Other listeners survive; stopped sessions do not report context changes');
      await input.start(shared);
      await input.startRecording();
      const deadline = performance.now() + 5000;
      while (!input.recordingData?.chunks.length) {
        check(performance.now() < deadline, 'The synthetic worklet must deliver recorded samples before interruption');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const interrupted = new Promise(resolve => { onInterruption = resolve; });
      await shared.suspend(); await interrupted;
      check(!input.active && interruptions.length === 1 && interruptions[0] === 'interrupted', 'The listener still interrupts an active microphone exactly once');
      const partial = await input.stopRecording();
      check(partial.samples > 0 && partial.audio.size === 44 + partial.samples * 2 && partial.analysisComplete === false, 'Interruption preserves delivered raw WAV frames');
      input.stop();
      check(count(shared) === 0 && shared.state === 'suspended', 'Cleanup detaches the listener after an interruption without closing the shared context');
      await shared.resume();
      await input.start();
      const owned = [...listeners.keys()].find(context => count(context) === 1);
      check(owned && owned !== shared, 'An owned context also receives one listener');
      input.stop();
      check(count(owned) === 0, 'An owned context loses its listener before close');
      await owned.close().catch(() => {});
      check(owned.state === 'closed', 'The owned context closes normally');
      const failing = new AudioContext();
      failing.createMediaStreamSource = () => {
        check(count(failing) === 1, 'The synthetic connection failure occurs after listener registration');
        throw Error('Synthetic media source failure');
      };
      let sourceFailure;
      try { await input.start(failing); } catch (cause) { sourceFailure = cause.message; }
      check(sourceFailure === 'Synthetic media source failure' && count(failing) === 0 && !input.active, 'Failed connection cleanup removes the registered listener');
      check(failing.state === 'running', 'A failed connection does not close a shared context');
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic microphone denial', 'NotAllowedError'); };
      let permissionFailure;
      try { await input.start(shared); } catch (cause) { permissionFailure = cause.name; }
      check(permissionFailure === 'NotAllowedError' && count(shared) === 0, 'Failure before registration is safe to clean up');
      navigator.mediaDevices.getUserMedia = getUserMedia;
      await input.start(shared); input.stop();
      check([...listeners.values()].every(registered => registered.size === 0), 'Reconnects and failures leave no context listeners behind');
      check(interruptions.length === 1, 'Closing stopped contexts does not report another interruption');
      return { cycles: 3, interruptions, partialSamples: partial.samples };
    } finally {
      navigator.mediaDevices.getUserMedia = getUserMedia;
      input.stop();
      remove.call(shared, 'statechange', foreignListener);
      for (const context of new Set([shared, ...listeners.keys()])) if (context.state !== 'closed') await context.close();
      AudioContext.prototype.addEventListener = add; AudioContext.prototype.removeEventListener = remove;
    }
  });
  assert.equal(lifecycle.cycles, 3); assert.deepEqual(lifecycle.interruptions, ['interrupted']); assert(lifecycle.partialSamples > 0);
  console.log('PASS browser: microphone context listeners detach on repeated stop, interruption and failed start; shared/owned context lifetimes and partial WAV preserved');

  // localStorage is optional; IndexedDB, session isolation and live choices remain usable.
  const preferenceAccount = { id: 'ci-preference-user', email: 'preferences@example.invalid' };
  const preferenceXML = title => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${Array.from({ length: 4 }, (_, index) => `<measure number="${index + 1}">${index ? '' : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction>'}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join('')}</part></score-partwise>`;
  for (const failure of ['getter', 'read', 'last-read', 'write', 'available', 'invalid-json', 'invalid-shape']) {
    const preferenceContext = await isolatedContext();
    await preferenceContext.route('**/preference-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta name="theme-color" content="#fff"></head><body><div id="app"></div></body></html>' }));
    await preferenceContext.route('**/scores/*', route => new URL(route.request().url()).pathname.endsWith('catalog.json') ? route.continue() : route.fulfill({ contentType: 'application/xml', body: preferenceXML('Synthetic catalogue') }));
    const accepted = new Map(); let preferenceRevision = 0, preferenceUser = preferenceAccount;
    await preferenceContext.route('**/api/v1/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname.split('/api/v1/')[1];
      if (path === 'session') {
        if (request.method() === 'DELETE') preferenceUser = null;
        return route.fulfill({ json: { user: preferenceUser, registration: 'open' } });
      }
      assert.equal(request.headers()['x-chansonade-user'], preferenceAccount.id);
      if (path === 'mutations') {
        const results = request.postDataJSON().mutations.map(mutation => {
          const resource = accepted.get(mutation.mutationId) || { kind: mutation.kind, id: mutation.id, data: mutation.data, deleted: mutation.deleted, revision: ++preferenceRevision };
          accepted.set(mutation.mutationId, resource);
          return { mutationId: mutation.mutationId, status: 'applied', resource };
        });
        return route.fulfill({ json: { results } });
      }
      if (path === 'changes') return route.fulfill({ json: { cursor: preferenceRevision, changes: [] } });
      if (path === 'takes') return route.fulfill({ json: { takes: [] } });
      if (path.startsWith('takes/') && request.method() === 'POST') return route.fulfill({ json: { take: { ready: true } } });
      throw Error(`Unexpected preference fixture request: ${request.method()} ${path}`);
    });
    const preferencePage = await preferenceContext.newPage();
    await preferencePage.emulateMedia({ colorScheme: 'dark' });
    await preferencePage.goto(`${url}/preference-fixture`);
    const seeded = await preferencePage.evaluate(async ({ account, xml, failure }) => {
      const s = await import('/src/lib/storage.ts');
      const id = await s.scoreId(xml);
      await s.saveScore({ id, xml, title: 'Synthetic retained A', composer: 'Synthetic', added: 1 }, `user:${account.id}`);
      await s.saveScore({ id: 'other-preference-score', xml, title: 'Synthetic retained B', composer: 'Synthetic', added: 1 }, 'user:preference-other');
      const storage = window.localStorage, get = Storage.prototype.getItem;
      storage.setItem('chansonade.microphone', 'synthetic-one'); storage.setItem('chansonade.last', id);
      const invalid = failure === 'invalid-json' || failure === 'invalid-shape';
      storage.setItem('chansonade.language', invalid ? 'invalid-locale' : 'de'); storage.setItem('chansonade.theme', invalid ? 'invalid-theme' : 'light');
      storage.setItem('chansonade.account', failure === 'invalid-json' ? '{' : JSON.stringify(failure === 'invalid-shape' ? { id: 42, email: account.email } : { ...account, email: 'stale-preferences@example.invalid' }));
      window.__storedPreference = key => get.call(storage, key);
      window.__microphoneRequests = []; window.__microphoneStops = 0;
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.__microphoneRequests.push(constraints.audio?.deviceId?.exact || '');
        const stream = await getUserMedia(constraints);
        for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.__microphoneStops++; stop(); }; }
        return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => ['one', 'two'].map(name => ({ deviceId: `synthetic-${name}`, kind: 'audioinput', label: `Synthetic microphone ${name}`, groupId: 'synthetic' }));
      if (failure === 'getter') Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Synthetic storage getter denial', 'SecurityError'); } });
      else if (failure === 'read' || failure === 'last-read') Storage.prototype.getItem = function(key) {
        if (failure === 'read' || key === 'chansonade.last') throw new DOMException('Synthetic preference read denial', 'SecurityError');
        return get.call(this, key);
      };
      else if (failure === 'write') {
        Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new DOMException('Synthetic preference quota', 'QuotaExceededError'); };
      }
      const sync = await import('/src/lib/sync.ts');
      let cached; const unsubscribe = sync.syncState.subscribe(state => cached = state.user); unsubscribe();
      return { id, cached };
    }, { account: preferenceAccount, xml: preferenceXML('Synthetic retained A'), failure });
    const retainedId = seeded.id;
    const invalidValues = failure === 'invalid-json' || failure === 'invalid-shape';
    const readsBlocked = failure === 'getter' || failure === 'read';
    const fallbackValues = readsBlocked || invalidValues;
    assert.deepEqual(seeded.cached, fallbackValues ? null : { ...preferenceAccount, email: 'stale-preferences@example.invalid' }, `${failure}: cached identity is parsed and validated before checking the server`);
    await preferencePage.evaluate(async () => { await import('/src/main.ts'); });
    await preferencePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
    const expectedTitle = ['getter', 'read', 'last-read', 'invalid-json', 'invalid-shape'].includes(failure) ? await preferencePage.evaluate(async () => (await import('/src/lib/score.ts')).examples[0].title) : 'Synthetic retained A';
    await preferencePage.waitForFunction(title => document.querySelector('h1')?.textContent === title && document.querySelector('.play-button')?.disabled === false && !document.querySelector('.loading-overlay') && !document.querySelector('.play-button .spin'), expectedTitle);
    assert.equal(await preferencePage.locator('html').getAttribute('lang'), fallbackValues ? 'fr' : 'de');
    assert.equal(await preferencePage.locator('html').getAttribute('data-theme'), fallbackValues ? 'dark' : 'light');
    // Bring every scenario to French using a real preference control.
    await preferencePage.locator('.display-preferences summary').click();
    await preferencePage.locator('.display-preferences').getByRole('button', { name: 'Français', exact: true }).click();
    await preferencePage.locator('.mic-button').click();
    await preferencePage.waitForFunction(() => document.querySelector('.mic-button.active') && !document.querySelector('.mic-button:disabled'));
    await preferencePage.locator('.atelier-button').click();
    assert.equal(await preferencePage.locator('#microphone').inputValue(), readsBlocked ? '' : 'synthetic-one');
    await preferencePage.locator('#microphone').selectOption('synthetic-two');
    await preferencePage.waitForFunction(() => !document.querySelector('#microphone').disabled && document.querySelector('.mic-button.active'));
    assert.deepEqual(await preferencePage.evaluate(() => window.__microphoneRequests), [readsBlocked ? '' : 'synthetic-one', 'synthetic-two'], `${failure}: the selected device must be applied even without persistence`);
    assert.equal(await preferencePage.evaluate(() => window.__microphoneStops), 1);
    await preferencePage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
    await preferencePage.locator('.play-button').click();
    await preferencePage.waitForFunction(() => document.querySelector('.play-button.is-playing'));
    await preferencePage.locator('.display-preferences summary').click();
    await preferencePage.locator('.display-preferences').getByRole('button', { name: 'English', exact: true }).click();
    await preferencePage.locator('.display-preferences summary').click();
    await preferencePage.getByLabel('Note notation', { exact: true }).selectOption('english');
    await preferencePage.getByLabel('Note notation', { exact: true }).selectOption('solfege');
    await preferencePage.locator('.display-preferences summary').click();
    const previousTheme = await preferencePage.locator('html').getAttribute('data-theme');
    await preferencePage.locator('.theme-toggle').click();
    assert.equal(await preferencePage.locator('html').getAttribute('lang'), 'en');
    assert.notEqual(await preferencePage.locator('html').getAttribute('data-theme'), previousTheme);
    assert(await preferencePage.locator('.play-button.is-playing').count(), 'Language, notation and theme remain usable without restarting playback');
    assert.equal(await preferencePage.evaluate(() => window.__microphoneRequests.length), 2, 'Language, notation and theme do not restart the microphone');
    await preferencePage.locator('.display-preferences summary').click();
    await preferencePage.locator('.display-preferences').getByRole('button', { name: 'Français', exact: true }).click();
    await preferencePage.locator('.play-button').click();
    await preferencePage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
    await preferencePage.locator('.take-button.recording').waitFor();
    await preferencePage.waitForTimeout(250); // Real synthetic WAV frames, before the count-in completes.
    await preferencePage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
    await preferencePage.waitForFunction(() => { const button = document.querySelector('.take-button'); return button && !button.disabled && !button.classList.contains('recording'); });
    const importedTitle = `Synthetic preference import ${failure}`;
    await preferencePage.locator('input[type="file"]').setInputFiles({ name: 'preference-import.musicxml', mimeType: 'application/xml', buffer: Buffer.from(preferenceXML(importedTitle)) });
    await openImported(preferencePage, importedTitle);
    await preferencePage.waitForFunction(title => document.querySelector('h1')?.textContent === title && !document.querySelector('.loading-overlay') && document.querySelector('.play-button')?.disabled === false && !document.querySelector('.play-button .spin'), importedTitle);
    await preferencePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
    const stored = await preferencePage.evaluate(async () => {
      const s = await import('/src/lib/storage.ts');
      const scores = await s.savedScores(), [summary] = await s.listTakes(), take = summary ? await s.getTake(summary.id) : null;
      const sync = await import('/src/lib/sync.ts');
      let user; const unsubscribe = sync.syncState.subscribe(state => user = state.user); unsubscribe();
      return { scope: s.storageScope(), user, scores, take: take && { audioBytes: take.audio.size, samples: take.samples }, other: await s.savedScores('user:preference-other'), microphone: window.__storedPreference('chansonade.microphone'), last: window.__storedPreference('chansonade.last'), language: window.__storedPreference('chansonade.language'), theme: window.__storedPreference('chansonade.theme'), account: window.__storedPreference('chansonade.account'), errors: document.querySelectorAll('.error-card').length };
    });
    assert.equal(stored.scope, `user:${preferenceAccount.id}`); assert(stored.scores.some(score => score.id === retainedId));
    assert(stored.scores.some(score => score.title === importedTitle)); assert(!stored.scores.some(score => score.id === 'other-preference-score'));
    assert.equal(stored.other[0].title, 'Synthetic retained B'); assert(stored.take?.audioBytes > 44 && stored.take.samples > 0); assert.equal(stored.errors, 0);
    if (failure === 'getter' || failure === 'write') { assert.equal(stored.microphone, 'synthetic-one'); assert.equal(stored.last, retainedId); }
    else { assert.equal(stored.microphone, 'synthetic-two'); assert.equal(stored.last, stored.scores.find(score => score.title === importedTitle).id); }
    assert.deepEqual(stored.user, preferenceAccount, 'The confirmed identity is independent of the optional account cache');
    if (failure === 'getter' || failure === 'write') {
      assert.equal(stored.language, 'de'); assert.equal(stored.theme, 'light');
      assert.deepEqual(JSON.parse(stored.account), { ...preferenceAccount, email: 'stale-preferences@example.invalid' });
    } else {
      assert.equal(stored.language, 'fr'); assert.equal(stored.theme, fallbackValues ? 'light' : 'dark');
      assert.deepEqual(JSON.parse(stored.account), preferenceAccount, 'Session confirmation refreshes the persisted identity');
    }
    await preferencePage.locator('.mic-button').click();
    await preferencePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).logout(); });
    const loggedOut = await preferencePage.evaluate(async () => {
      const s = await import('/src/lib/storage.ts'), sync = await import('/src/lib/sync.ts');
      let user; const unsubscribe = sync.syncState.subscribe(state => user = state.user); unsubscribe();
      return { user, scope: s.storageScope(), account: window.__storedPreference('chansonade.account'), scores: await s.savedScores('user:ci-preference-user'), takes: await s.listTakes('user:ci-preference-user'), other: await s.savedScores('user:preference-other') };
    });
    assert.equal(loggedOut.user, null); assert.equal(loggedOut.scope, 'anonymous');
    assert.equal(loggedOut.account, failure === 'getter' || failure === 'write' ? stored.account : null, 'Removing the optional cache must not prevent logout');
    assert.equal(loggedOut.scores.length, stored.scores.length); assert.equal(loggedOut.takes.length, 1); assert.equal(loggedOut.other[0].title, 'Synthetic retained B');
    console.log(`PASS optional preferences ${failure}: defaults/validation, live microphone/theme/language, import/WAV, account cache update/removal and scope isolation`);
  }

  // Delay only delivery of real synthetic detector output, including its flush.
  const musicalContext = await isolatedContext();
  await musicalContext.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  await musicalContext.addInitScript(() => {
    const NativeWorker = window.Worker;
    const onmessage = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage');
    window.__pitchQueue = []; window.__holdPitch = false; window.__releasedAtFlush = false;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = new target(...args);
      if (String(args[0]).includes('pitch-worker')) Object.defineProperty(worker, 'onmessage', { set(listener) {
        if (!listener) { onmessage.set.call(worker, null); return; }
        const deliver = event => listener.call(worker, event);
        window.__releasePitch = () => {
          const queued = window.__pitchQueue; window.__pitchQueue = [];
          for (const event of queued) deliver(event);
        };
        onmessage.set.call(worker, event => {
          if (event.data.type === 'pitch' && window.__holdPitch) { window.__pitchQueue.push(event); return; }
          if (event.data.type === 'flushed' && window.__holdPitch) {
            window.__releasedAtFlush = true; window.__holdPitch = false; window.__releasePitch();
          }
          deliver(event);
        });
      } });
      return worker;
    } });
  });
  const musicalPage = await musicalContext.newPage(); await musicalPage.goto(url); await ready(musicalPage);
  const voicesXML = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Synthetic musical context</work-title></work><part-list>${[1, 2].map(index => `<score-part id="P${index}"><part-name>Voice ${index}</part-name><score-instrument id="I${index}"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I${index}"><midi-channel>${index}</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`).join('')}</part-list>${['C', 'E'].map((step, index) => `<part id="P${index + 1}">${Array.from({ length: 8 }, (_, bar) => `<measure number="${bar + 1}">${bar ? '' : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="60"/></direction>'}<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join('')}</part>`).join('')}</score-partwise>`;
  await musicalPage.locator('input[type="file"]').setInputFiles({ name: 'musical-context.musicxml', mimeType: 'application/xml', buffer: Buffer.from(voicesXML) });
    await openImported(musicalPage, 'Synthetic musical context');
  await musicalPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Synthetic musical context'); await ready(musicalPage);
  await musicalPage.getByRole('button', { name: 'Voix & instruments', exact: true }).click();
  const channels = await musicalPage.locator('#voice-target option').evaluateAll(options => options.map(option => Number(option.value)));
  assert.equal(channels.length, 2);
  await musicalPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
  await musicalPage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
  await musicalPage.waitForFunction(() => document.querySelector('.take-button.recording') && document.querySelector('.play-button.is-playing'));
  await musicalPage.getByRole('button', { name: 'Voix & instruments', exact: true }).click();
  await musicalPage.evaluate(() => { window.__holdPitch = true; });
  const queuedProbes = async () => {
    await musicalPage.waitForFunction(() => window.__pitchQueue.flatMap(event => event.data.confirmed).length >= 20);
    return musicalPage.evaluate(() => ({
      confirmed: window.__pitchQueue.flatMap(event => event.data.confirmed).slice(-3),
      pending: window.__pitchQueue.at(-1).data.pending.at(-1),
    }));
  };
  const beforeVoice = await queuedProbes();
  // These changes share one browser turn: no animation frame can fill gaps.
  await musicalPage.evaluate(channel => {
    const select = document.querySelector('#voice-target'); select.value = String(channel); select.dispatchEvent(new Event('change', { bubbles: true }));
    const up = document.querySelectorAll('.instrument-card')[1].querySelector('.transpose-control button:last-child');
    up.click(); up.click();
    window.__releasePitch();
  }, channels[1]);
  const beforeTranspose = await queuedProbes();
  assert(beforeTranspose.pending.frequency > 0);
  await musicalPage.evaluate(() => {
    document.querySelectorAll('.instrument-card')[1].querySelector('.transpose-control button:last-child').click();
    window.__releasePitch();
  });
  const expectedCents = Math.round((69 + 12 * Math.log2(beforeTranspose.pending.frequency / 440) - 64 - 2) * 100);
  assert.equal(await musicalPage.locator('.mic-button small').innerText(), `${expectedCents > 0 ? '+' : ''}${expectedCents} cents`, 'Delayed provisional pitch uses the transpose at capture, not the latest control value');
  const beforeFlush = await queuedProbes();
  const lastWindow = await musicalPage.evaluate(() => {
    const time = window.__pitchQueue.at(-1).data.pending.at(-1).time;
    document.querySelectorAll('.instrument-card')[1].querySelector('.transpose-control button:last-child').click();
    return time;
  });
  // Keep the last change inside captured audio, not beyond the final WAV frame.
  await musicalPage.waitForFunction(time => window.__pitchQueue.at(-1).data.pending.at(-1)?.time > time + .1, lastWindow);
  await musicalPage.evaluate(() => document.querySelector('.take-button.recording').click());
  await musicalPage.waitForFunction(() => {
    const button = document.querySelector('.take-button');
    return button && !button.disabled && !button.classList.contains('recording');
  });
  const musicalTake = await musicalPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    const scope = s.storageScope(), [summary] = await s.listTakes(scope);
    const take = summary ? await s.getTake(summary.id, scope) : null;
    if (!take) throw Error(`Synthetic take unavailable in ${scope}`);
    const { takePitchSamples, takeMoment } = await import('/src/lib/take-playback.ts');
    return { ...take, audio: { size: take.audio.size }, replay: takePitchSamples(take, { parts: [{ channel: take.settings.target, staves: [99] }] }), moments: take.transport.map(point => takeMoment(take, point.time)), releasedAtFlush: window.__releasedAtFlush };
  });
  assert(musicalTake.analysisComplete); assert(musicalTake.audio.size > 44); assert(musicalTake.releasedAtFlush);
  for (const [probes, channel, staff, transpose, expectedPitch] of [
    [beforeVoice.confirmed, channels[0], 1, 0, 60],
    [beforeTranspose.confirmed, channels[1], 2, 2, 66],
    [beforeFlush.confirmed, channels[1], 2, 3, 67],
  ]) for (const probe of probes) {
    const point = musicalTake.pitches.find(point => Math.abs(point.time - (probe.time - musicalTake.captureStartedAt)) < 1e-9);
    assert(point, 'A delayed confirmation is retained, including at capture flush');
    assert.equal(point.targetChannel, channel); assert.equal(point.staff, staff); assert.equal(point.transpose, transpose); assert.equal(point.expectedPitch, expectedPitch); assert(point.noteId);
    for (const field of ['frequency', 'rawFrequency', 'clarity', 'rms', 'midi', 'cents']) assert.equal(point[field], probe[field], `Acoustic ${field} must be unchanged`);
    const replay = musicalTake.replay.find(sample => sample.captureTime === point.time);
    assert.equal(replay.targetChannel, channel); assert.equal(replay.staff, staff); assert.equal(replay.transpose, transpose); assert.equal(replay.frequency, probe.frequency);
  }
  for (const transpose of [0, 1, 2, 3, 4]) assert(musicalTake.transport.some(point => point.targetChannel === channels[1] && point.transpose === transpose), `Immediate target/transpose ${transpose} boundary must be saved`);
  assert(musicalTake.moments.some(point => point.targetChannel === channels[1] && point.transpose === 4));
  console.log('PASS browser: delayed provisional/confirmed/flush pitch retains captured target, staff, transpose and expected note; acoustic fields and replay remain unchanged; WAV saved; musical boundaries are recorded between animation frames');

  // Failed authentication must release its suspension and resume the same account.
  const authAccount = { id: 'ci-auth-resume', email: 'auth-resume@example.invalid' };
  const authContext = await isolatedContext(authAccount);
  await authContext.route('**/auth-resume-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic authentication</title>' }));
  let authFault, timedOutAuth, authSession = authAccount, authOffline = false, sessionReads = 0, changeReads = 0, rejectedPosts = 0, authRevision = 0, uploadedAuthTake = false;
  const authChanges = [];
  await authContext.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.split('/api/v1/')[1];
    if (authFault && path === authFault.path && request.method() === authFault.method) {
      if (authFault.failure === 'network') return route.abort('internetdisconnected');
      if (authFault.failure === 'timeout') { timedOutAuth = route; return; }
      return route.fulfill({ status: authFault.failure, json: { message: 'Requête invalide.' } });
    }
    if (path === 'session' && request.method() === 'GET') {
      sessionReads++;
      if (authOffline) return route.abort('internetdisconnected');
      return route.fulfill({ json: { user: authSession, registration: 'open' } });
    }
    assert.equal(request.headers()['x-chansonade-user'], authAccount.id);
    if (path === 'mutations') { rejectedPosts++; return route.fulfill({ status: 422, json: { message: 'Requête invalide.' } }); }
    if (path === 'changes') {
      changeReads++;
      const cursor = Number(new URL(request.url()).searchParams.get('cursor'));
      return route.fulfill({ json: { cursor: authRevision, changes: authChanges.filter(resource => resource.revision > cursor) } });
    }
    if (path === 'takes') return route.fulfill({ json: { takes: uploadedAuthTake ? [{ id: 'auth-kept-take', title: 'Synthetic preserved take', ready: true, deleted: false }] : [] } });
    if (path === 'takes/auth-kept-take' && request.method() === 'POST') { uploadedAuthTake = true; return route.fulfill({ json: { take: { ready: true } } }); }
    if (path === 'account' && request.method() === 'DELETE') { authSession = null; return route.fulfill({ json: { deleted: true } }); }
    throw Error(`Unexpected authentication fixture request: ${request.method()} ${path}`);
  });
  const authPage = await authContext.newPage(); await authPage.goto(`${url}/auth-resume-fixture`);
  await authPage.clock.install(); await authPage.clock.pauseAt(new Date(Date.now() + 1000));
  await authPage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'), s = await import('/src/lib/storage.ts');
    const { microphoneWav } = await import('/src/lib/wav.ts');
    window.__stopAuthSync = sync.startSync(); await sync.synchronize();
    const xml = '<score-partwise version="4.0"><part-list/></score-partwise>';
    const score = { id: 'auth-refused', title: 'x'.repeat(501), composer: 'Synthetic', xml, added: 1 };
    await s.saveScore(score);
    await s.saveScore({ ...score, id: 'other-refused', title: 'Other scope' }, 'user:auth-other');
    await s.releaseRejectedMutation((await s.pendingMutations('user:auth-other'))[0], 'Other scope refusal');
    await s.saveTake({ id: 'auth-kept-take', createdAt: 1, title: 'Synthetic preserved take', scoreId: score.id, scoreXML: xml, duration: 64 / 48000, sampleRate: 48000, samples: 64, captureStartedAt: 0, settings: { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] }, latencyMs: 0, detector: { name: 'Synthetic' }, pitches: [], transport: [], audio: microphoneWav([new Float32Array(64)], 48000) });
    await sync.synchronize();
    window.__deletedAuthScopes = [];
  });
  assert.equal(rejectedPosts, 1);
  const authSnapshot = () => authPage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'), s = await import('/src/lib/storage.ts');
    await new Promise(resolve => {
      const unsubscribe = sync.syncState.subscribe(state => { if (!state.busy) queueMicrotask(() => { unsubscribe(); resolve(); }); });
    });
    let state; const unsubscribe = sync.syncState.subscribe(value => state = value); unsubscribe();
    return { state, scope: s.storageScope(), scores: await s.savedScores(), queue: await s.pendingMutations(s.storageScope()), takes: await s.listTakes(), other: await s.pendingMutations('user:auth-other'), deleted: window.__deletedAuthScopes };
  });
  const invokeFailedAuth = action => authPage.evaluate(async action => {
    const sync = await import('/src/lib/sync.ts');
    const actions = {
      login: () => sync.login('auth-resume@example.invalid', 'synthetic-wrong-password'),
      register: () => sync.createAccount('auth-resume@example.invalid', 'synthetic-password'),
      logout: () => sync.logout(),
      reset: () => sync.resetPassword('synthetic-expired-token', 'synthetic-password'),
      delete: () => sync.deleteAccount('synthetic-wrong-password', scope => window.__deletedAuthScopes.push(scope)),
    };
    try { await actions[action](); return { resolved: true }; }
    catch (cause) { return { name: cause.name, message: cause.message }; }
  }, action);
  for (const [action, path, method, failure] of [
    ['login', 'session', 'POST', 401], ['delete', 'account', 'DELETE', 403],
    ['register', 'accounts', 'POST', 400], ['logout', 'session', 'DELETE', 500], ['reset', 'password-reset', 'POST', 403],
    ['login', 'session', 'POST', 'network'], ['delete', 'account', 'DELETE', 'network'],
    ['login', 'session', 'POST', 'timeout'], ['delete', 'account', 'DELETE', 'timeout'],
  ]) {
    authFault = { path, method, failure };
    const beforeSessions = sessionReads, beforeChanges = changeReads;
    const requested = authPage.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/api/v1/${path}`) && request.method() === method);
    const attempt = invokeFailedAuth(action);
    await requested;
    if (failure === 'timeout') await authPage.clock.runFor(8_000);
    const error = await attempt;
    if (timedOutAuth) { await timedOutAuth.abort().catch(() => {}); timedOutAuth = null; }
    assert.equal(error.resolved, undefined, `${action}/${failure}: authentication still rejects`);
    if (typeof failure === 'number') assert.equal(error.message, 'Requête invalide.');
    else assert.equal(error.name, failure === 'timeout' ? 'AbortError' : 'TypeError');
    assert.equal(sessionReads, beforeSessions + 1, `${action}/${failure}: failed authentication must restart synchronization without another user event`);
    assert.equal(changeReads, beforeChanges + 1);
    const id = `remote-after-${action}-${failure}`;
    authChanges.push({ kind: 'score', id, data: { id, title: id, composer: 'Synthetic', xml: '<score-partwise/>', added: 1 }, deleted: false, revision: ++authRevision });
    const poll = authPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/v1/changes'));
    await authPage.clock.runFor(30_000); await poll;
    const snapshot = await authSnapshot();
    assert.equal(sessionReads, beforeSessions + 2, `${action}/${failure}: the next periodic cycle must also run`);
    assert(snapshot.scores.some(score => score.id === id), 'Periodic synchronization must apply new remote data');
    assert.equal(snapshot.state.user.id, authAccount.id); assert.equal(snapshot.scope, `user:${authAccount.id}`);
    assert(snapshot.scores.some(score => score.id === 'auth-refused'));
    assert(snapshot.takes.some(take => take.id === 'auth-kept-take' && take.synced));
    assert.equal(snapshot.queue[0].attempt.state, 'rejected'); assert.equal(rejectedPosts, 1, 'An unsuccessful authentication must not rearm unchanged rejected payloads');
    assert.equal(snapshot.other[0].attempt.error, 'Other scope refusal'); assert.deepEqual(snapshot.deleted, []);
  }
  // A still-unavailable API must keep polling until the network recovers.
  authFault = { path: 'session', method: 'POST', failure: 'network' }; authOffline = true;
  const offlineReads = sessionReads;
  assert.equal((await invokeFailedAuth('login')).name, 'TypeError');
  assert.equal(sessionReads, offlineReads + 1);
  assert.equal((await authSnapshot()).state.status, 'Hors ligne');
  authOffline = false;
  const recoveredPoll = authPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/v1/changes'));
  await authPage.clock.runFor(30_000); await recoveredPoll;
  assert.equal((await authSnapshot()).state.available, true);
  assert.equal(sessionReads, offlineReads + 2);
  // Releasing authentication must still respect recording suspension and stop.
  authFault = { path: 'session', method: 'POST', failure: 401 };
  await authPage.evaluate(async () => { (await import('/src/lib/sync.ts')).setTakeSyncPaused(true); });
  let suspendedReads = sessionReads;
  assert.equal((await invokeFailedAuth('login')).message, 'Requête invalide.');
  await authPage.clock.runFor(90_000); assert.equal(sessionReads, suspendedReads);
  let resumed = authPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/v1/changes'));
  await authPage.evaluate(async () => { (await import('/src/lib/sync.ts')).setTakeSyncPaused(false); });
  await authPage.clock.runFor(1); await resumed; await authSnapshot();
  assert.equal(sessionReads, suspendedReads + 1);
  await authPage.evaluate(() => window.__stopAuthSync());
  suspendedReads = sessionReads;
  assert.equal((await invokeFailedAuth('login')).message, 'Requête invalide.');
  await authPage.clock.runFor(90_000); assert.equal(sessionReads, suspendedReads);
  resumed = authPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/v1/changes'));
  await authPage.evaluate(async () => { window.__stopAuthSync = (await import('/src/lib/sync.ts')).startSync(); });
  await resumed; await authSnapshot(); assert.equal(sessionReads, suspendedReads + 1);
  // The successful deletion still clears only its own scope and adopts logout.
  authFault = null;
  await authPage.evaluate(async () => { await (await import('/src/lib/sync.ts')).deleteAccount('synthetic-correct-password', scope => window.__deletedAuthScopes.push(scope)); });
  const deletedAuth = await authSnapshot();
  assert.equal(deletedAuth.state.user, null); assert.equal(deletedAuth.scope, 'anonymous');
  assert.deepEqual(deletedAuth.deleted, [`user:${authAccount.id}`]);
  assert.equal(deletedAuth.other[0].attempt.error, 'Other scope refusal');
  assert.deepEqual(await authPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    return [(await s.savedScores('user:ci-auth-resume')).length, (await s.listTakes('user:ci-auth-resume')).length, (await s.syncQueue('user:ci-auth-resume')).length];
  }), [0, 0, 0]);
  await authPage.evaluate(() => window.__stopAuthSync());
  console.log('PASS browser: failed authentication/deletion (HTTP, network, timeout) preserves errors, account data and rejected payloads; immediate and periodic sync resume, recording pause and stop remain respected');

  // Lost acknowledgement: apply once on the mock server, abort the response,
  // then acknowledge the same immutable mutation ID on the next attempt.
  const account = { id: 'ci-sync-user', email: 'synthetic@example.invalid' };
  const syncContext = await isolatedContext(account);
  const resources = new Map(), receipts = new Map(), attempts = [];
  let revision = 0, applied = 0, failed = false, networkRestored = false;
  await syncContext.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.split('/api/v1/')[1];
    if (path === 'session') return route.fulfill({ json: { user: account, registration: 'open' } });
    assert.equal(request.headers()['x-chansonade-user'], account.id, 'Sync requests bind the active account');
    if (path.startsWith('changes?') || path === 'changes') {
      const cursor = Number(new URL(request.url()).searchParams.get('cursor') || 0);
      return route.fulfill({ json: { cursor: revision, changes: [...resources.values()].filter(resource => resource.revision > cursor) } });
    }
    if (path === 'takes') return route.fulfill({ json: { takes: [] } });
    if (path === 'mutations' && request.method() === 'POST') {
      const { mutations } = request.postDataJSON();
      const results = mutations.map(mutation => {
        attempts.push(mutation.mutationId);
        let resource = receipts.get(mutation.mutationId);
        if (!resource) {
          const previous = resources.get(`${mutation.kind}:${mutation.id}`);
          assert.equal(mutation.baseRevision, previous?.revision || 0);
          resource = { kind: mutation.kind, id: mutation.id, data: mutation.data, deleted: mutation.deleted, revision: ++revision };
          resources.set(`${mutation.kind}:${mutation.id}`, resource); receipts.set(mutation.mutationId, resource); applied++;
        }
        return { mutationId: mutation.mutationId, status: 'applied', resource };
      });
      if (!networkRestored) { failed = true; return route.abort('internetdisconnected'); }
      return route.fulfill({ json: { results } });
    }
    throw new Error(`Unexpected mock API request: ${request.method()} ${path}`);
  });
  const syncPage = await syncContext.newPage(); await syncPage.goto(url); await ready(syncPage);
  await syncPage.evaluate(async () => {
    const { synchronize } = await import('/src/lib/sync.ts'); await synchronize();
    const s = await import('/src/lib/storage.ts');
    const xml = '<score-partwise version="4.0"><work><work-title>CI sync resource</work-title></work><part-list/></score-partwise>';
    await s.saveScore({ id: await s.scoreId(xml), title: 'CI sync resource', composer: 'Synthetic', xml, added: Date.now() });
    await synchronize();
  });
  assert(failed, 'The first mutation response is deliberately lost');
  const pending = await syncPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts'); return s.pendingMutations(s.storageScope());
  });
  assert.equal(pending.length, 1, 'A lost response preserves the outbox');
  assert.equal(pending[0].mutationId, attempts[0]); assert.equal(pending[0].attempt.state, 'sent');
  networkRestored = true;
  await syncPage.evaluate(async () => { const { synchronize } = await import('/src/lib/sync.ts'); await synchronize(); });
  await syncPage.waitForFunction(async () => { const s = await import('/src/lib/storage.ts'); return (await s.pendingMutations(s.storageScope())).length === 0; });
  const drained = await syncPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts'); return { pending: (await s.pendingMutations(s.storageScope())).length, scores: (await s.savedScores()).filter(score => score.title === 'CI sync resource').length, cursor: await s.syncCursor(s.storageScope()) };
  });
  assert.equal(drained.pending, 0); assert.equal(drained.scores, 1); assert.equal(drained.cursor, 1);
  assert(attempts.length >= 2); assert(attempts.every(id => id === attempts[0])); assert.equal(applied, 1); assert.equal(resources.size, 1);
  console.log('PASS browser: lost sync response preserves and retries the same mutation without duplicate writes');
  // Reject individual resources without blocking later mutations or WAVs.
  const failureAccount = { id: 'ci-failure-user', email: 'failures@example.invalid' };
  const failureContext = await isolatedContext(failureAccount);
  let fixture, quota = true, corrupt = true, remoteMode = 'initial', fault = 0, refusalStatus = 400;
  let declarations = 0, uploaded = 0, goodMutations = 0;
  const requested = [], mutationAttempts = [];
  let hold, entered;
  await failureContext.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.split('/api/v1/')[1];
    if (path === 'session') return route.fulfill({ json: { user: failureAccount, registration: 'open' } });
    assert.equal(request.headers()['x-chansonade-user'], failureAccount.id);
    if (path === 'mutations') {
      const mutation = request.postDataJSON().mutations[0];
      mutationAttempts.push(mutation);
      if (mutation.data?.title?.length > 500) return route.fulfill({ status: refusalStatus, json: { message: 'Requête invalide.' } });
      goodMutations++;
      return route.fulfill({ json: { results: [{ mutationId: mutation.mutationId, status: 'applied', resource: { kind: mutation.kind, id: mutation.id, data: mutation.data, deleted: mutation.deleted, revision: goodMutations } }] } });
    }
    if (path === 'changes') return route.fulfill({ json: { cursor: goodMutations, changes: [] } });
    if (path === 'takes') {
      const ids = !fixture ? [] : remoteMode === 'initial' ? ['remote-bad', 'remote-good', 'audio'] : ['remote-fault', 'remote-z-after'];
      return route.fulfill({ json: { takes: ids.map(id => ({ id, title: id, ready: true, deleted: false, audioBytes: fixture.bytes.length, audioSha256: fixture.digest })) } });
    }
    requested.push(path);
    if (path === 'takes/quota-upload' && request.method() === 'POST') {
      declarations++;
      assert.equal(request.postDataJSON().audioSha256, fixture.digest);
      assert.equal(request.postDataJSON().metadata.input.label, '');
      assert.equal(request.postDataJSON().metadata.input.settings.deviceId, undefined);
      if (quota) return route.fulfill({ status: 413, json: { message: 'Quota synthétique.' } });
      return route.fulfill({ json: { take: { ready: false } } });
    }
    if (path === 'takes/quota-upload/audio' && request.method() === 'PUT') {
      assert.deepEqual(request.postDataBuffer(), Buffer.from(fixture.bytes)); uploaded++;
      return route.fulfill({ json: { take: { ready: true } } });
    }
    const id = path.split('/')[1];
    if (id === 'remote-fault') {
      if (hold) { entered(); await hold; return route.abort('aborted'); }
      if (fault === 'network') return route.abort('internetdisconnected');
      if (typeof fault === 'number' && fault) return route.fulfill({ status: fault, json: { message: 'Erreur synthétique.' } });
      if (fault === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
      if (fault === 'metadata') return route.fulfill({ json: { metadata: { ...fixture.metadata, id: 'wrong-id' } } });
    }
    if (path.split('/')[2] === 'audio') {
      const bytes = Buffer.from(fixture.bytes);
      if (id === 'remote-bad' && corrupt) bytes[bytes.length - 1] ^= 1;
      return route.fulfill({ contentType: 'audio/wav', body: bytes });
    }
    return route.fulfill({ json: { metadata: { ...fixture.metadata, id, title: id } } });
  });
  const failurePage = await failureContext.newPage(); await failurePage.goto(url); await ready(failurePage);
  await failurePage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'); await sync.synchronize(); sync.setTakeSyncPaused(true);
  });
  fixture = await failurePage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    const { microphoneWav } = await import('/src/lib/wav.ts');
    const settings = { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] };
    const audio = microphoneWav([new Float32Array(64).fill(0.25)], 48000);
    const metadata = { id: 'quota-upload', createdAt: 1, title: 'quota-upload', scoreId: 'synthetic', scoreXML: '<score-partwise/>', duration: 64 / 48000, sampleRate: 48000, samples: 64, captureStartedAt: 0, settings, latencyMs: 0, detector: { name: 'Synthetic' }, pitches: [], transport: [], input: { label: 'Synthetic microphone', settings: { deviceId: 'private-device', sampleRate: 48000 } } };
    const bytes = [...new Uint8Array(await audio.arrayBuffer())];
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
    await s.saveScore({ id: 'a-invalid', title: 'x'.repeat(501), composer: 'Synthetic', xml: '<score-partwise/>', added: 1 });
    await s.saveScore({ id: 'b-valid', title: 'Valid resource', composer: 'Synthetic', xml: '<score-partwise/>', added: 2 });
    await s.saveTake({ ...metadata, audio });
    await s.saveScore({ id: 'other-account', title: 'Other account', composer: 'Synthetic', xml: '<score-partwise/>', added: 1 }, 'user:other-synthetic');
    window.__digestCalls = 0;
    const digestOriginal = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (...args) => { window.__digestCalls++; return digestOriginal(...args); };
    return { metadata, bytes, digest };
  });
  await failurePage.clock.install();
  await failurePage.clock.pauseAt(new Date(Date.now() + 1000));
  await failurePage.evaluate(() => {
    window.__syncDelays = [];
    const timeoutOriginal = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => { window.__syncDelays.push(delay); return timeoutOriginal(callback, delay, ...args); };
  });
  const snapshot = () => failurePage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'), s = await import('/src/lib/storage.ts');
    let state; const unsubscribe = sync.syncState.subscribe(value => state = value); unsubscribe();
    return { state, queue: await s.syncQueue(s.storageScope()), pending: await s.pendingMutations(s.storageScope()), scores: await s.savedScores(), takes: await s.listTakes(), other: await s.savedScores('user:other-synthetic'), digests: window.__digestCalls, delays: window.__syncDelays };
  });
  await failurePage.evaluate(async () => { const sync = await import('/src/lib/sync.ts'); sync.setTakeSyncPaused(false); await sync.synchronize(); });
  let failedState = await snapshot();
  assert.equal(goodMutations, 1); assert.equal(declarations, 1); assert.equal(uploaded, 0);
  assert.equal(failedState.pending.length, 1); assert.equal(failedState.pending[0].attempt.error, 'Requête invalide.');
  assert.equal(failedState.pending[0].attempt.state, 'rejected');
  assert.equal(failedState.scores.find(score => score.id === 'a-invalid').title.length, 501);
  assert(failedState.takes.some(take => take.id === 'remote-good' && take.synced));
  assert(failedState.takes.some(take => take.id === 'audio' && take.synced), 'A legal take ID named audio must not select the WAV response format for its metadata');
  assert(!failedState.takes.some(take => take.id === 'remote-bad'));
  assert.deepEqual(failedState.state.failures.map(item => item.id).sort(), ['a-invalid', 'quota-upload', 'remote-bad']);
  assert.equal(failedState.state.available, true); assert.equal(failedState.state.status, 'En attente');
  assert.equal(failedState.other[0].title, 'Other account');
  assert(failedState.delays.includes(30_000)); assert(!failedState.delays.includes(300));
  await failurePage.clock.runFor(1200);
  assert.equal(declarations, 1, 'Rejected resources must not cause a fast retry loop');
  // Only the corrupt remote take is rehashed; the pending WAV digest is reused.
  const beforeRetry = failedState.digests;
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  failedState = await snapshot();
  assert.equal(failedState.digests - beforeRetry, 1);
  assert.equal(declarations, 2);
  const refusedPosts = () => mutationAttempts.filter(mutation => mutation.id === 'a-invalid');
  assert.equal(refusedPosts().length, 1);
  for (let cycle = 0; cycle < 3; cycle++) {
    await failurePage.clock.runFor(30_000);
    await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
    assert.equal(refusedPosts().length, 1, 'A definitive refusal must not resend its payload on later cycles');
  }
  failedState = await snapshot();
  assert.equal(failedState.pending.length, 1);
  assert.equal(failedState.state.pending, 3, 'Rejected mutation, pending upload and failed download are all counted');
  assert.equal(failedState.pending[0].attempt.error, 'Requête invalide.');
  assert.equal(failedState.state.failures.length, 3);
  assert(declarations > 2, 'Small take declarations still retry while the mutation is skipped');
  await failurePage.locator('.account-button').click();
  assert.equal(await failurePage.locator('.sync-failure').count(), 3);
  assert.match(await failurePage.locator('.sync-status').innerText(), /3 opérations en attente/);
  for (const [language, label] of [['en', '3 pending operations'], ['de', '3 ausstehende Vorgänge'], ['nl', '3 bewerkingen in behandeling']]) {
    await failurePage.evaluate(async language => { (await import('/src/lib/i18n.ts')).setLanguage(language); }, language);
    assert((await failurePage.locator('.sync-status').innerText()).includes(label));
  }
  await failurePage.evaluate(async () => { (await import('/src/lib/i18n.ts')).setLanguage('fr'); });
  await failurePage.getByRole('button', { name: 'Fermer le compte', exact: true }).click();
  // The rejection and resource survive a reload, not just an in-memory list.
  refusalStatus = 413;
  await failurePage.reload(); await ready(failurePage);
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert.equal(refusedPosts().length, 2, 'Reload permits exactly one fresh attempt for the persisted refusal');
  for (let cycle = 0; cycle < 3; cycle++) {
    await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  }
  assert.equal(refusedPosts().length, 2, 'A 413 must also stay skipped on subsequent cycles');
  failedState = await snapshot();
  assert.equal(failedState.pending[0].attempt.error, 'Requête invalide.');
  assert.equal(failedState.scores.find(score => score.id === 'a-invalid').title.length, 501);
  assert.equal(failedState.queue.find(job => job.id === 'remote-bad').attempt.error, 'Le son téléchargé ne correspond pas à l’essai.');
  assert.equal(failedState.queue.find(job => job.id === 'quota-upload').audioSha256, fixture.digest, 'Upload digest survives reload in the queued transfer');
  refusalStatus = 422;
  await failurePage.evaluate(async account => {
    await (await import('/src/lib/sync.ts')).login(account.email, 'synthetic-password');
  }, failureAccount);
  assert.equal(refusedPosts().length, 3, 'A successful connection to the same account permits one fresh attempt');
  for (let cycle = 0; cycle < 3; cycle++) {
    await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  }
  assert.equal(refusedPosts().length, 3, 'A 422 must stay skipped after its connection attempt');
  assert(refusedPosts().every(mutation => mutation.mutationId === refusedPosts()[0].mutationId), 'Fresh attempts preserve the immutable mutation ID');
  // A real notification from another tab also covers signing into the same
  // account: localStorage's unchanged user value cannot signal this case.
  const authenticationPage = await failureContext.newPage();
  await authenticationPage.route(`${url}/synthetic-session-tab`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic session tab</title>' }));
  await authenticationPage.goto(`${url}/synthetic-session-tab`);
  const crossTabPost = failurePage.waitForResponse(response => response.url().endsWith('/api/v1/mutations') && response.request().postDataJSON().mutations[0].id === 'a-invalid');
  await authenticationPage.evaluate(async account => {
    const sync = await import('/src/lib/sync.ts');
    sync.setTakeSyncPaused(true);
    window.__stopSessionSync = sync.startSync();
    await sync.login(account.email, 'synthetic-password');
  }, failureAccount);
  await failurePage.clock.runFor(1);
  await crossTabPost;
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert.equal(refusedPosts().length, 4, 'A successful connection in another tab rearms the same account once');
  for (let cycle = 0; cycle < 3; cycle++) {
    await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  }
  assert.equal(refusedPosts().length, 4, 'The cross-tab connection must not rearm later polls');
  await authenticationPage.evaluate(() => window.__stopSessionSync());
  await authenticationPage.close();
  console.log('PASS browser: refused 400/413/422 payload posts once per page/local or cross-tab connection and stays visible across later cycles');
  quota = false; corrupt = false;
  await failurePage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'), s = await import('/src/lib/storage.ts');
    sync.setTakeSyncPaused(true);
    const score = (await s.savedScores()).find(item => item.id === 'a-invalid');
    await s.saveScore({ ...score, title: 'Corrected title' });
    if ('error' in (await s.pendingMutations(s.storageScope()))[0].attempt) throw Error('Editing must clear the old payload error');
    sync.setTakeSyncPaused(false); await sync.synchronize();
  });
  const recovered = await snapshot();
  assert.equal(uploaded, 1); assert.equal(recovered.pending.length, 0); assert.equal(recovered.state.failures.length, 0);
  assert(recovered.takes.some(take => take.id === 'remote-bad' && take.synced));
  assert(recovered.takes.some(take => take.id === 'quota-upload' && take.synced));
  assert.equal(recovered.state.status, 'Synchronisé');
  assert.equal(refusedPosts().length, 5, 'A local edit sends the new payload immediately');
  assert.notEqual(refusedPosts().at(-1).mutationId, refusedPosts()[0].mutationId);
  console.log('PASS browser: rejected mutation, quota and corrupt take are isolated, visible and recoverable; WAV digest reused');

  // Reconcile a remote-only failure with the next complete collection.
  await failurePage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    await s.queueRemoteTakes(s.storageScope(), [{ id: 'orphan-download', title: 'Synthetic orphan', ready: true, deleted: false }]);
    const job = (await s.pendingTakes(s.storageScope())).find(job => job.id === 'orphan-download');
    await s.failTakeTransfer(job, 'Synthetic missing take');
  });
  // Item errors continue; authentication, service, network and abort errors stop.
  remoteMode = 'faults'; fault = 401; requested.length = 0;
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert(!requested.some(path => path.includes('orphan-download')));
  assert(!(await snapshot()).queue.some(job => job.id === 'orphan-download'));
  assert(!(await snapshot()).state.failures.some(job => job.id === 'orphan-download'));
  assert((await snapshot()).takes.some(take => take.id === 'remote-good' && take.synced));
  console.log('PASS browser: remote collection reconciliation removes orphan downloads and their errors without requesting them');
  for (const code of [401, 403, 429, 500, 'network']) {
    fault = code; requested.length = 0;
    await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
    assert(requested.includes('takes/remote-fault'));
    assert(!requested.includes('takes/remote-z-after'), `${code}: global failure must stop further transfers`);
    assert(!requested.some(path => path.includes('orphan-download')), 'An orphan download must not return on later cycles');
    const { state } = await snapshot();
    if (code === 401 || code === 403) assert.equal(state.status, 'Connexion requise');
    if (code === 'network') { assert.equal(state.status, 'Hors ligne'); assert.equal(state.available, false); }
  }
  fault = 404; requested.length = 0;
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert(requested.includes('takes/remote-z-after/audio'));
  assert.equal((await snapshot()).state.available, true);
  fault = 'json';
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert.equal((await snapshot()).state.failures[0].message, 'Les métadonnées de l’essai sont invalides.');
  fault = 'metadata'; requested.length = 0;
  await failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  assert.equal((await snapshot()).state.available, true);
  assert.equal((await snapshot()).state.failures[0].message, 'Essai téléchargé incomplet.');
  assert(!requested.includes('takes/remote-fault/audio'), 'Invalid metadata must be rejected before downloading its WAV');
  let releaseHold;
  hold = new Promise(resolve => { releaseHold = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  requested.length = 0;
  const interrupted = failurePage.evaluate(async () => { await (await import('/src/lib/sync.ts')).synchronize(); });
  await waiting;
  await failurePage.evaluate(async () => { (await import('/src/lib/sync.ts')).setTakeSyncPaused(true); });
  releaseHold(); await interrupted; hold = null;
  assert(!requested.includes('takes/remote-z-after'), 'Pausing a take aborts the active cycle');
  console.log('PASS browser: item 404/invalid JSON continue; 401/403/429/500/network/recording pause stop the cycle');
  fault = 410;
  await failurePage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'); sync.setTakeSyncPaused(false); await sync.synchronize();
    const s = await import('/src/lib/storage.ts');
    const tombstone = (await s.takeSyncEntries(s.storageScope())).find(take => take.id === 'remote-fault');
    if (!tombstone?.deleted || tombstone.pending || (await s.syncQueue(s.storageScope())).some(job => job.id === 'remote-fault') || await s.getTake('remote-fault')) throw Error('410 must retain a synchronized tombstone');
  });
  assert.equal((await snapshot()).state.failures.length, 0);
  console.log('PASS browser: remote 410 retains its tombstone and clears the item error');

  // A local persistence failure must not masquerade as a network outage.
  await failurePage.evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(stores, ...args) {
      if ((Array.isArray(stores) ? stores : [stores]).includes('outbox')) throw new DOMException('Synthetic local quota', 'QuotaExceededError');
      return original.call(this, stores, ...args);
    };
    try { await (await import('/src/lib/sync.ts')).synchronize(); }
    finally { IDBDatabase.prototype.transaction = original; }
  });
  assert.equal((await snapshot()).state.status, 'En attente');
  assert.equal((await snapshot()).state.available, true);
  assert.equal((await snapshot()).state.message, 'Synthetic local quota');
  console.log('PASS browser: local storage errors remain distinct from network failures');

  // A newer local edit must replace a rejected snapshot, never inherit its error.
  await failurePage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    const scope = 'user:other-synthetic', original = (await s.pendingMutations(scope))[0];
    await s.markMutationSent(original);
    const score = (await s.savedScores(scope))[0];
    await s.saveScore({ ...score, title: 'Newer edit' }, scope);
    await s.releaseRejectedMutation(original, 'Synthetic rejection');
    const [next] = await s.pendingMutations(scope);
    if (next.mutationId === original.mutationId || 'error' in next.attempt || next.attempt.state === 'sent' || next.data.title !== 'Newer edit') throw Error('Rejection lost or tainted the newer edit');
  });
  console.log('PASS browser: rejecting an in-flight mutation preserves a newer local edit');

  // Existing v5 data migrates atomically into the common queue, without WAV rewrites.
  const migrationContext = await isolatedContext();
  await migrationContext.route('**/migration-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic migration</title>' }));
  const migrationPage = await migrationContext.newPage(); await migrationPage.goto(`${url}/migration-fixture`);
  await migrationPage.evaluate(async fixture => {
    const connection = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chansonade', 5);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('scores', { keyPath: 'id' }); db.createObjectStore('takes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        db.createObjectStore('takeData', { keyPath: ['scope', 'id'] });
        db.createObjectStore('takeIndex', { keyPath: ['scope', 'id'] }).createIndex('scope', 'scope');
        const resources = db.createObjectStore('resources', { keyPath: ['scope', 'kind', 'id'] });
        resources.createIndex('scope', 'scope'); resources.createIndex('scopeKind', ['scope', 'kind']);
        db.createObjectStore('outbox', { keyPath: ['scope', 'kind', 'id'] }).createIndex('scope', 'scope'); db.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const scope = 'user:migration-a', other = 'user:migration-b';
    await new Promise((resolve, reject) => {
      const tx = connection.transaction(['outbox', 'takeIndex', 'takeData', 'meta'], 'readwrite');
      for (const marker of ['legacy-imported', 'scoped-v4', 'takes-scoped-v5']) tx.objectStore('meta').put(true, marker);
      for (const [id, sent, error, account] of [['queued', false, undefined, scope], ['sent', true, undefined, scope], ['rejected', false, 'Old refusal', scope], ['other', false, 'Other refusal', other]]) {
        tx.objectStore('outbox').put({ scope: account, kind: 'score', id, mutationId: `synthetic-${id}`, baseRevision: 0, data: { id, title: id, composer: 'Synthetic', xml: '<score-partwise/>', added: 1 }, deleted: false, change: 1, sent, ...(error ? { error } : {}) });
      }
      const take = { ...fixture.metadata, id: 'legacy-upload', audio: new Blob([new Uint8Array(fixture.bytes)], { type: 'audio/wav' }) };
      tx.objectStore('takeData').put({ scope, id: take.id, take });
      tx.objectStore('takeIndex').put({ scope, id: take.id, title: take.title, createdAt: 1, duration: take.duration, scoreId: take.scoreId, change: 1, pending: true, synced: false, deleted: false });
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    connection.close();
    const s = await import('/src/lib/storage.ts');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const queue = await s.syncQueue(scope);
    check(queue.length === 4, 'Migration must preserve three mutations and queue the existing upload');
    for (const [id, state] of [['queued', 'queued'], ['sent', 'sent'], ['rejected', 'rejected']]) {
      const job = queue.find(item => item.id === id);
      check(job.attempt.state === state && !('sent' in job) && !('error' in job), 'Only the persisted attempt represents the mutation state');
    }
    check(queue.find(item => item.id === 'rejected').attempt.error === 'Old refusal', 'Refusal message survives migration');
    check(queue.find(item => item.id === 'legacy-upload').operation === 'upload', 'Legacy pending flag becomes a transfer job');
    const take = await s.getTake('legacy-upload', scope);
    check(JSON.stringify([...new Uint8Array(await take.audio.arrayBuffer())]) === JSON.stringify(fixture.bytes), 'Migration must preserve exact WAV bytes');
    check((await s.listTakes(scope))[0].pending, 'Take status is derived from the common queue');
    await s.queueRemoteTakes(scope, [{ id: 'remote-only', title: 'Synthetic remote', deleted: false, ready: true }]);
    const [remote] = (await s.pendingTakes(scope)).filter(job => job.id === 'remote-only');
    await s.failTakeTransfer(remote, 'Synthetic download failure');
    await s.queueRemoteTakes(other, [{ id: 'other-download', title: 'Other scope', deleted: false, ready: true }]);
    await s.saveTake({ ...take, id: 'local-delete' }, scope);
    await s.deleteTake('local-delete', scope);
    await s.queueRemoteTakes(scope, []);
    check(!(await s.pendingTakes(scope)).some(job => job.id === 'remote-only'), 'Absent remote-only job is removed during discovery');
    check((await s.pendingTakes(scope)).some(job => job.id === 'legacy-upload'), 'Empty remote collection preserves a local upload');
    check((await s.pendingTakes(scope)).some(job => job.id === 'local-delete' && job.operation === 'delete'), 'Empty remote collection preserves a local deletion');
    check((await s.pendingTakes(other)).some(job => job.id === 'other-download'), 'Remote reconciliation is scoped');
    await s.queueRemoteTakes(scope, [{ id: 'remote-only', title: 'Synthetic remote', deleted: false, ready: true }]);
    await s.failTakeTransfer((await s.pendingTakes(scope)).find(job => job.id === 'remote-only'), 'Synthetic download failure');
    check((await s.syncQueue(scope)).find(job => job.id === 'remote-only').attempt.error === 'Synthetic download failure', 'Remote-only failure uses the same stored queue state');
    check(await s.getTake('remote-only', scope) === null, 'Failed download must not fabricate a local take');
    await s.applyRemoteTake(scope, 'remote-only', null);
    await s.applyRemoteTake(scope, 'remote-only', { ...take, id: 'remote-only' });
    await s.failTakeTransfer(remote, 'Late download failure');
    check(await s.getTake('remote-only', scope) === null && !(await s.syncQueue(scope)).some(job => job.id === 'remote-only'), 'Late data and errors must not resurrect a remote tombstone');
    await s.rearmRejectedMutations(scope);
    check((await s.pendingMutations(scope)).find(job => job.id === 'rejected').attempt.state === 'queued', 'Connection rearms the stored refusal');
    check((await s.pendingMutations(scope)).find(job => job.id === 'sent').attempt.state === 'sent', 'Rearming must preserve in-flight mutation identity/state');
    check((await s.pendingMutations(other))[0].attempt.error === 'Other refusal', 'Other accounts remain untouched');
    await s.forgetAccountScope(scope);
    check((await s.syncQueue(scope)).length === 0 && (await s.takeSyncEntries(scope)).length === 0, 'Account removal clears uploads and remote-only jobs');
    check((await s.syncQueue(other)).length === 2, 'Other account queue survives removal');
  }, fixture);
  console.log('PASS browser: v5 queue migration preserves states, account boundaries and WAV bytes; remote-only failures share the outbox');

  // Reserve openings at the user choice, before network, files, IDB or engines.
  const openingContext = await isolatedContext();
  await openingContext.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  const syntheticXML = title => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  let heldCatalogue = null, catalogueRequests = 0;
  await openingContext.route('**/scores/*', async route => {
    if (new URL(route.request().url()).pathname.endsWith('catalog.json')) return route.continue();
    catalogueRequests++;
    if (heldCatalogue) { const hold = heldCatalogue; heldCatalogue = null; hold(route); return; }
    return route.fulfill({ contentType: 'application/xml', body: syntheticXML('Synthetic catalogue') });
  });
  await openingContext.addInitScript(() => {
    // Delay just the delivery of a real IndexedDB read; no database is mocked.
    const getAll = IDBIndex.prototype.getAll;
    const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess');
    window.__holdLibrary = true;
    IDBIndex.prototype.getAll = function(...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'scopeKind' && args[0]?.[1] === 'score' && window.__holdLibrary) {
        window.__holdLibrary = false;
        Object.defineProperty(request, 'onsuccess', { set(callback) {
          success.set.call(request, event => { window.__releaseLibrary = () => callback.call(request, event); });
        } });
      }
      return request;
    };
  });
  const openingPage = await openingContext.newPage(); await openingPage.goto(url);
  await openingPage.waitForFunction(() => !!window.__releaseLibrary);
  await openingPage.evaluate(async () => {
    const { Score } = await import('/src/lib/score.ts');
    const { AudioPlayer } = await import('/src/lib/audio.ts');
    window.__openingLoads = [];
    const load = Score.prototype.load;
    Score.prototype.load = async function(xml, ...args) {
      window.__openingLoads.push(xml);
      const result = await load.call(this, xml, ...args);
      if (xml.includes(window.__holdEngineTitle || '\u0000')) {
        window.__holdEngineTitle = null;
        await new Promise((resolve, reject) => { window.__releaseEngine = error => error ? reject(Error(error)) : resolve(); });
      }
      return result;
    };
    const audioLoad = AudioPlayer.prototype.load;
    AudioPlayer.prototype.load = async function(...args) {
      await audioLoad.apply(this, args);
      if (window.__holdAudio) {
        window.__holdAudio = false;
        await new Promise((resolve, reject) => { window.__releaseAudio = error => error ? reject(Error(error)) : resolve(); });
      }
    };
  });
  const selectSavedOpening = async title => {
    await openingPage.evaluate(async ({ title, xml }) => {
      const s = await import('/src/lib/storage.ts');
      await s.saveScore({ id: await s.scoreId(xml), title, composer: 'Synthetic', xml, added: Date.now() });
    }, { title, xml: syntheticXML(title) });
    if (!await openingPage.locator('.library-panel').count()) await openingPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
    await openingPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
    await openImported(openingPage, title);
  };
  const settledOpening = async title => {
    await openingPage.waitForFunction(title => document.querySelector('h1')?.textContent === title && document.querySelector('.transport .play-button')?.disabled === false && !document.querySelector('.loading-overlay'), title);
    await openingPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await openingPage.locator('h1').innerText(), title);
    assert.equal(await openingPage.locator('.loading-overlay, .error-card').count(), 0);
    assert.equal(await openingPage.locator('.sheet-page > svg').first().getAttribute('aria-label'), title);
  };
  const releaseOpening = name => openingPage.evaluate(name => { window[name](); delete window[name]; }, name);
  await selectSavedOpening('Startup winner'); await settledOpening('Startup winner');
  await releaseOpening('__releaseLibrary'); await openingPage.waitForLoadState('networkidle'); await settledOpening('Startup winner');
  assert.equal(catalogueRequests, 0, 'The superseded initial library lookup must not fetch its fallback');
  await openingPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
  await openingPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  assert.equal(await openingPage.locator('.saved-piece strong').filter({ hasText: 'Startup winner' }).count(), 1, 'An old library read must not erase the selected score from the list');
  await openingPage.locator('.library-panel').getByRole('button', { name: 'Fermer la bibliothèque', exact: true }).click();
  const catalogue = await openingPage.evaluate(async () => (await import('/src/lib/catalog.ts')).publicCatalog.filter(piece => piece.group === 'children-fr').slice(0, 2));
  const selectCatalogue = async piece => {
    if (!await openingPage.locator('.library-panel').count()) await openingPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
    await openingPage.getByRole('button', { name: 'Catalogue public', exact: true }).click();
    await openingPage.locator('.catalog-piece .piece').filter({ has: openingPage.locator('strong', { hasText: piece.title }) }).click();
  };
  for (const status of [200, 500]) {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    heldCatalogue = route => { release = () => route.fulfill({ status, contentType: 'application/xml', body: syntheticXML('Obsolete catalogue') }); entered(); };
    await selectCatalogue(catalogue[0]); await waiting;
    await selectCatalogue(catalogue[1]); await settledOpening(catalogue[1].title);
    await release(); await openingPage.waitForLoadState('networkidle'); await settledOpening(catalogue[1].title);
  }
  // A stale error must also leave the next opening's loading state intact.
  let releaseCatalogue, catalogueEntered;
  const waitingCatalogue = new Promise(resolve => { catalogueEntered = resolve; });
  heldCatalogue = route => { releaseCatalogue = () => route.fulfill({ status: 500, body: 'Synthetic failure' }); catalogueEntered(); };
  await selectCatalogue(catalogue[0]); await waitingCatalogue;
  await openingPage.evaluate(() => { window.__holdEngineTitle = 'Loading winner'; });
  await selectSavedOpening('Loading winner');
  await openingPage.waitForFunction(() => !!window.__releaseEngine);
  await releaseCatalogue();
  await openingPage.waitForLoadState('networkidle');
  assert.equal(await openingPage.locator('.loading-overlay').count(), 1);
  assert.equal(await openingPage.locator('.error-card').count(), 0);
  await releaseOpening('__releaseEngine'); await settledOpening('Loading winner');

  await openingPage.evaluate(() => { window.__holdEngineTitle = 'Obsolete engraving'; });
  await selectSavedOpening('Obsolete engraving'); await openingPage.waitForFunction(() => !!window.__releaseEngine);
  await selectSavedOpening('Engraving winner'); await settledOpening('Engraving winner');
  await releaseOpening('__releaseEngine'); await settledOpening('Engraving winner');
  await openingPage.evaluate(() => { window.__holdAudio = true; });
  await selectSavedOpening('Obsolete instruments'); await openingPage.waitForFunction(() => !!window.__releaseAudio);
  await openingPage.evaluate(() => { window.__holdEngineTitle = 'Audio winner'; });
  await selectSavedOpening('Audio winner'); await openingPage.waitForFunction(() => !!window.__releaseEngine);
  await openingPage.evaluate(() => { window.__releaseAudio('Synthetic stale audio error'); delete window.__releaseAudio; });
  await openingPage.waitForLoadState('networkidle');
  assert.equal(await openingPage.locator('.loading-overlay').count(), 1);
  assert.equal(await openingPage.locator('.error-card').count(), 0);
  await releaseOpening('__releaseEngine'); await settledOpening('Audio winner');

  // A saved choice supersedes a pending catalogue fetch too.
  let releaseSaved, savedEntered;
  const waitingSaved = new Promise(resolve => { savedEntered = resolve; });
  heldCatalogue = route => { releaseSaved = () => route.fulfill({ contentType: 'application/xml', body: syntheticXML('Old catalogue before library') }); savedEntered(); };
  await selectCatalogue(catalogue[0]); await waitingSaved;
  await openingPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
  await openingPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  await openingPage.locator('.saved-piece .piece').filter({ has: openingPage.locator('strong', { hasText: 'Startup winner' }) }).click();
  await settledOpening('Startup winner'); await releaseSaved(); await openingPage.waitForLoadState('networkidle'); await settledOpening('Startup winner');

  // Adding a file does not own a pending studio opening or its panel state.
  let releaseDuringAddition, duringAdditionEntered;
  const duringAddition = new Promise(resolve => { duringAdditionEntered = resolve; });
  heldCatalogue = route => { releaseDuringAddition = () => route.fulfill({ contentType: 'application/xml', body: syntheticXML('Catalogue during addition') }); duringAdditionEntered(); };
  await selectCatalogue(catalogue[0]); await duringAddition;
  await openingPage.locator('input[type=file]').setInputFiles({ name: 'independent-addition.musicxml', mimeType: 'application/xml', buffer: Buffer.from(syntheticXML('Independent addition')) });
  await openingPage.locator('.library-tree .revealed').getByText('Independent addition', { exact: true }).waitFor();
  await releaseDuringAddition(); await settledOpening(catalogue[0].title);
  assert(await openingPage.locator('.library-panel').isVisible(), 'A previous studio opening must not close the newly revealed library');
  assert.equal(await openingPage.locator('.saved-piece').getByText('Independent addition', { exact: true }).count(), 1);
  await openingPage.locator('.library-panel .section-heading button').click();
  // Keep the same saved content as the account fallback for the next regression.
  await selectSavedOpening('Startup winner'); await settledOpening('Startup winner');

  // An A -> B -> A account round trip invalidates work even when scope matches again.
  await openingPage.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts'), s = await import('/src/lib/storage.ts');
    sync.setTakeSyncPaused(true);
    const score = (await s.savedScores()).find(score => score.title === 'Startup winner');
    await s.saveScore({ ...score, title: 'Account A' }, 'user:opening-a');
    await s.saveScore({ ...score, title: 'Account B' }, 'user:opening-b');
    s.setStorageScope('user:opening-a');
  });
  await settledOpening('Account A');
  await openingPage.evaluate(() => { window.__holdEngineTitle = 'Private obsolete'; });
  await selectSavedOpening('Private obsolete'); await openingPage.waitForFunction(() => !!window.__releaseEngine);
  await openingPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:opening-b'); });
  await settledOpening('Account B');
  await openingPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:opening-a'); });
  await settledOpening('Account A');
  await releaseOpening('__releaseEngine'); await settledOpening('Account A');
  // A remote account choice reserves its generation immediately, while the
  // active synthetic capture finishes and saves in its original scope.
  await openingPage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click();
  await openingPage.waitForFunction(() => !!document.querySelector('.take-button.recording'));
  await openingPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:opening-b'); });
  assert.equal(await openingPage.locator('h1').innerText(), 'Account A');
  assert.equal(await openingPage.locator('.take-button.recording').count(), 1);
  await openingPage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
  await settledOpening('Account B');
  const capturedScopes = await openingPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    return [(await s.listTakes('user:opening-a')).length, (await s.listTakes('user:opening-b')).length];
  });
  assert.deepEqual(capturedScopes, [1, 0]);
  console.log('PASS browser: latest opening wins across startup, catalogue success/errors, saved library, engraving/audio and A-B-A account changes; account opening waits for capture saved in its original scope');

  const additionContext = await isolatedContext(null, { reducedMotion: 'reduce' });
  await additionContext.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  const additionPage = await additionContext.newPage(); await additionPage.goto(url); await ready(additionPage);
  await additionPage.locator('.atelier-button').click();
  await additionPage.getByRole('slider', { name: 'Vitesse de lecture', exact: true }).evaluate(input => { input.value = '0.8'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await additionPage.locator('.transpose-control').first().getByRole('button').last().click();
  await additionPage.locator('.mixer-panel').getByRole('button', { name: 'Fermer les instruments', exact: true }).click();
  // Playwright's predicate polling treats a Promise as truthy; await IDB in Node.
  const settingsDeadline = Date.now() + 5000;
  let additionSettings;
  do {
    additionSettings = await additionPage.evaluate(async () => (await import('/src/lib/storage.ts')).readSettings(localStorage.getItem('chansonade.last')));
    if (additionSettings?.rate === 0.8 && additionSettings.parts[0].transpose === 1) break;
    await additionPage.waitForTimeout(30);
  } while (Date.now() < settingsDeadline);
  assert.equal(additionSettings?.rate, 0.8); assert.equal(additionSettings.parts[0].transpose, 1);
  const additionBaseline = await additionPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts'), id = localStorage.getItem('chansonade.last');
    window.__additionSVG = document.querySelector('.sheet-page > svg');
    return { id, title: document.querySelector('h1').textContent, engraving: true, settings: await s.readSettings(id) };
  });
  await additionPage.locator('.play-button').click();
  await additionPage.waitForFunction(() => Number(document.querySelector('.timeline-row input').value) > 0.1);
  await additionPage.evaluate(async () => {
    window.__additionCalls = [];
    const { Score } = await import('/src/lib/score.ts'), { AudioPlayer } = await import('/src/lib/audio.ts');
    for (const [type, methods] of [[Score, ['load', 'layout']], [AudioPlayer, ['load', 'pause', 'seek', 'setRate', 'setLoop', 'setVolume', 'setMuted', 'setProgram', 'setTranspose']]]) {
      for (const method of methods) { const original = type.prototype[method]; type.prototype[method] = function(...args) { window.__additionCalls.push(method); return original.apply(this, args); }; }
    }
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() {
      const data = await read.call(this);
      if (this.name === window.__holdAdditionFile) {
        window.__holdAdditionFile = null;
        await new Promise((resolve, reject) => { window.__releaseAdditionFile = error => error ? reject(Error(error)) : resolve(); });
      }
      return data;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'resources' && value.kind === 'organization' && value.id === window.__failAdditionPlacement) {
        window.__failAdditionPlacement = null;
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      }
      return put.call(this, value, ...args);
    };
  });
  const additionFolders = await additionPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    for (let i = 0; i < 12; i++) await s.createFolder(`Addition spacer ${i}`);
    const parent = await s.createFolder('Addition parent'), child = await s.createFolder('Addition child', parent);
    return { parent, child };
  });
  await additionPage.locator('.library-toggle').click();
  await additionPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  const additionTree = additionPage.locator('.library-tree'), additionPanel = additionPage.locator('.library-panel');
  const additionFolder = id => additionTree.locator(`[data-folder-id="${id}"] > .tree-row`);
  const additionRow = id => additionTree.locator(`[data-kind="score"][data-id="${id}"]`);
  const uploadAddition = (title, filename = `${title}.musicxml`) => additionPage.locator('input[type=file]').setInputFiles({ name: filename, mimeType: 'application/xml', buffer: Buffer.from(syntheticXML(title)) });
  const additionId = title => additionPage.evaluate(async xml => (await import('/src/lib/storage.ts')).scoreId(xml), syntheticXML(title));
  async function revealedAddition(title) {
    await additionPage.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
    const id = await additionId(title), row = additionRow(id);
    await row.locator('xpath=self::*[contains(@class,"revealed")]').waitFor();
    await additionPage.waitForFunction(title => document.querySelector('.library-tree [role=status]')?.textContent.includes(title), title);
    const box = await row.boundingBox(), panel = await additionPanel.boundingBox();
    assert(box && panel && box.y >= panel.y - 1 && box.y + box.height <= panel.y + panel.height + 1, 'Reveal scrolls the score fully into the panel');
    return id;
  }
  const additionPlacement = id => additionPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).readOrganization()).classify('score', id), id);
  await additionFolder(additionFolders.parent).locator('.disclosure').click();
  await additionFolder(additionFolders.child).locator('.folder-select').click();
  await additionFolder(additionFolders.parent).locator('.disclosure').click();
  await additionPage.getByRole('searchbox').fill('Search hiding the new score');
  const chooser = additionPage.waitForEvent('filechooser'); await additionPage.locator('.import-button').click();
  await (await chooser).setFiles({ name: 'nested.musicxml', mimeType: 'application/xml', buffer: Buffer.from(syntheticXML('Addition nested')) });
  const nestedAddition = await revealedAddition('Addition nested');
  assert.equal((await additionPlacement(nestedAddition)).folderId, additionFolders.child);
  assert.equal(await additionPage.getByRole('searchbox').inputValue(), '');
  for (const id of Object.values(additionFolders)) assert.equal(await additionFolder(id).locator('.disclosure').getAttribute('aria-expanded'), 'true');
  assert.equal(await additionRow(nestedAddition).locator('> .tree-row').evaluate(row => getComputedStyle(row).animationName), 'none', 'Reduced motion keeps a static highlight');
  await additionTree.locator('.root-select').click();
  await additionPanel.locator('.section-heading button').click();
  const transfer = await additionPage.evaluateHandle(xml => { const transfer = new DataTransfer(); transfer.items.add(new File([xml], 'viewport.musicxml', { type: 'application/xml' })); return transfer; }, syntheticXML('Addition root'));
  await additionPage.locator('.score-viewport').dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
  const rootAddition = await revealedAddition('Addition root'); assert.equal((await additionPlacement(rootAddition)).state, 'unfiled');
  await additionPage.evaluate(async ({ id, settings }) => (await import('/src/lib/storage.ts')).writeSettings(id, settings), { id: nestedAddition, settings: additionBaseline.settings });
  const beforeDuplicate = await additionPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()));
  const { zipSync, strToU8 } = await import('fflate');
  await additionPage.locator('input[type=file]').setInputFiles({ name: 'same-content.mxl', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync({ 'score.musicxml': strToU8(syntheticXML('Addition nested')) })) });
  await revealedAddition('Addition nested');
  assert.equal((await additionPlacement(nestedAddition)).folderId, additionFolders.child, 'An active duplicate stays in its original folder');
  assert.deepEqual(await additionPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores())), beforeDuplicate, 'Duplicate leaves score metadata and added dates intact');
  await additionPage.evaluate(async id => (await import('/src/lib/storage.ts')).trashItem('score', id), nestedAddition);
  await additionTree.locator('.root-select').click(); await uploadAddition('Addition nested'); await revealedAddition('Addition nested');
  assert.equal((await additionPlacement(nestedAddition)).folderId, additionFolders.child, 'An explicitly trashed duplicate returns to its active folder');
  await additionPage.evaluate(async id => (await import('/src/lib/storage.ts')).trashFolder(id), additionFolders.parent);
  await uploadAddition('Addition nested'); await revealedAddition('Addition nested');
  assert.equal((await additionPlacement(nestedAddition)).state, 'unfiled', 'Restoring a duplicate does not restore its trashed ancestors');
  assert.deepEqual(await additionPage.evaluate(async ({ id, parent }) => { const s = await import('/src/lib/storage.ts'); return [(await s.readOrganization()).folder(parent).trashed, await s.readSettings(id)]; }, { id: nestedAddition, parent: additionFolders.parent }), [true, additionBaseline.settings]);
  // Import placement is resolved in the transaction, even if the chosen folder disappears during file reading.
  await additionPage.evaluate(async id => (await import('/src/lib/storage.ts')).restoreFolder(id), additionFolders.parent);
  await additionFolder(additionFolders.parent).locator('.folder-select').click();
  await additionPage.evaluate(() => { window.__holdAdditionFile = 'removed-parent.musicxml'; });
  await uploadAddition('Addition absent parent', 'removed-parent.musicxml');
  await additionPage.waitForFunction(() => !!window.__releaseAdditionFile);
  await additionPage.evaluate(async id => { await (await import('/src/lib/storage.ts')).trashFolder(id); window.__releaseAdditionFile(); delete window.__releaseAdditionFile; }, additionFolders.parent);
  const absentParentAddition = await revealedAddition('Addition absent parent'); assert.equal((await additionPlacement(absentParentAddition)).state, 'unfiled');
  // Catalogue additions use exactly the same reveal path and leave the studio running.
  await additionPanel.locator('.section-heading button').click();
  await additionPage.locator('.add-current-score').click();
  await additionRow(additionBaseline.id).locator('xpath=self::*[contains(@class,"revealed")]').waitFor();
  const beforeFailure = await additionPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length);
  await additionPage.locator('input[type=file]').setInputFiles({ name: 'invalid.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<not-a-score/>') });
  await additionPage.locator('.toast').filter({ hasText: 'Ce fichier ne contient pas de partition MusicXML.' }).waitFor();
  await additionPage.evaluate(async xml => { window.__failAdditionPlacement = `score.${await (await import('/src/lib/storage.ts')).scoreId(xml)}`; }, syntheticXML('Addition storage failure'));
  await uploadAddition('Addition storage failure');
  await additionPage.locator('.toast').filter({ hasText: 'Le navigateur n’a pas pu ajouter cette partition à la bibliothèque.' }).waitFor();
  assert.equal(await additionPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length), beforeFailure, 'A placement error rolls back the score insertion as well');
  assert.deepEqual(await additionPage.evaluate(async baseline => {
    const s = await import('/src/lib/storage.ts');
    return { id: localStorage.getItem('chansonade.last'), title: document.querySelector('h1').textContent, engraving: document.querySelector('.sheet-page > svg') === window.__additionSVG, settings: await s.readSettings(baseline.id) };
  }, additionBaseline), additionBaseline, 'Import/add/restore/failure never change the open score, engraving or settings');
  assert.deepEqual(await additionPage.evaluate(() => window.__additionCalls), [], 'Imports never invoke engraving, audio loading, transport or mixing');
  assert(await additionPage.locator('.play-button').getAttribute('class').then(value => value.includes('is-playing')));
  assert(await progress(additionPage) > 0.1, 'Transport continues advancing during imports');
  // A reveal expires and is consumed on drawer unmount, including repeat imports of the same content.
  await additionTree.locator('.revealed').waitFor({ state: 'detached', timeout: 6000 });
  await uploadAddition('Addition root'); await revealedAddition('Addition root');
  await additionPanel.locator('.section-heading button').click(); await additionPage.locator('.library-toggle').click();
  assert.equal(await additionTree.locator('.revealed').count(), 0, 'Reopening the drawer does not replay an old reveal');
  // Error-card uploads also add without opening, after a genuine catalogue loading failure.
  await additionPage.getByRole('button', { name: 'Catalogue public', exact: true }).click();
  await additionContext.route('**/scores/*.musicxml', route => route.fulfill({ status: 500, body: 'Synthetic unavailable score' }));
  await additionPage.locator('.catalog-piece .piece').first().click(); await additionPage.locator('.error-card').waitFor();
  const errorChooser = additionPage.waitForEvent('filechooser');
  await additionPage.locator('.error-card').getByRole('button', { name: 'Importer une partition', exact: true }).click();
  await (await errorChooser).setFiles({ name: 'error-card.musicxml', mimeType: 'application/xml', buffer: Buffer.from(syntheticXML('Addition error card')) });
  await revealedAddition('Addition error card'); assert.equal(await additionPage.locator('h1').innerText(), additionBaseline.title);
  await additionContext.unroute('**/scores/*.musicxml');
  // Pending reads and writes cannot survive an account round trip or the start of capture.
  await additionPage.evaluate(() => { window.__holdAdditionFile = 'account-read.musicxml'; });
  await uploadAddition('Addition cancelled account', 'account-read.musicxml'); await additionPage.waitForFunction(() => !!window.__releaseAdditionFile);
  await additionPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:addition-b'); s.setStorageScope('anonymous'); window.__releaseAdditionFile('Synthetic cancelled read error'); delete window.__releaseAdditionFile; });
  await ready(additionPage);
  assert(await additionPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); return (await Promise.all(['anonymous', 'user:addition-b'].map(scope => s.savedScores(scope)))).every(scores => !scores.some(score => score.title === 'Addition cancelled account')); }));
  assert.equal(await additionPage.locator('.revealed').count(), 0);
  assert.equal(await additionPage.locator('.toast').filter({ hasText: 'Synthetic cancelled read error' }).count(), 0);
  if (await additionPanel.count()) await additionPanel.locator('.section-heading button').click();
  await additionPage.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  await additionPage.evaluate(() => { window.__holdAdditionFile = 'capture-read.musicxml'; });
  await uploadAddition('Addition cancelled capture', 'capture-read.musicxml'); await additionPage.waitForFunction(() => !!window.__releaseAdditionFile);
  await additionPage.getByRole('button', { name: 'Enregistrer un essai', exact: true }).click(); await additionPage.locator('.take-button.recording').waitFor();
  assert(await additionPage.locator('input[type=file]').isDisabled());
  await additionPage.evaluate(() => { window.__releaseAdditionFile(); delete window.__releaseAdditionFile; });
  await additionPage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).click();
  await additionPage.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  assert(!(await additionPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).some(score => score.title === 'Addition cancelled capture'))));
  for (const language of ['en', 'de', 'nl']) {
    const message = await additionPage.evaluate(async language => { const i = await import('/src/lib/i18n.ts'); i.setLanguage(language); return i.translate('Partition « {title} » affichée dans votre bibliothèque.', { title: 'Addition root' }); }, language);
    await uploadAddition('Addition root'); await additionPage.waitForFunction(message => document.querySelector('.library-tree [role=status]')?.textContent === message, message);
    assert(!message.startsWith('Partition «'));
  }
  // Cancel a real write transaction after its score and outbox writes have been issued.
  await additionPage.evaluate(async () => (await import('/src/lib/storage.ts')).setStorageScope('user:addition-source'));
  await ready(additionPage);
  const cancelledWriteId = await additionPage.evaluate(async xml => {
    const s = await import('/src/lib/storage.ts'), id = await s.scoreId(xml), put = IDBObjectStore.prototype.put;
    window.__additionWriteCancelled = false;
    IDBObjectStore.prototype.put = function(value, ...args) {
      const result = put.call(this, value, ...args);
      if (this.name === 'resources' && value.kind === 'organization' && value.id === `score.${id}`) {
        IDBObjectStore.prototype.put = put;
        window.__additionWriteCancelled = true;
        s.setStorageScope('user:addition-destination');
      }
      return result;
    };
    return id;
  }, syntheticXML('Addition cancelled write'));
  await uploadAddition('Addition cancelled write');
  await additionPage.waitForFunction(() => window.__additionWriteCancelled); await ready(additionPage);
  assert.deepEqual(await additionPage.evaluate(async id => {
    const s = await import('/src/lib/storage.ts');
    return Promise.all(['user:addition-source', 'user:addition-destination'].map(async scope => [
      (await s.savedScores(scope)).some(score => score.id === id), (await s.pendingMutations(scope)).length,
    ]));
  }, cancelledWriteId), [[false, 0], [false, 0]], 'Account cancellation aborts XML, placement and outbox together');
  assert.equal(await additionPage.locator('.revealed').count(), 0);
  await uploadAddition('Addition scoped commit');
  const committedId = await revealedAddition('Addition scoped commit');
  assert.deepEqual(await additionPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).pendingMutations('user:addition-destination')).map(m => [m.kind, m.id, m.baseRevision]).sort(), committedId), [
    ['organization', `score.${committedId}`, 0], ['score', committedId, 0],
  ], 'A successful account addition commits both ordinary mutations');
  console.log('PASS library additions: nested/root upload, XML/MXL duplicates without moving, explicit/inherited trash restoration, invalid/missing folder and atomic storage failure, catalogue/drop/error-card parity, unchanged live studio, reveal/scroll/search/expiry/reduced motion/i18n, account/read/write and capture cancellation');

  const organizationContext = await isolatedContext(null, { hasTouch: true });
  await organizationContext.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  const organizationPage = await organizationContext.newPage();
  await organizationPage.goto(url); await ready(organizationPage);
  const organizationResult = await organizationPage.evaluate(async xml => {
    const s = await import('/src/lib/storage.ts');
    const { folderFor } = await import('/src/lib/organization.ts');
    const { microphoneWav } = await import('/src/lib/wav.ts');
    const check = (value, message) => { if (!value) throw Error(message); };
    const scope = 'user:organization-a', other = 'user:organization-b';
    const settings = { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] };
    const score = { id: 'organization-score', title: 'Synthetic organization', composer: '', xml, added: 1 };
    const raw = async target => {
      const connection = await new Promise((resolve, reject) => { const request = indexedDB.open('chansonade', 5); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        return await new Promise((resolve, reject) => {
          const tx = connection.transaction(['resources', 'takeData', 'takeIndex', 'outbox']);
          const requests = ['resources', 'takeData', 'takeIndex', 'outbox'].map(name => [name, tx.objectStore(name).getAll()]);
          tx.oncomplete = () => resolve(Object.fromEntries(requests.map(([name, request]) => [name, request.result.filter(row => row.scope === target)])));
          tx.onabort = () => reject(tx.error);
        });
      } finally { connection.close(); }
    };
    async function withoutScoreValues(operation, allowed = new Set()) {
      const restorations = [], forbidden = [];
      function includes(query, key) { return query === undefined || (query instanceof IDBKeyRange ? query.includes(key) : indexedDB.cmp(query, key) === 0); }
      for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
        for (const name of ['get', 'getAll', 'getAllRecords', 'openCursor']) {
          const original = prototype[name];
          if (!original) continue;
          prototype[name] = function(query, ...args) {
            const store = this instanceof IDBIndex ? this.objectStore : this;
            if (store.name === 'resources' || store.name === 'outbox') {
              let readsScore = false;
              if (this instanceof IDBIndex) {
                readsScore = this.name === 'scope' ? includes(query, scope)
                  : this.name === 'scopeKind' ? ['score', 'settings'].some(kind => includes(query, [scope, kind])) : true;
              } else if (query instanceof IDBKeyRange) {
                readsScore = ['score', 'settings'].some(kind =>
                  (query.lower === undefined || indexedDB.cmp(query.lower, [scope, kind, '\uffff']) <= 0)
                  && (query.upper === undefined || indexedDB.cmp(query.upper, [scope, kind, '']) >= 0));
              } else readsScore = query === undefined || (Array.isArray(query) && query[0] === scope && ['score', 'settings'].includes(query[1]) && !allowed.has(query[2]));
              if (readsScore) { forbidden.push(`${store.name}.${name}`); throw Error(`Unexpected score value read: ${store.name}.${name}`); }
            }
            return original.call(this, query, ...args);
          };
          restorations.push(() => { prototype[name] = original; });
        }
      }
      try { const value = await operation(); check(forbidden.length === 0, 'Score value reads must not be swallowed'); return value; }
      finally { for (const restore of restorations.reverse()) restore(); }
    }
    const root = await s.createFolder('Root', null, scope), child = crypto.randomUUID();
    await s.applyRemoteChanges(scope, [{ kind: 'organization', id: `folder.${child}`, revision: 10, deleted: false,
      data: { type: 'folder', name: 'Child', added: 2, parentId: root, trashedAt: null, futureField: 'folder preserved' } }], 10);
    await s.renameFolder(child, 'Renamed', scope);
    await s.moveFolder(child, null, scope); await s.moveFolder(child, root, scope);
    let refused = false;
    try { await s.moveFolder(root, child, scope); } catch { refused = true; }
    check(refused, 'A folder cannot be moved into its projected descendants');
    const sameName = await s.createFolder('Renamed', root, scope);
    check(sameName !== child, 'Duplicate sibling names are allowed');
    await s.saveScore(score, scope); await s.writeSettings(score.id, settings, scope);
    await s.saveScore({ ...score, title: 'Other account' }, other);
    await s.applyRemoteChanges(scope, [{ kind: 'organization', id: `score.${score.id}`, revision: 11, deleted: false,
      data: { type: 'placement', itemKind: 'score', itemId: score.id, folderId: root, trashedAt: null, futureField: 'placement preserved' } }], 11);
    await s.moveItem('score', score.id, child, scope);
    const direct = { ...score, id: 'organization-direct', title: 'Restored separately' };
    await s.saveScore(direct, scope); await s.moveItem('score', direct.id, root, scope);
    const take = { id: crypto.randomUUID(), createdAt: 2, title: 'Synthetic organization take', scoreId: score.id, scoreXML: xml,
      duration: 64 / 48000, sampleRate: 48000, samples: 64, captureStartedAt: 0, settings, latencyMs: 0,
      detector: { name: 'Synthetic' }, pitches: [], transport: [], audio: microphoneWav([new Float32Array(64)], 48000) };
    await s.saveTake({ ...take, id: 'outside-take', scoreId: 'unfiled-score', createdAt: 1 }, scope);
    await s.saveTake(take, scope);
    check(folderFor(await s.readOrganization(scope), 'take', take.id) === child, 'New take inherits the score folder');
    const remoteTake = crypto.randomUUID(), deletedScore = 'organization-deleted';
    await s.queueRemoteTakes(scope, [{ id: remoteTake, title: 'Remote download', ready: true, deleted: false }]);
    await s.moveItem('take', remoteTake, child, scope);
    await s.applyRemoteChanges(scope, [
      { kind: 'score', id: deletedScore, revision: 12, deleted: true, data: null },
      { kind: 'organization', id: `score.${deletedScore}`, revision: 13, deleted: false,
        data: { type: 'placement', itemKind: 'score', itemId: deletedScore, folderId: root, trashedAt: 0 } },
    ], 13);
    await withoutScoreValues(async () => {
      await s.readOrganization(scope);
      const folder = await s.createFolder('No XML reads', root, scope);
      await s.renameFolder(folder, 'Still no XML reads', scope);
      await s.moveFolder(folder, child, scope);
      await s.trashFolder(folder, scope); await s.restoreFolder(folder, scope);
      await s.moveItem('score', score.id, root, scope); await s.moveItem('score', score.id, child, scope);
      await s.trashItem('score', score.id, scope); await s.restoreItem('score', score.id, scope);
      await s.trashItem('take', take.id, scope); await s.restoreItem('take', take.id, scope);
    });
    const prior = await raw(scope);
    check(prior.resources.find(row => row.id === `folder.${child}`).data.futureField === 'folder preserved', 'Rename and folder moves preserve other fields');
    check(prior.resources.find(row => row.id === `score.${score.id}` && row.kind === 'organization').data.futureField === 'placement preserved', 'Item moves preserve other fields');
    await s.trashFolder(root, scope);
    let organization = await s.readOrganization(scope);
    check(organization.classify('score', score.id).state === 'trash' && organization.classify('take', take.id).state === 'trash', 'Folder trash is inherited');
    check((await s.latestTake(scope)).id === 'outside-take', 'Latest take skips a newer trashed take');
    const afterTrash = await raw(scope);
    check(JSON.stringify(afterTrash.resources.find(row => row.id === `folder.${child}`)) === JSON.stringify(prior.resources.find(row => row.id === `folder.${child}`)), 'Trashing a parent does not rewrite descendants');
    check(JSON.stringify(afterTrash.resources.find(row => row.id === `score.${score.id}` && row.kind === 'organization')) === JSON.stringify(prior.resources.find(row => row.id === `score.${score.id}` && row.kind === 'organization')), 'Trashing a parent leaves placements intact');
    const late = { ...take, id: crypto.randomUUID(), createdAt: 3 };
    await withoutScoreValues(() => s.saveTake(late, scope));
    check(folderFor(await s.readOrganization(scope), 'take', late.id) === null, 'A take saved after its folder was trashed is unfiled');
    check(!!await s.getTake(late.id, scope), 'Capture data is preserved');
    await s.restoreItem('score', direct.id, scope);
    check((await s.readOrganization(scope)).classify('score', direct.id).state === 'unfiled', 'Restoring a file under a trashed ancestor detaches it');
    await s.restoreFolder(child, scope);
    check((await s.readOrganization(scope)).folder(child).parentId === null, 'Restoring a folder under a trashed ancestor detaches it');
    await s.trashItem('score', score.id, scope);
    await s.restoreFolder(root, scope);
    check((await s.readOrganization(scope)).classify('score', score.id).state === 'trash', 'Explicit file trash survives ancestor restoration');
    await s.restoreItem('score', score.id, scope); await s.moveFolder(child, root, scope);
    await s.trashFolder(root, scope);
    const beforePurge = await raw(scope), untouched = await raw(other);
    const put = IDBObjectStore.prototype.put;
    const transactions = new Set(); let tombstones = 0, failed = false;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (value.scope === scope) {
        transactions.add(this.transaction);
        if (this.name === 'resources' && value.deleted && ++tombstones === 2) throw Error('Synthetic purge failure');
      }
      return put.call(this, value, ...args);
    };
    try { await withoutScoreValues(() => s.purgeTrash({ kind: 'folder', id: root }, scope), new Set([score.id, deletedScore])); } catch (cause) { check(cause.message === 'Synthetic purge failure', cause.message); failed = true; }
    finally { IDBObjectStore.prototype.put = put; }
    check(failed && transactions.size === 1 && JSON.stringify(await raw(scope)) === JSON.stringify(beforePurge), 'A partial purge failure rolls back resources, WAVs, indexes and the entire queue');
    transactions.clear();
    IDBObjectStore.prototype.put = function(value, ...args) { if (value.scope === scope) transactions.add(this.transaction); return put.call(this, value, ...args); };
    try { await withoutScoreValues(() => s.purgeTrash({ kind: 'folder', id: root }, scope), new Set([score.id, deletedScore])); }
    finally { IDBObjectStore.prototype.put = put; }
    check(transactions.size === 1, 'All purge writes share one IndexedDB transaction');
    const purged = await raw(scope), queue = await s.syncQueue(scope);
    for (const [kind, id] of [['score', score.id], ['settings', score.id], ['organization', `score.${score.id}`], ['organization', `folder.${root}`], ['organization', `folder.${child}`], ['organization', `folder.${sameName}`], ['organization', `take.${take.id}`]]) {
      check(purged.resources.some(row => row.kind === kind && row.id === id && row.deleted), `Missing tombstone ${kind}:${id}`);
      check(queue.some(job => job.kind === kind && job.id === id && job.deleted), `Missing delete mutation ${kind}:${id}`);
    }
    check(!queue.some(job => job.kind === 'score' && job.id === deletedScore), 'Existing score tombstones do not create new score mutations');
    check(queue.some(job => job.kind === 'take' && job.id === remoteTake && job.operation === 'delete') && (await s.takeSyncEntries(scope)).some(item => item.id === remoteTake && item.deleted), 'Remote-only downloads are purged through the existing take queue');
    check(queue.find(job => job.kind === 'organization' && job.id === `score.${score.id}`).baseRevision === 11, 'Resource deletions preserve their base revision');
    check(queue.some(job => job.kind === 'take' && job.id === take.id && job.operation === 'delete'), 'Take deletion uses its existing queue');
    check(!await s.getTake(take.id, scope) && !!await s.getTake(late.id, scope), 'Purge deletes the contained WAV and preserves an unfiled take');
    await s.applyRemoteTake(scope, take.id, take);
    check(!await s.getTake(take.id, scope), 'Existing take anti-resurrection is unchanged');
    check(JSON.stringify(await raw(other)) === JSON.stringify(untouched), 'Purge leaves another account intact');
    await s.trashItem('score', direct.id, scope); await s.trashItem('take', late.id, scope);
    await s.purgeTrash('all', scope);
    const inventory = [...(await s.savedScores(scope)).map(item => ({ kind: 'score', id: item.id })), ...(await s.listTakes(scope)).map(item => ({ kind: 'take', id: item.id }))];
    check((await s.readOrganization(scope)).trash(inventory).length === 0 && !await s.getTake(late.id, scope), 'Empty trash handles separately trashed files and takes');
    let blocked = false;
    try { await s.purgeTrash({ kind: 'take', id: 'outside-take' }, scope); } catch { blocked = true; }
    check(blocked && !!await s.getTake('outside-take', scope), 'An active item cannot be purged');

    const anonymous = s.ANONYMOUS_SCOPE, adopted = 'user:organization-adopted';
    const anonRoot = await s.createFolder('Anonymous root', null, anonymous), anonChild = await s.createFolder('Anonymous child', anonRoot, anonymous);
    await s.saveScore({ ...score, id: 'anonymous-score' }, anonymous);
    await s.moveItem('score', 'anonymous-score', anonChild, anonymous);
    const anonTake = { ...take, id: crypto.randomUUID(), scoreId: 'anonymous-score' };
    await s.saveTake(anonTake, anonymous); await s.trashItem('take', anonTake.id, anonymous); await s.trashFolder(anonRoot, anonymous);
    await s.saveTake({ ...anonTake, title: 'Existing target take' }, adopted);
    await s.claimAnonymousLibrary(adopted); await s.claimAnonymousTakes(adopted);
    const adoptedOrganization = await s.readOrganization(adopted);
    check(adoptedOrganization.folder(anonChild).parentId === anonRoot && adoptedOrganization.folder(anonChild).trashed, 'Adoption preserves hierarchy and inherited trash');
    check(adoptedOrganization.classify('score', 'anonymous-score').state === 'trash', 'Adoption preserves score placement');
    const movedTake = (await s.listTakes(adopted)).find(item => item.title === anonTake.title);
    check(movedTake && movedTake.id !== anonTake.id && adoptedOrganization.classify('take', movedTake.id).explicitlyTrashed, 'Take ID collision remapping preserves its trash placement');
    check((await s.readOrganization(anonymous)).folders.length === 0 && (await s.listTakes(anonymous)).length === 0, 'Anonymous adoption moves instead of copying');
    check(JSON.stringify(await raw(other)) === JSON.stringify(untouched), 'Adoption cannot claim another account');
    return { scope, other, adopted, root, child, purgedTake: take.id };
  }, syntheticXML('Synthetic organization'));
  assert.equal(organizationResult.scope, 'user:organization-a');
  console.log('PASS organization storage: no score/settings/XML-outbox value reads for classification, only targeted purge reads, remote downloads and existing tombstones; hierarchy, preserved fields, trash/restore, capture inheritance, latest take, atomic purge/rollback, ordinary outbox/take tombstones and scoped anonymous adoption');

  async function openOrganizationLibrary() {
    if (!await organizationPage.locator('.library-panel').count()) await organizationPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
    await organizationPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  }
  const tree = organizationPage.locator('.library-tree');
  const folderNode = id => tree.locator(`li[data-folder-id="${id}"]`);
  const fileNode = (id, kind = 'score') => tree.locator(`li[data-kind="${kind}"][data-id="${id}"]`);
  const selectFolder = id => folderNode(id).locator('> .tree-row .folder-select').click();
  const toggleFolder = id => folderNode(id).locator('> .tree-row .disclosure').click();
  const menuFor = node => node.locator('> .tree-row .more').click();
  async function createOrganizationFolder(name) {
    await tree.getByRole('button', { name: 'Créer un dossier', exact: true }).click();
    const dialog = organizationPage.getByRole('dialog', { name: 'Créer un dossier', exact: true });
    await dialog.getByRole('textbox', { name: 'Nom du dossier', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Enregistrer le dossier', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await organizationPage.waitForFunction(async name => (await (await import('/src/lib/storage.ts')).readOrganization()).folders.some(folder => folder.data.name === name), name);
    return organizationPage.evaluate(async name => (await (await import('/src/lib/storage.ts')).readOrganization()).folders.find(folder => folder.data.name === name).id, name);
  }
  async function importOrganization(title) {
    await organizationPage.locator('input[type=file]').setInputFiles({ name: `${title}.musicxml`, mimeType: 'application/xml', buffer: Buffer.from(syntheticXML(title)) });
    await organizationPage.locator('.library-tree .revealed').getByText(title, { exact: true }).waitFor();
    await openOrganizationLibrary();
    return organizationPage.evaluate(async title => (await (await import('/src/lib/storage.ts')).savedScores()).find(score => score.title === title).id, title);
  }
  async function moveWithKeyboard(node, title, destination) {
    await menuFor(node);
    const button = node.getByRole('button', { name: `Déplacer « ${title} » vers…`, exact: true });
    await button.focus(); await button.press('Enter');
    const dialog = organizationPage.getByRole('dialog', { name: `Déplacer « ${title} » vers…`, exact: true });
    const select = dialog.getByRole('combobox', { name: 'Dossier de destination', exact: true });
    const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
    const folderId = await node.getAttribute('data-folder-id');
    if (folderId) assert(!values.includes(folderId), 'A folder is excluded from its own destinations');
    await select.focus(); await select.press('Home');
    for (let index = 0; index < values.indexOf(destination); index++) await select.press('ArrowDown');
    assert.equal(await select.inputValue(), destination);
    const submit = dialog.getByRole('button', { name: 'Déplacer', exact: true });
    await submit.focus(); await submit.press('Enter'); await dialog.waitFor({ state: 'detached' });
    assert(await organizationPage.evaluate(() => !!document.activeElement?.closest('.library-panel')), 'Closing a move dialog returns focus to the library');
  }
  async function trashWithMenu(node) { await menuFor(node); await node.getByRole('button', { name: 'Mettre à la corbeille', exact: true }).click(); }
  async function restoreWithMenu(node) { await menuFor(node); await node.getByRole('button', { name: 'Restaurer', exact: true }).click(); }
  await openOrganizationLibrary();
  const parent = await createOrganizationFolder('UI parent');
  assert.equal(await tree.locator('.root-select').getAttribute('aria-current'), 'location', 'Creation does not navigate');
  assert.equal(await folderNode(parent).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'false');
  await selectFolder(parent);
  assert.equal(await folderNode(parent).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'false', 'Current folder and disclosure are separate');
  const child = await createOrganizationFolder('UI child');
  assert.equal(await folderNode(parent).locator('> .tree-row .folder-select').getAttribute('aria-current'), 'location');
  assert.equal(await folderNode(parent).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'true', 'Creation reveals the child in its parent');
  await folderNode(child).waitFor();
  const alpha = await importOrganization('UI Alpha');
  await selectFolder(child);
  const needle = await importOrganization('UI Needle');
  assert.equal(await folderNode(child).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'true', 'Import reveals the score in its folder');
  await fileNode(needle).waitFor();
  await selectFolder(parent);
  const empty = await createOrganizationFolder('UI empty');
  await menuFor(folderNode(empty)); await folderNode(empty).getByRole('button', { name: 'Renommer le dossier', exact: true }).click();
  await organizationPage.getByRole('dialog').getByRole('textbox').fill('UI renamed');
  await organizationPage.getByRole('dialog').getByRole('button', { name: 'Enregistrer le dossier', exact: true }).click();
  await organizationPage.getByRole('dialog').waitFor({ state: 'detached' });
  await folderNode(empty).getByText('UI renamed', { exact: true }).waitFor();
  await tree.locator('.root-select').click();
  const destination = await createOrganizationFolder('UI target');
  await moveWithKeyboard(fileNode(alpha), 'UI Alpha', destination);
  await moveWithKeyboard(folderNode(child), 'UI child', destination);
  assert.equal(await folderNode(destination).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'false');
  await organizationPage.getByRole('searchbox', { name: 'Rechercher une partition', exact: true }).fill('Needle');
  await fileNode(needle).waitFor();
  assert.equal(await fileNode(alpha).count(), 0);
  assert.equal(await folderNode(destination).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'true');
  await organizationPage.getByRole('searchbox', { name: 'Rechercher une partition', exact: true }).fill('');
  assert.equal(await folderNode(destination).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'false', 'Search never changes normal expansion');
  const uiTake = await organizationPage.evaluate(async ({ needle, xml }) => {
    const s = await import('/src/lib/storage.ts'), { microphoneWav } = await import('/src/lib/wav.ts');
    const id = crypto.randomUUID(), settings = { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] };
    await s.saveTake({ id, createdAt: 1, title: 'UI Take', scoreId: needle, scoreXML: xml, duration: 64 / 48000, sampleRate: 48000, samples: 64, captureStartedAt: 0, settings, latencyMs: 0, detector: { name: 'Synthetic' }, pitches: [], transport: [], audio: microphoneWav([new Float32Array(64)], 48000) });
    return id;
  }, { needle, xml: syntheticXML('UI Needle') });
  await trashWithMenu(folderNode(destination));
  await folderNode(destination).waitFor({ state: 'detached' });
  await tree.locator('.trash-select').click();
  await tree.locator('.trash-list > .folder-entry').waitFor();
  assert.equal(await organizationPage.getByRole('searchbox', { name: 'Rechercher une partition', exact: true }).count(), 0, 'Library search excludes the trash view');
  assert.equal(await tree.locator('.trash-list > li').count(), 1, 'Trash lists subtree roots without duplicating their files');
  await toggleFolder(destination); await fileNode(alpha).waitFor(); await fileNode(needle).waitFor();
  assert.equal(await fileNode(uiTake, 'take').count(), 1);
  await restoreWithMenu(folderNode(child));
  await folderNode(child).waitFor({ state: 'detached' });
  assert.equal(await organizationPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).readOrganization()).folder(id).parentId, child), null, 'Restoring under a trashed ancestor detaches');
  await restoreWithMenu(folderNode(destination));
  await tree.getByText('La corbeille est vide.', { exact: true }).waitFor();
  await tree.locator('.root-select').click(); await fileNode(alpha).waitFor();
  await trashWithMenu(fileNode(alpha)); await fileNode(alpha).waitFor({ state: 'detached' });
  await tree.locator('.trash-select').click(); await fileNode(alpha).waitFor();
  assert.equal(await tree.locator('.trash-list > li').count(), 1, 'A score can be trashed alone');
  assert(await organizationPage.evaluate(async id => !!await (await import('/src/lib/storage.ts')).getTake(id), uiTake));
  await organizationPage.evaluate(async id => {
    const s = await import('/src/lib/storage.ts');
    await s.applyRemoteChanges(s.storageScope(), [{ kind: 'organization', id: `folder.${id}`, data: null, revision: 100, deleted: true }], 100);
  }, destination);
  await restoreWithMenu(fileNode(alpha));
  await tree.locator('.root-select').click(); await fileNode(alpha).waitFor();
  assert.equal(await organizationPage.evaluate(async id => (await (await import('/src/lib/storage.ts')).readOrganization()).classify('score', id).state, alpha), 'unfiled', 'Restoration handles a missing parent');
  await selectFolder(child);
  await organizationPage.locator('.library-panel').getByRole('button', { name: 'Fermer la bibliothèque', exact: true }).click();
  await organizationPage.getByRole('button', { name: 'Enregistrements', exact: true }).click();
  const takeCard = organizationPage.locator('.take-card').filter({ hasText: 'UI Take' }); await takeCard.waitFor();
  await takeCard.getByRole('button', { name: 'Supprimer cet essai', exact: true }).click();
  await takeCard.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
  await takeCard.waitFor({ state: 'detached' });
  assert(await organizationPage.evaluate(async id => !!await (await import('/src/lib/storage.ts')).getTake(id), uiTake), 'Trashing a take keeps its WAV');
  await organizationPage.evaluate(async id => (await import('/src/lib/storage.ts')).trashFolder(id), child);
  await organizationPage.waitForFunction(() => document.querySelector('#take-folder')?.value === 'all');
  await organizationPage.evaluate(async id => (await import('/src/lib/storage.ts')).restoreFolder(id), child);
  await organizationPage.locator('.take-panel .trash-link').click();
  await fileNode(uiTake, 'take').waitFor(); await restoreWithMenu(fileNode(uiTake, 'take'));
  await tree.locator('.root-select').click();
  await trashWithMenu(folderNode(parent)); await folderNode(parent).waitFor({ state: 'detached' });
  await trashWithMenu(fileNode(alpha)); await fileNode(alpha).waitFor({ state: 'detached' });
  await organizationPage.evaluate(async ({ uiTake, alpha }) => {
    const s = await import('/src/lib/storage.ts');
    await s.writeSettings(alpha, { rate: 1, loopA: null, loopB: null, loopEnabled: false, target: 0, parts: [] });
    await s.trashItem('take', uiTake);
    await s.saveScore({ id: 'ui-discard', title: 'UI Discard', composer: '', xml: '<score-partwise/>', added: 2 });
  }, { uiTake, alpha });
  await fileNode('ui-discard').waitFor(); await trashWithMenu(fileNode('ui-discard')); await tree.locator('.trash-select').click();
  await fileNode('ui-discard').waitFor(); await menuFor(fileNode('ui-discard'));
  await fileNode('ui-discard').getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
  await organizationPage.getByRole('dialog').getByText('Dossiers : 0 · Partitions : 1 · Essais : 0', { exact: true }).waitFor();
  await organizationPage.getByRole('dialog').getByRole('button', { name: 'Confirmer la suppression définitive', exact: true }).click();
  await organizationPage.getByRole('dialog').waitFor({ state: 'detached' });
  await tree.locator('.empty-trash').click();
  await organizationPage.getByRole('dialog').getByText('Dossiers : 2 · Partitions : 1 · Essais : 1', { exact: true }).waitFor();
  await organizationPage.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  assert(await organizationPage.evaluate(async id => !!await (await import('/src/lib/storage.ts')).getTake(id), uiTake), 'Cancelling the confirmation preserves data');
  await tree.locator('.empty-trash').click();
  await organizationPage.getByRole('dialog').getByRole('button', { name: 'Confirmer la suppression définitive', exact: true }).click();
  await organizationPage.getByRole('dialog').waitFor({ state: 'detached' });
  await tree.getByText('La corbeille est vide.', { exact: true }).waitFor();
  assert.deepEqual(await organizationPage.evaluate(async ({ alpha, needle, uiTake }) => {
    const s = await import('/src/lib/storage.ts');
    return [(await s.savedScores()).some(score => score.id === alpha), (await s.savedScores()).some(score => score.id === needle), !!await s.readSettings(alpha), !!await s.getTake(uiTake)];
  }, { alpha, needle, uiTake }), [false, true, false, false]);
  await organizationPage.reload(); await ready(organizationPage); await openOrganizationLibrary();
  assert.equal(await folderNode(child).locator('> .tree-row .disclosure').getAttribute('aria-expanded'), 'false');
  await toggleFolder(child); await fileNode(needle).waitFor();
  assert.equal(await fileNode(alpha).count(), 0, 'Deletion persists after reload');
  for (const [width, height, theme] of [[350, 760, 'light'], [740, 350, 'dark']]) {
    await organizationPage.setViewportSize({ width, height });
    await organizationPage.locator('.library-panel').waitFor({ state: 'detached' });
    await organizationPage.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await openOrganizationLibrary(); await tree.locator('.trash-select').scrollIntoViewIfNeeded();
    const layout = await organizationPage.locator('.library-panel').evaluate(panel => ({ width: panel.getBoundingClientRect().width, client: panel.clientWidth, scroll: panel.scrollWidth, targets: [...panel.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => [button.getBoundingClientRect().width, button.getBoundingClientRect().height]) }));
    assert(layout.width <= width && layout.scroll <= layout.client + 1, 'The panel has no horizontal overflow');
    assert(layout.targets.every(([w, h]) => w >= 43.9 && h >= 43.9), JSON.stringify(layout.targets));
    await organizationPage.screenshot({ path: `/tmp/chansonade-library-${width}.png` });
    await tree.locator('.trash-select').tap();
    await tree.getByText('La corbeille est vide.', { exact: true }).waitFor();
    await tree.locator('.root-select').tap();
  }
  await organizationPage.setViewportSize({ width: 1150, height: 850 });
  await menuFor(fileNode(needle));
  await fileNode(needle).getByRole('button', { name: 'Déplacer « UI Needle » vers…', exact: true }).click();
  await organizationPage.getByRole('dialog').waitFor();
  await organizationPage.evaluate(async ({ adopted }) => { const s = await import('/src/lib/storage.ts'); s.setStorageScope(adopted); }, organizationResult);
  await organizationPage.getByRole('dialog').waitFor({ state: 'detached' });
  await ready(organizationPage); await openOrganizationLibrary();
  assert.equal(await tree.locator('.root-select').getAttribute('aria-current'), 'location');
  assert.equal(await tree.locator('.file-entry').count(), 0, 'Account change excludes its adopted trash');
  await tree.locator('.trash-select').click();
  assert.equal(await tree.locator('.trash-list > .folder-entry').count(), 1);
  assert.equal(await tree.locator('.trash-list > .folder-entry > .tree-row .disclosure').getAttribute('aria-expanded'), 'false', 'Account change resets expansion');
  for (const language of ['en', 'de', 'nl']) {
    const translated = await organizationPage.evaluate(async language => {
      const i = await import('/src/lib/i18n.ts'); i.setLanguage(language);
      const keys = ['Corbeille', 'Déplacer vers…', 'Dossier courant : {path}', 'Supprimer définitivement', 'Vider la corbeille', 'Confirmer la suppression définitive', 'Déplier ou replier « {title} »'];
      return keys.map(key => [key, i.translate(key)]);
    }, language);
    assert(translated.every(([key, value]) => key !== value), JSON.stringify(translated));
    await organizationPage.waitForFunction(text => document.querySelector('.trash-select')?.textContent.includes(text), translated[0][1]);
    assert((await tree.locator('.empty-trash').innerText()).includes(translated[4][1]));
  }
  console.log('PASS organization UI: separate current/disclosure, create in place, empty folders, rename, keyboard moves, global search without expansion changes, subtree/item/take trash and restore, missing parents, counted permanent deletion/cancellation, persistence, accounts, 44px portrait/landscape and EN/DE/NL');

  const dragContext = await isolatedContext(null, { hasTouch: true });
  await dragContext.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  await dragContext.route('**/scores/*', route => route.request().url().includes('catalog.json') ? route.continue() : route.fulfill({ contentType: 'application/xml', body: syntheticXML('Drag active document') }));
  await dragContext.addInitScript(() => {
    window.__dragPointers = [];
    window.addEventListener('pointerdown', event => window.__dragPointers.push({ type: event.pointerType, trusted: event.isTrusted }), true);
  });
  const dragPage = await dragContext.newPage(); await dragPage.goto(url); await ready(dragPage);
  const dragIds = await dragPage.evaluate(async xml => {
    const s = await import('/src/lib/storage.ts');
    const ids = { source: crypto.randomUUID(), branch: crypto.randomUUID(), nested: crypto.randomUUID(), gone: crypto.randomUUID(), trash: crypto.randomUUID() };
    const folders = [
      { id: ids.source, name: 'Drag source folder', added: 1 },
      { id: ids.branch, name: 'Drag branch', added: 2 },
      { id: ids.nested, name: 'Drag nested', added: 3, parentId: ids.branch },
      { id: ids.gone, name: 'Drag removed', added: 4 },
      { id: ids.trash, name: 'Trashed destination', added: 5, trashedAt: 1 },
      ...Array.from({ length: 14 }, (_, i) => ({ id: crypto.randomUUID(), name: `Scroll folder ${i}`, added: 20 + i })),
    ];
    await s.applyRemoteChanges(s.storageScope(), folders.map((folder, index) => ({ kind: 'organization', id: `folder.${folder.id}`, revision: index + 1, deleted: false, data: { type: 'folder', name: folder.name, added: folder.added, parentId: folder.parentId ?? null, ...(folder.trashedAt ? { trashedAt: folder.trashedAt } : {}) } })), folders.length);
    ids.score = await s.scoreId(xml);
    await s.saveScore({ id: ids.score, title: 'Dragged score', composer: '', xml, added: 1 });
    await s.moveItem('score', ids.score, ids.source);
    const { Score } = await import('/src/lib/score.ts'); const load = Score.prototype.load;
    window.__dragOpened = 0;
    Score.prototype.load = function(...args) { window.__dragOpened++; return load.apply(this, args); };
    return ids;
  }, syntheticXML('Dragged score'));
  const dragTree = dragPage.locator('.library-tree'), dragPanel = dragPage.locator('.library-panel');
  const sourceHandle = dragTree.locator(`[data-score-drag="${dragIds.score}"]`);
  const destinationRow = id => dragTree.locator(`[data-score-drop="${id}"]`);
  const input = await dragContext.newCDPSession(dragPage);
  async function openDragLibrary() {
    if (!await dragPanel.count()) await dragPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
    await dragPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  }
  async function resetDragSource() {
    await dragPage.evaluate(async ids => (await import('/src/lib/storage.ts')).moveItem('score', ids.score, ids.source), dragIds);
    await openDragLibrary();
    const disclosure = destinationRow(dragIds.source).locator('.disclosure');
    if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
    await dragTree.locator(`[data-folder-id="${dragIds.source}"] [data-score-drag="${dragIds.score}"]`).waitFor();
    await dragPanel.evaluate(panel => panel.scrollTop = 0);
  }
  const center = async locator => { const box = await locator.boundingBox(); assert(box); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  async function startPointer(kind) {
    await sourceHandle.scrollIntoViewIfNeeded(); const point = await center(sourceHandle);
    if (kind === 'mouse') { await dragPage.mouse.move(point.x, point.y); await dragPage.mouse.down(); }
    else if (kind === 'pen') await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, pointerType: 'pen' });
    else await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
    return point;
  }
  async function movePointer(kind, point) {
    if (kind === 'mouse') await dragPage.mouse.move(point.x, point.y, { steps: 8 });
    else if (kind === 'pen') await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1, pointerType: 'pen' });
    else await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
  }
  async function endPointer(kind, point) {
    if (kind === 'mouse') await dragPage.mouse.up();
    else if (kind === 'pen') await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, pointerType: 'pen' });
    else await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function assertPlacement(folderId) {
    await dragPage.waitForFunction(async ({ id, folderId }) => (await (await import('/src/lib/storage.ts')).readOrganization()).classify('score', id).folderId === folderId, { id: dragIds.score, folderId });
    assert.equal(await dragTree.locator('[data-score-dragging], .score-drag-preview, [data-score-drop-active]').count(), 0);
  }
  await resetDragSource();
  let point = await startPointer('mouse');
  await movePointer('mouse', { x: point.x + 3, y: point.y + 2 }); await endPointer('mouse', point);
  await assertPlacement(dragIds.source);
  assert.equal(await dragPage.evaluate(() => window.__dragOpened), 0, 'A short handle press never opens the score');
  await startPointer('mouse');
  point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point);
  assert.equal(await destinationRow(dragIds.branch).locator('.disclosure').getAttribute('aria-expanded'), 'false', 'Hover does not expand immediately');
  await destinationRow(dragIds.branch).locator('.disclosure[aria-expanded="true"]').waitFor();
  point = await center(destinationRow(dragIds.nested)); await movePointer('mouse', point);
  await destinationRow(dragIds.nested).locator('xpath=self::*[@data-score-drop-active]').waitFor();
  await endPointer('mouse', point); await assertPlacement(dragIds.nested);
  assert((await dragTree.locator('[role=status]').innerText()).includes('Dragged score'));
  await startPointer('mouse'); point = await center(dragTree.locator('.root-select')); await movePointer('mouse', point); await endPointer('mouse', point); await assertPlacement(null);
  await resetDragSource(); await startPointer('mouse');
  const bounds = await dragPanel.boundingBox();
  point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 6 };
  await movePointer('mouse', point);
  await dragPage.waitForFunction(() => {
    const panel = document.querySelector('.library-panel'), row = panel.querySelector('.unfiled-entry > .tree-row').getBoundingClientRect();
    return panel.scrollTop > 100 && row.bottom < innerHeight - 3;
  });
  point = await center(dragTree.locator('.unfiled-entry > .tree-row')); await movePointer('mouse', point); await endPointer('mouse', point); await assertPlacement(null);
  await startPointer('mouse'); await movePointer('mouse', { x: bounds.x + bounds.width / 2, y: bounds.y + 6 });
  await dragPage.waitForFunction(() => document.querySelector('.library-panel').scrollTop < 5);
  point = await center(dragTree.locator('.root-select')); await movePointer('mouse', point); await endPointer('mouse', point); await assertPlacement(null);
  await resetDragSource(); await startPointer('mouse');
  point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point); await dragPage.keyboard.press('Escape'); await endPointer('mouse', point); await assertPlacement(dragIds.source);
  await resetDragSource(); await startPointer('mouse');
  point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point);
  await dragPanel.getByRole('button', { name: 'Fermer la bibliothèque', exact: true }).focus(); await dragPage.keyboard.press('Enter');
  await dragPanel.waitFor({ state: 'detached' }); await endPointer('mouse', point); await openDragLibrary(); await assertPlacement(dragIds.source);
  await resetDragSource(); await startPointer('mouse');
  await movePointer('mouse', { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 6 });
  await dragPage.waitForFunction(() => document.querySelector('.library-tree .trash-select').getBoundingClientRect().bottom < innerHeight - 3);
  point = await center(dragTree.locator('.trash-select')); await movePointer('mouse', point);
  assert.equal(await dragTree.locator('[data-score-drop-active]').count(), 0);
  await endPointer('mouse', point); await assertPlacement(dragIds.source);
  assert.notEqual(await dragTree.locator('.trash-select').getAttribute('aria-current'), 'location', 'Release does not activate the trash entry');
  assert.equal(await dragTree.locator(`[data-score-drop="${dragIds.trash}"]`).count(), 0);
  await resetDragSource(); await startPointer('mouse');
  point = await center(destinationRow(dragIds.gone)); await movePointer('mouse', point);
  const peer = await dragContext.newPage();
  await peer.route('**/synthetic-drag-peer', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic peer</title>' }));
  await peer.goto(`${url}/synthetic-drag-peer`);
  await peer.evaluate(async id => {
    const s = await import('/src/lib/storage.ts');
    await s.applyRemoteChanges(s.storageScope(), [{ kind: 'organization', id: `folder.${id}`, revision: 100, deleted: true, data: null }], 100);
  }, dragIds.gone);
  await peer.close();
  await endPointer('mouse', point); await assertPlacement(dragIds.source);
  await dragPage.waitForFunction(() => document.querySelector('.library-tree [role=status]').textContent.includes('Dossier introuvable.'));
  await resetDragSource(); await startPointer('pen');
  point = await center(destinationRow(dragIds.branch)); await movePointer('pen', point); await endPointer('pen', point); await assertPlacement(dragIds.branch);
  await resetDragSource(); await startPointer('touch');
  point = await center(destinationRow(dragIds.nested)); await movePointer('touch', point); await endPointer('touch', point); await assertPlacement(dragIds.nested);
  await startPointer('touch'); point = await center(dragTree.locator('.root-select')); await movePointer('touch', point); await endPointer('touch', point); await assertPlacement(null);
  await resetDragSource(); await startPointer('touch');
  point = await center(destinationRow(dragIds.nested)); await movePointer('touch', point);
  await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await assertPlacement(dragIds.source);
  assert.equal(await dragPage.evaluate(() => window.__dragOpened), 0, 'Mouse, pen and cancellation never open a score');
  for (const [width, height] of [[350, 760], [740, 350]]) {
    await dragPage.setViewportSize({ width, height }); await dragPanel.waitFor({ state: 'detached' });
    await resetDragSource(); await startPointer('touch');
    const panel = await dragPanel.boundingBox(); point = { x: panel.x + panel.width / 2, y: panel.y + panel.height - 6 };
    await movePointer('touch', point);
    await dragPage.waitForFunction(() => { const panel = document.querySelector('.library-panel'), row = panel.querySelector('.unfiled-entry > .tree-row').getBoundingClientRect(); return panel.scrollTop > 100 && row.bottom < innerHeight - 3; });
    point = await center(dragTree.locator('.unfiled-entry > .tree-row')); await movePointer('touch', point); await endPointer('touch', point); await assertPlacement(null);
    await resetDragSource();
    const file = dragTree.locator(`[data-kind="score"][data-id="${dragIds.score}"] .file-open`); await file.scrollIntoViewIfNeeded();
    const start = await center(file), before = await dragPanel.evaluate(panel => panel.scrollTop);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: Math.max(5, start.y - 100), id: 1 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await dragPage.waitForFunction(before => document.querySelector('.library-panel').scrollTop > before, before);
    assert.equal(await dragTree.locator('[data-score-dragging]').count(), 0, 'The score body retains native touch scrolling');
  }
  await dragPage.setViewportSize({ width: 1150, height: 850 }); await resetDragSource(); await startPointer('mouse');
  point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point);
  const record = dragPage.getByRole('button', { name: 'Enregistrer un essai', exact: true }); await record.focus(); await record.press('Enter');
  await dragPage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).waitFor();
  await endPointer('mouse', point); await assertPlacement(dragIds.source);
  assert(await sourceHandle.isDisabled());
  const disabledStart = await center(sourceHandle); await dragPage.mouse.move(disabledStart.x, disabledStart.y); await dragPage.mouse.down(); await movePointer('mouse', point); await dragPage.mouse.up(); await assertPlacement(dragIds.source);
  await dragPage.getByRole('button', { name: 'Arrêter l’essai', exact: true }).focus(); await dragPage.keyboard.press('Enter');
  await record.waitFor(); await sourceHandle.waitFor(); await dragPage.waitForFunction(() => !document.querySelector('[data-score-drag]')?.disabled);
  await resetDragSource(); await startPointer('mouse'); point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point);
  await dragPage.evaluate(async () => (await import('/src/lib/storage.ts')).setStorageScope('user:drag-other'));
  await endPointer('mouse', point);
  await dragPage.waitForFunction(() => !document.querySelector('[data-score-dragging], .score-drag-preview, [data-score-drop-active]'));
  assert.equal(await dragPage.evaluate(async ids => (await (await import('/src/lib/storage.ts')).readOrganization('anonymous')).classify('score', ids.score).folderId, dragIds), dragIds.source);
  assert.equal(await dragPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).syncQueue('user:drag-other')).length), 0);
  await dragPage.evaluate(async () => (await import('/src/lib/storage.ts')).setStorageScope('anonymous')); await ready(dragPage); await resetDragSource();
  // The handle gives keyboard users the existing move dialogue, not a second keyboard drag policy.
  await sourceHandle.focus(); await dragPage.keyboard.press('Enter');
  await dragTree.getByRole('button', { name: 'Déplacer « Dragged score » vers…', exact: true }).press('Enter');
  await dragPage.getByRole('dialog').waitFor(); await dragPage.keyboard.press('Escape');
  await dragPage.getByRole('dialog').waitFor({ state: 'detached' });
  for (const [theme, language, label, cancelled, moved, instruction] of [
    ['light', 'English', 'Drag “Dragged score” to a folder', 'Move cancelled.', 'Score “Dragged score” moved to “Drag branch”.', 'Drag the handle to a folder'],
    ['dark', 'Deutsch', '„Dragged score“ in einen Ordner ziehen', 'Verschieben abgebrochen.', 'Partitur „Dragged score“ nach „Drag branch“ verschoben.', 'Ziehe den Griff in einen Ordner'],
    ['light', 'Nederlands', '‘Dragged score’ naar een map slepen', 'Verplaatsing geannuleerd.', 'Partituur ‘Dragged score’ verplaatst naar ‘Drag branch’.', 'Sleep de greep naar een map'],
  ]) {
    await dragPanel.locator('.section-heading button').click();
    await dragPage.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await dragPage.locator('.display-preferences summary').click();
    await dragPage.locator('.display-preferences').getByRole('button', { name: language, exact: true }).click();
    await dragPage.locator('.library-toggle').click();
    assert.equal(await sourceHandle.getAttribute('aria-label'), label);
    assert.match(await dragTree.locator('#score-drag-help').innerText(), new RegExp(instruction));
    await startPointer('mouse'); point = await center(destinationRow(dragIds.branch)); await movePointer('mouse', point);
    const colors = await destinationRow(dragIds.branch).evaluate(row => {
      const style = getComputedStyle(row), preview = getComputedStyle(document.querySelector('.score-drag-preview'));
      return { outline: style.outlineWidth, background: style.backgroundColor, panel: getComputedStyle(row.closest('.library-panel')).backgroundColor, preview: preview.backgroundColor, ink: preview.color };
    });
    assert.equal(colors.outline, '2px'); assert.notEqual(colors.background, colors.panel); assert.notEqual(colors.preview, colors.ink);
    await dragPage.keyboard.press('Escape'); await endPointer('mouse', point); await assertPlacement(dragIds.source);
    assert.equal(await dragTree.locator('[role=status]').innerText(), cancelled);
    await startPointer('mouse'); await movePointer('mouse', point); await endPointer('mouse', point); await assertPlacement(dragIds.branch);
    await dragPage.waitForFunction(text => document.querySelector('.library-tree [role=status]').textContent === text, moved);
    await dragPage.evaluate(async ids => (await import('/src/lib/storage.ts')).moveItem('score', ids.score, ids.source), dragIds);
    await dragTree.locator(`[data-folder-id="${dragIds.source}"] [data-score-drag="${dragIds.score}"]`).waitFor();
  }
  const openedBefore = await dragPage.evaluate(() => window.__dragOpened);
  await dragTree.locator(`[data-kind="score"][data-id="${dragIds.score}"] .file-open`).click();
  await dragPage.waitForFunction(() => document.querySelector('h1')?.textContent === 'Dragged score');
  assert.equal(await dragPage.evaluate(() => window.__dragOpened), openedBefore + 1, 'The rest of the score row still opens the score');
  const pointers = await dragPage.evaluate(() => window.__dragPointers);
  assert(pointers.every(event => event.trusted));
  assert.deepEqual([...new Set(pointers.map(event => event.type))].sort(), ['mouse', 'pen', 'touch']);
  await input.detach();
  console.log('PASS score drag: trusted mouse/pen/touch, threshold, nested/root/unfiled drops, hover expansion and edge scroll, forbidden trash, Escape/cancel/unmount/account/recording cancellation, transactional removed destination and no release opening');

  assert.deepEqual(errors, [], 'No unhandled browser errors');
} finally {
  for (const context of contexts.reverse()) await context.close();
  // connectOverCDP.close disconnects this client; it does not stop the CDP host.
  await browser.close();
}
