// Production distribution and offline checks, using only temporary fixtures.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { copyPublicSource, publicScoreFiles } from './public-source.mjs';

// check-client's development server sets NODE_ENV before spawning its checks.
// Exercise the same production compilation as `vite build`.
process.env.NODE_ENV = 'production';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'chansonade-distribution-'));
const fixture = path.join(temporary, 'app');
let browser, context, server;
async function closePreview() {
  await context?.close(); context = null;
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  server = null;
}
try {
  if (!process.env.CHANSONADE_TEST_CDP) throw new Error('Run this check through check-client.mjs.');
  browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP);
  await copyPublicSource(root, fixture);
  await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const scores = path.join(fixture, 'public/scores');
  await rm(scores, { recursive: true }); await mkdir(scores);
  const title = 'Distribution synthétique';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Fixture</part-name><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const entry = { id: createHash('sha256').update(xml).digest('hex'), file: 'synthetic.musicxml', title, composer: 'Synthetic', subtitle: 'Fixture', period: '', group: 'children-fr', language: 'fr', level: 'Premiers pas', sourceUrl: 'https://example.invalid/source', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', credits: 'Synthetic fixture' };
  const manifest = JSON.stringify([entry]);
  await writeFile(path.join(scores, 'catalog.json'), manifest);
  await writeFile(path.join(scores, entry.file), xml);
  const marker = randomUUID();
  await writeFile(path.join(scores, 'unlisted.musicxml'), marker);
  await mkdir(path.join(scores, 'nested'));
  await writeFile(path.join(scores, 'nested/export.zip'), marker);
  await writeFile(path.join(temporary, 'outside.musicxml'), marker);
  await symlink(path.join(temporary, 'outside.musicxml'), path.join(scores, 'unlisted-link.musicxml'));
  const allowed = ['catalog.json', entry.file].sort();
  const snapshot = path.join(temporary, 'source-snapshot');
  await copyPublicSource(fixture, snapshot);
  assert.deepEqual((await readdir(path.join(snapshot, 'public/scores'))).sort(), allowed, 'Source offer only contains manifest-listed scores');

  for (const base of ['/', '/test/chansonade/']) {
    await build({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), base, cacheDir: path.join(temporary, 'vite-cache'), logLevel: 'error', build: { outDir: 'dist', emptyOutDir: true } });
    const dist = path.join(fixture, 'dist');
    assert.deepEqual((await readdir(path.join(dist, 'scores'))).sort(), allowed, 'Vite must not copy unlisted scores, folders or symlinks');
    assert.equal(await readFile(path.join(dist, 'scores', entry.file), 'utf8'), xml);
    for (const name of ['audio/TimGM6mb.sf2', 'audio/capture-worklet.js', 'fonts/fonts.css', 'logo.png', 'manifest.webmanifest']) {
      assert.deepEqual(await readFile(path.join(dist, name)), await readFile(path.join(fixture, 'public', name)), `Public asset changed: ${name}`);
    }
    const offline = () => run(process.execPath, [path.join(fixture, 'scripts/build-offline.mjs')], { cwd: fixture });
    await mkdir(path.join(dist, 'source')); await writeFile(path.join(dist, 'source/fixture.zip'), marker);
    await offline();
    let apiSequence = 0, workerAPIRequests = 0;
    server = await preview({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), base, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, plugins: [{
      name: 'synthetic-api',
      configurePreviewServer(previewServer) {
        previewServer.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith(`${base}api/`)) { next(); return; }
          response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ user: null, registration: 'invite', sequence: ++apiSequence }));
        });
      },
    }] });
    const url = `http://127.0.0.1:${server.httpServer.address().port}${base}`;
    context = await browser.newContext({ locale: 'fr-BE' });
    context.on('request', request => { if (new URL(request.url()).pathname.startsWith(`${base}api/`) && request.serviceWorker()) workerAPIRequests++; });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const ready = () => page.waitForFunction(title => document.querySelector('h1')?.textContent === title && document.querySelector('.transport .play-button')?.disabled === false, title);
    await ready();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
    });
    assert.deepEqual(cached.filter(name => name.startsWith(`${base}scores/`)).sort(), allowed.map(name => `${base}scores/${name}`).sort());
    assert(!cached.some(name => name.startsWith(`${base}api/`) || name.startsWith(`${base}source/`)));
    const sequences = await page.evaluate(async base => {
      const first = await (await fetch(`${base}api/v1/probe`, { cache: 'no-store' })).json();
      const second = await (await fetch(`${base}api/v1/probe`, { cache: 'no-store' })).json();
      return [first.sequence, second.sequence];
    }, base);
    assert(sequences[1] > sequences[0], 'Controlled page API calls must still reach the network');
    assert.equal(workerAPIRequests, 0, 'API fetches must not be intercepted by the service worker');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    const offlineResult = await page.evaluate(async base => ({
      xml: await (await fetch(`${base}scores/synthetic.musicxml`)).text(),
      apiFailed: await fetch(`${base}api/v1/probe`, { cache: 'no-store' }).then(() => false, () => true),
      sourceFailed: await fetch(`${base}source/fixture.zip`, { cache: 'no-store' }).then(() => false, () => true),
    }), base);
    assert.equal(offlineResult.xml, xml); assert.equal(offlineResult.apiFailed, true); assert.equal(offlineResult.sourceFailed, true);
    assert.deepEqual(errors, []);
    console.log(`PASS distribution ${base}: allowlist, source offer, precache, offline score/engines and API bypass`);
    await closePreview();
  }
  // Invalid identities, traversal, missing files and listed symlinks fail closed.
  for (const invalid of [{}, [entry, entry], [{ ...entry, file: '../outside.musicxml' }], [{ ...entry, file: 'missing.musicxml' }]]) {
    await writeFile(path.join(scores, 'catalog.json'), JSON.stringify(invalid));
    await assert.rejects(publicScoreFiles(scores));
  }
  await writeFile(path.join(scores, 'catalog.json'), manifest);
  await rm(path.join(scores, entry.file)); await symlink(path.join(temporary, 'outside.musicxml'), path.join(scores, entry.file));
  await assert.rejects(build({ root: fixture, configFile: path.join(fixture, 'vite.config.ts'), logLevel: 'silent' }), /Invalid public score file/);
  console.log('PASS distribution: malformed/duplicate/traversal/missing catalogue entries and listed symlinks rejected');
} finally {
  await closePreview();
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
