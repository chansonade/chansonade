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
  assert.equal(pending[0].mutationId, attempts[0]); assert.equal(pending[0].sent, true);
  networkRestored = true;
  await syncPage.evaluate(async () => { const { synchronize } = await import('/src/lib/sync.ts'); await synchronize(); });
  await syncPage.waitForFunction(async () => { const s = await import('/src/lib/storage.ts'); return (await s.pendingMutations(s.storageScope())).length === 0; });
  const drained = await syncPage.evaluate(async () => {
    const s = await import('/src/lib/storage.ts'); return { pending: (await s.pendingMutations(s.storageScope())).length, scores: (await s.savedScores()).filter(score => score.title === 'CI sync resource').length, cursor: await s.syncCursor(s.storageScope()) };
  });
  assert.equal(drained.pending, 0); assert.equal(drained.scores, 1); assert.equal(drained.cursor, 1);
  assert(attempts.length >= 2); assert(attempts.every(id => id === attempts[0])); assert.equal(applied, 1); assert.equal(resources.size, 1);
  console.log('PASS browser: lost sync response preserves and retries the same mutation without duplicate writes');
  assert.deepEqual(errors, [], 'No unhandled browser errors');
} finally {
  for (const context of contexts.reverse()) await context.close();
  // connectOverCDP.close disconnects this client; it does not stop the CDP host.
  await browser.close();
}
