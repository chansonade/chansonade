// Run through check-client.mjs, or supply an isolated Vite URL and Chromium CDP.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(process.env.CHANSONADE_TEST_CDP || 'http://127.0.0.1:9228');
const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const url = `${process.env.CHANSONADE_TEST_URL || 'http://127.0.0.1:5194'}/check-loop-geometry`;
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Loop geometry regression</title><link rel="stylesheet" href="/src/style.css">' }));
  await page.goto(url);
  const checks = await page.evaluate(async () => {
    const { Score, indexGeometry } = await import('/src/lib/score.ts');
    const { measuresInLoop } = await import('/src/lib/loop.ts');
    const { projectPitchTrace } = await import('/src/lib/projection.ts');
    const engine = new Score();
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:max-content;padding:24px';
    document.body.append(host);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const ids = (measures) => measures.map((measure) => measure.id).join(',');
    try {
      // Enough quarter notes to create natural line breaks at both vertical widths.
      const xml = `<score-partwise version="4.0">
        <part-list><score-part id="P1">
          <part-name>Synthetic</part-name>
          <midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
        </score-part></part-list>
        <part id="P1">${Array.from({ length: 17 }, (_, i) => `
          <measure number="${i + 1}">
            ${i ? '' : `<attributes>
              <divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes><direction><sound tempo="78"/></direction>`}
            ${['G', 'A', 'B', 'C'].map(step => `
              <note><pitch><step>${step}</step><octave>4</octave></pitch>
                <duration>1</duration><type>quarter</type></note>`).join('')}
          </measure>`).join('')}
        </part>
      </score-partwise>`;
      let music;
      const results = [];
      for (const [mode, width, scale] of [['vertical', 350, 1], ['vertical', 900, 1], ['horizontal', 740, .6]]) {
        const result = music ? await engine.layout(mode, width, 1) : await engine.load(xml, mode, width, 1);
        music ||= result.musical;
        host.innerHTML = result.pages.map((svg) => `<div class="sheet-page">${svg}</div>`).join('');
        for (const svg of host.querySelectorAll('.sheet-page>svg')) {
          svg.style.width = `${svg.viewBox.baseVal.width * scale}px`;
          svg.style.height = `${svg.viewBox.baseVal.height * scale}px`;
        }
        const geometry = indexGeometry(host, music);
        const measures = geometry.measures;
        check(measures.length === 17, `${mode}/${width}: missing bars`);
        let pitchChecks = 0;
        for (let index = 0; index < measures.length; index++) {
          const measure = measures[index];
          const first = [...geometry.notes.values()].find((note) => note.measure === measure.id && note.channel === 0 && Math.abs(note.time - measure.time) < 1e-7);
          check(first, `${mode}/${width}: note/bar onset disagree in bar ${index + 1}`);
          const end = measures[index + 1]?.time ?? music.duration;
          const selected = measuresInLoop(measures, first.time, end, music.duration);
          check(ids(selected) === measure.id, `${mode}/${width}: single bar ${index + 1} selected ${ids(selected)}`);
          check(selected[0].width > 0 && selected[0].height > 0, 'empty highlight geometry');
          const path = projectPitchTrace([{ captureTime: first.time, scoreTime: first.time, frequency: 440 * 2 ** ((first.pitch - 69) / 12), targetChannel: first.channel, staff: first.staff, transpose: 0, playing: true, epoch: 0 }], geometry);
          const point = path.match(/M(-?[\d.]+),(-?[\d.]+)/);
          check(point && Math.abs(Number(point[1]) - first.x) < .2 && Math.abs(Number(point[2]) - first.y) < .2, `${mode}/${width}: pitch projection displaced at bar ${index + 1}`);
          pitchChecks++;
        }
        const breakIndex = measures.findIndex((measure, index) => index > 0 && measure.systemId !== measures[index - 1].systemId);
        if (mode === 'vertical') {
          check(breakIndex > 0, 'vertical layout should contain a line break');
          const pair = measures.slice(breakIndex - 1, breakIndex + 1);
          check(ids(measuresInLoop(measures, pair[0].time, measures[breakIndex + 1]?.time ?? music.duration, music.duration)) === ids(pair), 'loop across a line selected a neighbouring bar');
        } else check(breakIndex === -1, 'ribbon unexpectedly broke into systems');
        results.push({ mode, width, bars: measures.length, systems: new Set(measures.map((measure) => measure.systemId)).size, pitchChecks });
      }
      return results;
    } finally { host.remove(); engine.destroy(); }
  });
  assert.deepEqual(errors, []);
  console.log(`Loop geometry: ${JSON.stringify(checks)}`);
} finally {
  await context.close();
  await browser.close();
}
