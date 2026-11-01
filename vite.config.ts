import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';

export default defineConfig({
  base: process.env.CHANSONADE_BASE_PATH || '/',
  define: { 'import.meta.env.VITE_LOCAL_SCORES': JSON.stringify(String(existsSync('local-scores/vecchia-zimarra-senti.mxl'))) },
  plugins: [svelte(), {
    // The historical corpus remains available locally, outside public builds.
    name: 'private-local-scores',
    configureServer(server) {
      server.middlewares.use('/scores', (request, response, next) => {
        let filename: string;
        try { filename = decodeURIComponent((request.url || '').split('?')[0].slice(1)); }
        catch { next(); return; }
        if (filename !== path.basename(filename) || !filename.endsWith('.mxl')) { next(); return; }
        const file = path.resolve('local-scores', filename);
        if (!existsSync(file)) { next(); return; }
        response.setHeader('Content-Type', 'application/vnd.recordare.musicxml');
        createReadStream(file).pipe(response);
      });
    },
  }],
  server: { port: 5178, strictPort: true, host: '0.0.0.0' },
  // Pitch analysis first starts on a microphone click. Pre-bundle its worker
  // dependency at startup so Vite never reloads in the middle of that take.
  optimizeDeps: { exclude: ['verovio'], include: ['pitchy'] },
});
