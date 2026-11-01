import { cp, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Shared by the downloadable source offer and a clean public repository export.
// Never copy the workspace wholesale: its history and local corpus are private.
const paths = [
  '.editorconfig', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md',
  'CONTRIBUTING.md', 'THIRD_PARTY.md', 'package.json', 'package-lock.json',
  'index.html', 'tsconfig.json', 'vite.config.ts', 'svelte.config.js',
  'src', 'public', 'scripts', 'docs',
];
const permittedHidden = new Set(paths.filter((name) => name.startsWith('.')));

export async function copyPublicSource(root, destination) {
  await mkdir(destination, { recursive: true });
  for (const relative of paths) {
    await cp(path.join(root, relative), path.join(destination, relative), {
      recursive: true,
      filter: async (source) => {
        const name = path.relative(root, source).split(path.sep).join('/');
        if (name.split('/').some((part) => part.startsWith('.')) && !permittedHidden.has(name)) return false;
        if (name.startsWith('public/scores/') && name !== 'public/scores/une-souris-verte-chant-piano.musicxml') return false;
        if ((await lstat(source)).isSymbolicLink()) throw new Error(`Unexpected symlink in public source: ${name}`);
        return true;
      },
    });
  }
}
