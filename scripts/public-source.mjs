import { cp, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Allowlist for the downloadable source offer. Never copy the workspace
// wholesale: the local corpus, takes and environment files are private.
const paths = [
  '.editorconfig', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md',
  'CONTRIBUTING.md', 'THIRD_PARTY.md', 'package.json', 'package-lock.json',
  'index.html', 'tsconfig.json', 'vite.config.ts', 'svelte.config.js',
  'src', 'public', 'scripts', 'docs', '.github',
];
const permittedHidden = new Set([...paths.filter((name) => name.startsWith('.')), '.github/workflows', '.github/workflows/check.yml']);

// The built client and its source offer use the same score allowlist.
export async function publicScoreFiles(directory) {
  if (!(await lstat(directory)).isDirectory() || !(await lstat(path.join(directory, 'catalog.json'))).isFile()) throw new Error('Invalid public catalogue path');
  const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'));
  if (!Array.isArray(catalog)) throw new Error('Invalid public catalogue');
  const publicScores = new Set(['catalog.json']);
  const ids = new Set();
  for (const entry of catalog) {
    if (!entry || typeof entry.file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.(musicxml|mxl)$/.test(entry.file) || typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.id)
      || publicScores.has(entry.file) || ids.has(entry.id)) throw new Error('Invalid public catalogue entry');
    if (!(await lstat(path.join(directory, entry.file))).isFile()) throw new Error(`Invalid public score file: ${entry.file}`);
    publicScores.add(entry.file);
    ids.add(entry.id);
  }
  return publicScores;
}

export async function copyPublicAssets(directory, destination) {
  const publicScores = await publicScoreFiles(path.join(directory, 'scores'));
  await cp(directory, destination, {
    recursive: true,
    filter: async source => {
      const name = path.relative(directory, source).split(path.sep).join('/');
      if (name.startsWith('scores/') && !publicScores.has(name.slice('scores/'.length))) return false;
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Unexpected symlink in public assets: ${name}`);
      return true;
    },
  });
}

export async function copyPublicSource(root, destination) {
  const publicScores = await publicScoreFiles(path.join(root, 'public/scores'));
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
