import { spawn } from 'node:child_process';
import { createServer as createPortProbe } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

async function availablePort() {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const root = fileURLToPath(new URL('../', import.meta.url));
let server, browser;
try {
  let url = process.env.CHANSONADE_TEST_URL;
  if (!url) {
    server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: await availablePort(), strictPort: true, open: false } });
    await server.listen();
    url = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  let cdp = process.env.CHANSONADE_TEST_CDP;
  if (!cdp) {
    const port = await availablePort();
    browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`, '--autoplay-policy=no-user-gesture-required'] });
    cdp = `http://127.0.0.1:${port}`;
  }
  const checks = [
    'check-score-import.mjs',
    'check-recording-limits.mjs',
    'check-loop-ranges.mjs',
    'check-loop-geometry.mjs',
    'check-audio-transport.mjs',
    'check-take-playback.mjs',
    'check-distribution.mjs',
  ];
  if (process.argv.includes('--browser')) checks.push('check-browser.mjs');
  for (const check of checks) {
    console.log(`\n${check}`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(check, import.meta.url))], {
        cwd: root, stdio: 'inherit', env: { ...process.env, CHANSONADE_TEST_URL: url, CHANSONADE_TEST_CDP: cdp },
      });
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${check} exceeded 120 seconds`)); }, 120_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve(); else reject(new Error(`${check} failed (${signal || code})`));
      });
    });
  }
} finally {
  await browser?.close();
  await server?.close();
}
