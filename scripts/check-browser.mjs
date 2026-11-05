// Isolated, synthetic browser regression checks. No real microphone or account.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194';
const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const contexts = [];
const errors = [];

async function isolatedContext(account = null) {
  const context = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1150, height: 850 }, serviceWorkers: 'block' });
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

try {
  const context = await isolatedContext();
  await context.route('**/api/v1/**', route => route.fulfill({ json: { user: null, registration: 'open' } }));
  const page = await context.newPage();
  await page.goto(url); await ready(page);
  const original = await readFile(new URL('../public/scores/une-souris-verte-chant-piano.musicxml', import.meta.url), 'utf8');
  const title = 'CI synthetic score';
  const xml = original.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${title}</work-title>`);
  await page.locator('input[type="file"]').setInputFiles({ name: 'ci-synthetic.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.waitForFunction(title => document.querySelector('h1')?.textContent === title, title); await ready(page);
  const pagesBefore = await page.locator('.sheet-page').count();
  assert(pagesBefore > 0);
  await page.locator('input[type="file"]').setInputFiles({ name: 'ci-too-large.musicxml', mimeType: 'application/xml', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32) });
  await page.locator('.error-card').waitFor();
  assert.match(await page.locator('.error-card p').innerText(), /5 Mio/);
  assert.equal(await page.locator('h1').innerText(), title, 'Rejected import keeps the current document');
  assert.equal(await page.locator('.sheet-page').count(), pagesBefore, 'Rejected import keeps the engraving');
  await page.locator('.error-card').getByRole('button', { name: 'Fermer', exact: true }).click();
  console.log('PASS browser: valid import and oversized import without losing the document');
  const savedBefore = await page.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length);
  for (const invalid of [
    original.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${'x'.repeat(501)}</work-title>`),
    original.replace(/<creator type="composer">[^<]*<\/creator>/, `<creator type="composer">${'x'.repeat(501)}</creator>`),
  ]) {
    await page.locator('input[type="file"]').setInputFiles({ name: 'invalid-metadata.musicxml', mimeType: 'application/xml', buffer: Buffer.from(invalid) });
    await page.locator('.error-card').waitFor();
    assert.match(await page.locator('.error-card p').innerText(), /500 caractères/);
    assert.equal(await page.locator('h1').innerText(), title);
    assert.equal(await page.locator('.sheet-page').count(), pagesBefore);
    assert.equal(await page.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).length), savedBefore);
    await page.locator('.error-card').getByRole('button', { name: 'Fermer', exact: true }).click();
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
  await page.locator('.language-picker summary').click();
  await page.locator('.language-picker').getByRole('button', { name: 'English', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(await page.locator('.score-facts').innerText(), /bars/);
  await page.locator('.language-picker summary').click();
  await page.locator('.language-picker').getByRole('button', { name: 'Français', exact: true }).click();
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
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() {
      const result = await read.call(this);
      if (this.name === window.__holdFile) {
        window.__holdFile = null;
        await new Promise((resolve, reject) => { window.__releaseFile = error => error ? reject(Error(error)) : resolve(); });
      }
      return result;
    };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) => {
      const result = await digest(algorithm, data);
      if (window.__holdDigestTitle && new TextDecoder().decode(data).includes(window.__holdDigestTitle)) {
        window.__holdDigestTitle = null;
        await new Promise(resolve => { window.__releaseDigest = resolve; });
      }
      return result;
    };
  });
  const importOpening = (title, name = `${title}.musicxml`) => openingPage.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(syntheticXML(title)) });
  const settledOpening = async title => {
    await openingPage.waitForFunction(title => document.querySelector('h1')?.textContent === title && document.querySelector('.transport .play-button')?.disabled === false && !document.querySelector('.loading-overlay'), title);
    await openingPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await openingPage.locator('h1').innerText(), title);
    assert.equal(await openingPage.locator('.loading-overlay, .error-card').count(), 0);
    assert.equal(await openingPage.locator('.sheet-page > svg').first().getAttribute('aria-label'), title);
  };
  const releaseOpening = name => openingPage.evaluate(name => { window[name](); delete window[name]; }, name);
  await importOpening('Startup winner'); await settledOpening('Startup winner');
  await releaseOpening('__releaseLibrary'); await openingPage.waitForLoadState('networkidle'); await settledOpening('Startup winner');
  assert.equal(catalogueRequests, 0, 'The superseded initial library lookup must not fetch its fallback');
  await openingPage.getByRole('button', { name: 'Bibliothèque', exact: true }).click();
  await openingPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  assert.equal(await openingPage.locator('.saved-piece strong').filter({ hasText: 'Startup winner' }).count(), 1, 'An old library read must not erase the newly imported score from the list');
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
  await openingPage.evaluate(() => { window.__holdFile = 'loading-winner.musicxml'; });
  await importOpening('Loading winner', 'loading-winner.musicxml');
  await openingPage.waitForFunction(() => !!window.__releaseFile);
  await releaseCatalogue();
  await openingPage.waitForLoadState('networkidle');
  assert.equal(await openingPage.locator('.loading-overlay').count(), 1);
  assert.equal(await openingPage.locator('.error-card').count(), 0);
  await releaseOpening('__releaseFile'); await settledOpening('Loading winner');

  for (const failure of [false, true]) {
    await openingPage.evaluate(() => { window.__holdFile = 'obsolete.musicxml'; });
    await importOpening('Obsolete file', 'obsolete.musicxml');
    await openingPage.waitForFunction(() => !!window.__releaseFile);
    await importOpening('Import winner'); await settledOpening('Import winner');
    await openingPage.evaluate(failure => { window.__releaseFile(failure ? 'Synthetic stale file error' : null); delete window.__releaseFile; }, failure);
    await settledOpening('Import winner');
    assert(!await openingPage.evaluate(async () => (await (await import('/src/lib/storage.ts')).savedScores()).some(score => score.title === 'Obsolete file')));
  }
  // Identical content IDs do not make an older choice current again.
  await openingPage.evaluate(() => { window.__holdDigestTitle = 'Same content'; });
  await importOpening('Same content'); await openingPage.waitForFunction(() => !!window.__releaseDigest);
  await importOpening('Same content'); await settledOpening('Same content');
  const loadsBefore = await openingPage.evaluate(() => window.__openingLoads.length);
  await releaseOpening('__releaseDigest'); await settledOpening('Same content');
  assert.equal(await openingPage.evaluate(() => window.__openingLoads.length), loadsBefore);

  await openingPage.evaluate(() => { window.__holdEngineTitle = 'Obsolete engraving'; });
  await importOpening('Obsolete engraving'); await openingPage.waitForFunction(() => !!window.__releaseEngine);
  await importOpening('Engraving winner'); await settledOpening('Engraving winner');
  await releaseOpening('__releaseEngine'); await settledOpening('Engraving winner');
  await openingPage.evaluate(() => { window.__holdAudio = true; });
  await importOpening('Obsolete instruments'); await openingPage.waitForFunction(() => !!window.__releaseAudio);
  await openingPage.evaluate(() => { window.__holdFile = 'audio-winner.musicxml'; });
  await importOpening('Audio winner', 'audio-winner.musicxml'); await openingPage.waitForFunction(() => !!window.__releaseFile);
  await openingPage.evaluate(() => { window.__releaseAudio('Synthetic stale audio error'); delete window.__releaseAudio; });
  await openingPage.waitForLoadState('networkidle');
  assert.equal(await openingPage.locator('.loading-overlay').count(), 1);
  assert.equal(await openingPage.locator('.error-card').count(), 0);
  await releaseOpening('__releaseFile'); await settledOpening('Audio winner');

  // A saved choice supersedes a pending catalogue fetch too.
  let releaseSaved, savedEntered;
  const waitingSaved = new Promise(resolve => { savedEntered = resolve; });
  heldCatalogue = route => { releaseSaved = () => route.fulfill({ contentType: 'application/xml', body: syntheticXML('Old catalogue before library') }); savedEntered(); };
  await selectCatalogue(catalogue[0]); await waitingSaved;
  await openingPage.getByRole('button', { name: 'Mes partitions', exact: true }).click();
  await openingPage.locator('.saved-piece .piece').filter({ has: openingPage.locator('strong', { hasText: 'Startup winner' }) }).click();
  await settledOpening('Startup winner'); await releaseSaved(); await openingPage.waitForLoadState('networkidle'); await settledOpening('Startup winner');

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
  await openingPage.evaluate(() => { window.__holdFile = 'private-obsolete.musicxml'; });
  await importOpening('Private obsolete', 'private-obsolete.musicxml'); await openingPage.waitForFunction(() => !!window.__releaseFile);
  await openingPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:opening-b'); });
  await settledOpening('Account B');
  await openingPage.evaluate(async () => { const s = await import('/src/lib/storage.ts'); s.setStorageScope('user:opening-a'); });
  await settledOpening('Account A');
  await releaseOpening('__releaseFile'); await settledOpening('Account A');
  assert(await openingPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts');
    return (await Promise.all(['anonymous', 'user:opening-a', 'user:opening-b'].map(scope => s.savedScores(scope)))).every(scores => !scores.some(score => score.title === 'Private obsolete'));
  }));
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
  console.log('PASS browser: latest opening wins across startup, catalogue success/errors, import reads/hash, saved library, engraving/audio and A-B-A account changes; account opening waits for capture saved in its original scope');

  assert.deepEqual(errors, [], 'No unhandled browser errors');
} finally {
  for (const context of contexts.reverse()) await context.close();
  // connectOverCDP.close disconnects this client; it does not stop the CDP host.
  await browser.close();
}
