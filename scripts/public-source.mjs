import { cp, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Shared by the downloadable source offer and a clean public repository export.
// Never copy the workspace wholesale: its history and local corpus are private.
const paths = [
  '.editorconfig', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md',
  'CONTRIBUTING.md', 'THIRD_PARTY.md', 'package.json', 'package-lock.json',
  'index.html', 'tsconfig.json', 'vite.config.ts', 'svelte.config.js',
  'src', 'public', 'scripts', 'docs', '.github',
];
const permittedHidden = new Set([...paths.filter((name) => name.startsWith('.')), '.github/workflows', '.github/workflows/check.yml']);

export async function copyPublicSource(root, destination) {
  const catalog = JSON.parse(await readFile(path.join(root, 'public/scores/catalog.json'), 'utf8'));
  const publicScores = new Set(['catalog.json']);
  for (const entry of catalog) {
    if (typeof entry.file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.(musicxml|mxl)$/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.id)) throw new Error('Invalid public catalogue entry');
    publicScores.add(entry.file);
  }
  await mkdir(destination, { recursive: true });
  for (const relative of paths) {
    await cp(path.join(root, relative), path.join(destination, relative), {
      recursive: true,
      filter: async (source) => {
        const name = path.relative(root, source).split(path.sep).join('/');
        if (name.split('/').some((part) => part.startsWith('.')) && !permittedHidden.has(name)) return false;
        if (name.startsWith('public/scores/') && !publicScores.has(name.slice('public/scores/'.length))) return false;
        if ((await lstat(source)).isSymbolicLink()) throw new Error(`Unexpected symlink in public source: ${name}`);
        return true;
      },
    });
  }
}
