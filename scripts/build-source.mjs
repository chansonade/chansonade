import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPublicSource } from './public-source.mjs';

// Publish the actual source snapshot alongside each build, without Git history,
// recordings, local scores, credentials, or the separate private server.
const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const cache = path.join(root, 'node_modules/.cache/chansonade-source');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const upstream = JSON.parse(await readFile(new URL('./third-party-sources.json', import.meta.url), 'utf8'));
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const fileName = (name) => name.replace(/^@/, '').replaceAll('/', '-');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'chansonade-source-'));
const snapshot = path.join(temporary, 'chansonade');
await mkdir(snapshot);
await mkdir(cache, { recursive: true });
await mkdir(path.join(dist, 'source'), { recursive: true });
await mkdir(path.join(dist, 'legal'), { recursive: true });
await mkdir(path.join(snapshot, 'third-party/npm'), { recursive: true });
await mkdir(path.join(snapshot, 'third-party/upstream'), { recursive: true });

async function download(url, filename, valid) {
  const target = path.join(cache, filename);
  for (const candidate of [target, path.join(root, 'third-party/npm', filename), path.join(root, 'third-party/upstream', filename)]) {
    try {
      const bytes = await readFile(candidate);
      if (valid(bytes)) return bytes;
    } catch { /* An empty cache is normal on the first build. */ }
  }
  if (!url.startsWith('https://')) throw new Error(`Source URL must use HTTPS: ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error(`Source integrity mismatch: ${url}`);
  await writeFile(target, bytes);
  return bytes;
}

function matchesIntegrity(bytes, integrity) {
  return integrity.split(/\s+/).some((entry) => {
    const [algorithm, expected] = entry.split('-', 2);
    if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) return false;
    return createHash(algorithm).update(bytes).digest('base64') === expected;
  });
}

async function archiveLicenses(archive, name, version) {
  const { stdout } = await run('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 });
  const members = stdout.trim().split('\n');
  // Preserve complete license/notice files, including licenses embedded by
  // upstream projects. The original archives retain all remaining headers.
  const licenses = members.filter((member) => /\/(?:licen[cs]e|copying|notice|copyright)(?:[._-][^/]*)?$/i.test(member));
  // Some bundled notices live in source headers or resource README files.
  // Keep these explicitly, rather than assuming every notice has LICENSE in its name.
  if (name === 'verovio preferred upstream source') {
    for (const suffix of ['/include/pugi/pugixml.hpp', '/fonts/README.md']) {
      const member = members.find((member) => member.endsWith(suffix));
      if (!member) throw new Error(`Missing Verovio bundled notice: ${suffix}`);
      licenses.push(member);
    }
  }
  const texts = [];
  for (const member of licenses) {
    const { stdout: text } = await run('tar', ['-xOzf', archive, member], { maxBuffer: 4 * 1024 * 1024 });
    texts.push(`--- ${member} ---\n${text}`);
  }
  // fft.js carries its full MIT notice in README rather than a LICENSE file.
  if (!licenses.length) {
    const readme = members.find((member) => /^[^/]+\/readme(?:\.md|\.txt)?$/i.test(member));
    if (readme) {
      const { stdout: text } = await run('tar', ['-xOzf', archive, readme], { maxBuffer: 4 * 1024 * 1024 });
      texts.push(`--- ${readme} ---\n${text}`);
    }
  }
  return `\n\n===== ${name} ${version} =====\n${texts.join('\n\n')}`;
}

async function parallel(items, job) {
  let index = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await job(items[current]);
    }
  }));
  return results;
}

try {
  await copyPublicSource(root, snapshot);

  const packages = Object.entries(lock.packages)
    .filter(([location, entry]) => location && !entry.dev)
    .map(([location, entry]) => ({ location, name: location.slice(location.lastIndexOf('node_modules/') + 13), ...entry }));
  const npmRecords = await parallel(packages, async (entry) => {
    if (!entry.resolved || !entry.integrity) throw new Error(`Missing pinned npm source: ${entry.name}`);
    const filename = `${fileName(entry.name)}-${entry.version}.tgz`;
    const bytes = await download(entry.resolved, filename, (bytes) => matchesIntegrity(bytes, entry.integrity));
    const target = path.join(snapshot, 'third-party/npm', filename);
    await writeFile(target, bytes);
    const manifest = JSON.parse(await readFile(path.join(root, entry.location, 'package.json'), 'utf8'));
    return { name: entry.name, version: entry.version, license: manifest.license || 'See original notices', repository: manifest.repository, url: entry.resolved, integrity: entry.integrity, sha256: digest(bytes), archive: `third-party/npm/${filename}`, notices: await archiveLicenses(target, entry.name, entry.version) };
  });

  const upstreamRecords = await parallel(upstream, async (entry) => {
    const installed = packages.find((pkg) => pkg.name === entry.name);
    if (installed?.version !== entry.version) throw new Error(`Update source pin for ${entry.name}: expected ${entry.version}, installed ${installed?.version}`);
    const bytes = await download(entry.url, entry.file, (bytes) => digest(bytes) === entry.sha256);
    const target = path.join(snapshot, 'third-party/upstream', entry.file);
    await writeFile(target, bytes);
    return { ...entry, archive: `third-party/upstream/${entry.file}`, notices: await archiveLicenses(target, `${entry.name} preferred upstream source`, entry.version) };
  });

  let revision = 'source-archive';
  try { revision = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(); } catch { /* A downloaded source archive has no .git directory. */ }
  const sourceFiles = [];
  async function inventory(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await inventory(path.join(directory, entry.name), relative);
      else sourceFiles.push({ file: relative, sha256: digest(await readFile(path.join(directory, entry.name))) });
    }
  }
  await inventory(snapshot);
  sourceFiles.sort((a, b) => a.file.localeCompare(b.file));
  const stripNotices = ({ notices, ...record }) => record;
  const metadata = {
    format: 1, project: 'Chansonade', license: 'GPL-3.0-only', revision,
    basePath: process.env.CHANSONADE_BASE_PATH || '/',
    repositoryUrl: process.env.VITE_REPOSITORY_URL || '',
    // The inventory describes the snapshot itself, including uncommitted
    // source changes; revision is context, not a claim of a clean Git tree.
    snapshotSha256: digest(JSON.stringify(sourceFiles)), files: sourceFiles,
    npm: npmRecords.map(stripNotices), upstream: upstreamRecords.map(stripNotices),
  };
  await writeFile(path.join(snapshot, 'SOURCE-MANIFEST.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const assetNotices = [];
  for (const folder of ['public/audio', 'public/fonts']) {
    for (const file of await readdir(path.join(root, folder))) {
      if (/\.LICENSE\.txt$/i.test(file)) assetNotices.push(`\n\n===== ${folder}/${file} =====\n${await readFile(path.join(root, folder, file), 'utf8')}`);
    }
  }
  const notices = `Chansonade — third-party notices\n\nThe client source is GPL-3.0-only. Each component and asset retains its own license.\nThe full versioned source offer is ../source/chansonade-source.tar.gz.\n\n${await readFile(path.join(root, 'THIRD_PARTY.md'), 'utf8')}\n\n===== librosa adaptation notice =====\n${(await readFile(path.join(root, 'src/lib/pitch-detector.ts'), 'utf8')).split('*/', 1)[0]}*/\n${npmRecords.map((record) => record.notices).join('')}${upstreamRecords.map((record) => record.notices).join('')}${assetNotices.join('')}`;
  await writeFile(path.join(dist, 'legal/NOTICES.txt'), notices);
  await cp(path.join(root, 'LICENSE'), path.join(dist, 'legal/LICENSE.txt'));
  await writeFile(path.join(dist, 'legal/THIRD_PARTY.md'), (await readFile(path.join(root, 'THIRD_PARTY.md'), 'utf8')).replace('(docs/SOURCES.md)', '(SOURCES.md)').replace('(docs/PUBLIC_CATALOG.md)', '(PUBLIC_CATALOG.md)'));
  await cp(path.join(root, 'docs/PUBLIC_CATALOG.md'), path.join(dist, 'legal/PUBLIC_CATALOG.md'));
  await cp(path.join(root, 'docs/SOURCES.md'), path.join(dist, 'legal/SOURCES.md'));
  await writeFile(path.join(dist, 'legal/PUBLISHING.md'), (await readFile(path.join(root, 'docs/PUBLISHING.md'), 'utf8')).replaceAll('(../THIRD_PARTY.md)', '(THIRD_PARTY.md)'));
  await writeFile(path.join(snapshot, 'THIRD-PARTY-NOTICES.txt'), notices);
  const archive = path.join(dist, 'source/chansonade-source.tar.gz');
  await run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', temporary, 'chansonade'], { maxBuffer: 1024 * 1024 });
  const bytes = await readFile(archive);
  await writeFile(path.join(dist, 'source/manifest.json'), `${JSON.stringify({ ...metadata, files: undefined, archive: 'chansonade-source.tar.gz', archiveSha256: digest(bytes), archiveBytes: bytes.length }, null, 2)}\n`);
  console.log(`Sources publiées : ${(bytes.length / 1024 / 1024).toFixed(1)} MiB, ${npmRecords.length} paquets npm et ${upstreamRecords.length} archives amont, empreinte ${metadata.snapshotSha256.slice(0, 16)}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
