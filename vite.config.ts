import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { copyPublicAssets } from './scripts/public-source.mjs';
import type { LocalScore } from 'virtual:local-scores';

export default defineConfig({
  base: process.env.CHANSONADE_BASE_PATH || '/',
  build: { copyPublicDir: false },
  plugins: [svelte(), {
    name: 'public-catalogue-assets',
    apply: 'build',
    async writeBundle(options) {
      if (!options.dir) throw new Error('A build output directory is required.');
      await copyPublicAssets(this.environment.config.publicDir, options.dir);
    },
  }, localScores()],
  server: { port: 5178, strictPort: true, host: '0.0.0.0' },
  // Pitch analysis first starts on a microphone click. Pre-bundle its worker
  // dependency at startup so Vite never reloads in the middle of that take.
  optimizeDeps: { exclude: ['verovio'], include: ['pitchy'] },
});

// Only configureServer reads the optional private manifest. Builds and preview
// receive an empty module, even when local-scores exists beside the public code.
function localScores(): Plugin {
  const moduleId = '\0virtual:local-scores';
  let scores: LocalScore[] = [];
  return {
    name: 'private-local-scores',
    resolveId(id) { if (id === 'virtual:local-scores') return moduleId; },
    load(id) { if (id === moduleId) return `export default ${JSON.stringify(scores)};`; },
    async configureServer(server) {
      const directory = path.resolve(server.config.root, 'local-scores');
      let manifest: unknown = [];
      try { manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!Array.isArray(manifest) || manifest.some(score =>
        !score || ['file', 'title', 'subtitle', 'composer', 'period'].some(key => typeof score[key] !== 'string')
        || score.file !== path.basename(score.file) || score.file.includes('\\') || !/\.(musicxml|mxl|xml)$/i.test(score.file)
      ) || new Set(manifest.map(score => score.file)).size !== manifest.length) throw new Error('Invalid local-scores/manifest.json');
      scores = manifest;
      server.middlewares.use(`${server.config.base}scores`, (request, response, next) => {
        let filename: string;
        try { filename = decodeURIComponent((request.url || '').split('?')[0].slice(1)); }
        catch { next(); return; }
        if (!scores.some(score => score.file === filename)) { next(); return; }
        response.setHeader('Content-Type', filename.toLowerCase().endsWith('.mxl') ? 'application/vnd.recordare.musicxml' : 'application/vnd.recordare.musicxml+xml');
        createReadStream(path.join(directory, filename)).on('error', next).pipe(response);
      });
    },
  };
}
