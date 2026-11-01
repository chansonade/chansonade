import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPublicSource } from './public-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 3) throw new Error('Usage: node scripts/export-public.mjs /path/to/new-public-directory');
const destination = path.resolve(process.argv[2]);
if (destination === path.resolve(root) || ['src', 'public', 'scripts', 'docs'].some((folder) => destination.startsWith(path.join(root, folder) + path.sep) || destination === path.join(root, folder))) throw new Error('Destination must be outside the source folders.');
try {
  await access(destination);
  throw new Error(`Destination already exists: ${destination}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination, { recursive: true });
await copyPublicSource(root, destination);
console.log(`Public source exported to ${destination}. No Git history, local corpus or private server copied.`);
