// Run through check-client.mjs, or supply an isolated Vite URL and Chromium CDP.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const context = await browser.newContext();
try {
  const page = await context.newPage();
  await page.goto(process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194');
  const result = await page.evaluate(async () => {
    const { readMusicXML, metadata, Score } = await import('/src/lib/score.ts');
    const { checkScoreXML, MAX_SCORE_XML_BYTES, MAX_SCORE_ARCHIVE_BYTES } = await import('/src/lib/score-import.ts');
    const { zipSync, strToU8, Zip, ZipDeflate } = await import('/node_modules/fflate/esm/browser.js');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const rejects = (action, text) => {
      try { action(); } catch (error) { check(error.message.includes(text), `Wrong error: ${error.message}`); return; }
      throw new Error(`Expected rejection: ${text}`);
    };
    const xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Synthetic é</work-title></work><part-list/></score-partwise>';
    const container = '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>';
    const archive = (extra = {}) => zipSync({ 'META-INF/container.xml': strToU8(container), 'score.musicxml': strToU8(xml), ...extra });
    const read = bytes => readMusicXML(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const parse = bytes => metadata(read(bytes), 'test.musicxml');
    check(read(strToU8(xml)) === xml, 'Plain XML must preserve exact UTF-8 text');
    check(read(strToU8('\ufeff' + xml)) === '\ufeff' + xml, 'UTF-8 BOM must remain part of the XML identity');
    check(parse(strToU8('\ufeff' + xml)).title === 'Synthetic é', 'XML metadata must accept a UTF-8 BOM');
    check(read(archive()) === xml, 'MXL must preserve exact root XML');
    check(read(zipSync({ 'score.musicxml': strToU8(xml) })) === xml, 'MXL without container fallback');
    const streamChunks = [];
    const streamingZip = new Zip((error, chunk) => { if (error) throw error; streamChunks.push(chunk); });
    const streamingRoot = new ZipDeflate('score.musicxml');
    streamingZip.add(streamingRoot); streamingRoot.push(strToU8(xml), true); streamingZip.end();
    const streamed = new Uint8Array(streamChunks.reduce((size, chunk) => size + chunk.length, 0));
    let streamOffset = 0;
    for (const chunk of streamChunks) { streamed.set(chunk, streamOffset); streamOffset += chunk.length; }
    check(read(streamed) === xml, 'MXL data descriptors must remain supported');
    rejects(() => parse(strToU8('<score-partwise>')), 'XML est invalide');
    rejects(() => parse(strToU8('<html/>')), 'partition MusicXML');
    rejects(() => read(new Uint8Array([0xff])), 'XML est invalide');
    rejects(() => read(new Uint8Array([80, 75, 3, 4])), 'archive MXL');
    rejects(() => read(new Uint8Array(MAX_SCORE_XML_BYTES + 1)), '5 Mio');
    rejects(() => checkScoreXML('é'.repeat(MAX_SCORE_XML_BYTES / 2 + 1)), '5 Mio');
    checkScoreXML('a'.repeat(MAX_SCORE_XML_BYTES));
    const largeZip = new Uint8Array(MAX_SCORE_ARCHIVE_BYTES + 1); largeZip.set([80, 75]);
    rejects(() => read(largeZip), '10 Mio');
    rejects(() => read(archive({ '../outside.xml': strToU8(xml) })), 'archive MXL');
    rejects(() => read(archive(Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`extra-${i}`, new Uint8Array()])))), 'archive MXL');
    rejects(() => read(zipSync({ 'META-INF/container.xml': strToU8('<container>'), 'score.musicxml': strToU8(xml) })), 'archive MXL');
    rejects(() => read(zipSync({ 'META-INF/container.xml': strToU8('<container><rootfile full-path="missing.xml"/></container>'), 'score.musicxml': strToU8(xml) })), 'partition MusicXML');
    rejects(() => read(strToU8('<!DOCTYPE score-partwise [<!ENTITY a "expanded">]><score-partwise/>')), 'XML est invalide');

    // Tamper both central and local headers, including falsely SMALL lengths.
    const setOriginalSize = (bytes, name, size, local = true) => {
      const copy = bytes.slice(), view = new DataView(copy.buffer);
      for (let i = 0; i + 46 < copy.length; i++) {
        if (view.getUint32(i, true) !== 0x02014b50) continue;
        const length = view.getUint16(i + 28, true);
        if (new TextDecoder().decode(copy.subarray(i + 46, i + 46 + length)) !== name) continue;
        view.setUint32(i + 24, size, true);
        if (local) view.setUint32(view.getUint32(i + 42, true) + 22, size, true);
        return copy;
      }
      throw new Error('Missing test entry');
    };
    rejects(() => read(setOriginalSize(archive(), 'score.musicxml', MAX_SCORE_XML_BYTES + 1)), 'archive MXL');
    rejects(() => read(setOriginalSize(archive(), 'score.musicxml', 33 * 1024 * 1024)), 'archive MXL');
    rejects(() => read(setOriginalSize(archive(), 'score.musicxml', 1, false)), 'archive MXL');
    const bomb = zipSync({ 'score.musicxml': strToU8(xml + ' '.repeat(MAX_SCORE_XML_BYTES + 1)) });
    rejects(() => read(bomb), 'archive MXL');
    rejects(() => read(setOriginalSize(bomb, 'score.musicxml', 16)), 'archive MXL');
    const ignoredBomb = setOriginalSize(archive({ 'unused.bin': new Uint8Array(8 * 1024 * 1024) }), 'unused.bin', 1);
    check(read(ignoredBomb) === xml, 'Auxiliary files must not be inflated');

    const catalog = await (await fetch('/scores/catalog.json')).json();
    for (const entry of catalog) {
      const bytes = await (await fetch(`/scores/${entry.file}`)).arrayBuffer();
      const decoded = readMusicXML(bytes);
      metadata(decoded, entry.file);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(decoded));
      check([...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') === entry.id, `Changed catalogue XML: ${entry.file}`);
    }

    // Real Score class, synthetic Worker and clock: no 30-second test sleeps.
    const NativeWorker = window.Worker, nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
    const workers = [], timers = new Map(); let nextTimer = 1_000_000;
    class TestWorker {
      onmessage; onerror; onmessageerror; request; terminated = false;
      constructor() { workers.push(this); }
      postMessage(request) { this.request = request; }
      terminate() { this.terminated = true; }
      answer(payload = {}) { this.onmessage?.({ data: { id: this.request.id, pages: ['synthetic'], ...payload } }); }
    }
    window.Worker = TestWorker;
    window.setTimeout = (handler, delay, ...args) => {
      if (delay !== 30_000) return nativeSetTimeout(handler, delay, ...args);
      const id = ++nextTimer; timers.set(id, handler); return id;
    };
    window.clearTimeout = id => { if (timers.has(id)) timers.delete(id); else nativeClearTimeout(id); };
    const engine = new Score();
    const load = () => engine.load(xml, 'vertical', 800, 1);
    const rejectEmptyLayout = async () => {
      const count = workers.length;
      const result = await engine.layout('vertical', 800, 1).catch(error => error.message);
      check(typeof result === 'string' && result.includes('Rouvrez'), 'Layout must reject until a score is successfully loaded');
      check(workers.length === count, 'Layout must not create an empty worker');
    };
    try {
      await rejectEmptyLayout();
      const hung = load().catch(error => error.message);
      [...timers.values()][0]();
      check((await hung).includes('trop de temps'), 'Hung worker must reject');
      check(workers[0].terminated, 'Hung worker must terminate');
      await rejectEmptyLayout();
      const recovered = load(); workers.at(-1).answer(); await recovered;
      const layout = engine.layout('horizontal', 700, 1).catch(error => error.message);
      [...timers.values()][0]();
      check((await layout).includes('trop de temps'), 'Hung layout must reject');
      await rejectEmptyLayout();
      const older = load().catch(error => error.message), oldWorker = workers.at(-1), oldTimer = [...timers.values()][0];
      const newer = load();
      check((await older).includes('partition a changé'), 'New load must cancel old load');
      oldTimer(); oldWorker.answer(); oldWorker.onerror?.({ message: 'late error' });
      check(!workers.at(-1).terminated, 'Stale callbacks must not reset newer worker');
      workers.at(-1).answer(); await newer;
      const failed = load().catch(error => error.message); workers.at(-1).onerror({ message: 'synthetic crash' });
      check((await failed).includes('ne répond pas'), 'Worker error must reject');
      await rejectEmptyLayout();
      const afterError = load(); workers.at(-1).answer(); await afterError;
      const layoutAfterError = engine.layout('horizontal', 900, 1); workers.at(-1).answer();
      check((await layoutAfterError).pages[0] === 'synthetic', 'A successful new load must restore layout');
      const invalid = load().catch(error => error.message); workers.at(-1).answer({ error: 'Synthetic invalid score' });
      check(await invalid === 'Synthetic invalid score', 'Worker-reported failure must reject');
      const afterInvalid = load(); workers.at(-1).answer(); await afterInvalid;
      engine.destroy();
      check((await load().catch(error => error.message)).includes('Lecteur fermé'), 'Destroyed engine must stay closed');
      check(timers.size === 0, 'All request timers must be cleared');
    } finally {
      engine.destroy(); window.Worker = NativeWorker; window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout;
    }
    return { catalog: catalog.length, malformedAndSizeLimits: true, realInflatedSize: true, workerRecoveryAndRaces: true };
  });
  assert(result.catalog > 0);
  console.log('PASS score import:', JSON.stringify(result));
} finally {
  await context.close();
  await browser.close();
}
