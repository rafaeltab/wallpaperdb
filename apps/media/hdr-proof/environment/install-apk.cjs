// Build-only installer for the complete, hash-pinned native dependency closure.
// No repository index is consulted during installation.
const { createHash } = require('node:crypto');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { basename, join } = require('node:path');
const { execFileSync } = require('node:child_process');

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function validate(lock) {
  if (lock.schema_version !== 1 || lock.platform !== 'linux/amd64') {
    throw new Error('Unsupported APK lock schema or platform');
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('This native proof is locked to linux/amd64');
  }
  const names = new Set();
  for (const item of lock.packages) {
    const filename = `${item.name}-${item.version}.apk`;
    if (!/^[A-Za-z0-9+_.-]+$/.test(item.name) ||
        !/^[A-Za-z0-9+_.-]+$/.test(item.version) ||
        !['pinned_base_image', 'apk_archive'].includes(item.source) ||
        names.has(item.name)) {
      throw new Error(`Invalid or duplicate APK lock entry: ${item.name}`);
    }
    if (item.source === 'apk_archive' && (
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isInteger(item.bytes) || item.bytes <= 0 ||
        basename(new URL(item.url).pathname) !== filename ||
        !item.url.startsWith('https://dl-cdn.alpinelinux.org/alpine/v3.24/'))) {
      throw new Error(`Invalid APK archive pin: ${item.name}`);
    }
    names.add(item.name);
  }
  if (names.size === 0) throw new Error('APK dependency closure is empty');
}

async function verify(item, path) {
  const bytes = await readFile(path);
  if (bytes.length !== item.bytes || await digest(path) !== item.sha256) {
    throw new Error(`APK checksum mismatch: ${item.name}=${item.version}`);
  }
}

async function fetchLocked(item, directory, verifyOnly) {
  const path = join(directory, `${item.name}-${item.version}.apk`);
  try {
    await verify(item, path);
    return path;
  } catch (error) {
    // A corrupted cached archive must fail, never silently replace evidence.
    if (error.code !== 'ENOENT' || verifyOnly) throw error;
  }
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`Locked APK unavailable (${response.status}): ${item.url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length !== item.bytes ||
      createHash('sha256').update(archive).digest('hex') !== item.sha256) {
    throw new Error(`Downloaded APK checksum mismatch: ${item.name}=${item.version}`);
  }
  await writeFile(path, archive);
  return path;
}

async function verifyInstalled(lock) {
  const database = await readFile('/lib/apk/db/installed', 'utf8');
  const installed = database.trim().split(/\n\n/).map((section) => {
    const fields = Object.fromEntries(section.split('\n')
      .filter((line) => /^[PVAC]:/.test(line)).map((line) => [line[0], line.slice(2)]));
    return { name: fields.P, version: fields.V, architecture: fields.A,
      apk_control_checksum: fields.C };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const expected = lock.packages.map(({ name, version, architecture, apk_control_checksum }) =>
    ({ name, version, architecture, apk_control_checksum }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (JSON.stringify(installed) !== JSON.stringify(expected)) {
    throw new Error('Installed native dependency inventory differs from the lock');
  }
}

async function main() {
  const [manifest, directory, mode = '--install'] = process.argv.slice(2);
  if (!manifest || !directory || !['--install', '--verify-only'].includes(mode)) {
    throw new Error('Usage: node install-apk.cjs apk-lock.json cache-directory [--verify-only]');
  }
  const lock = JSON.parse(await readFile(manifest, 'utf8'));
  validate(lock);
  await mkdir(directory, { recursive: true });
  const archives = [];
  // Bound network/memory use while downloading large LLVM and Mesa packages.
  const additions = lock.packages.filter((item) => item.source === 'apk_archive');
  for (let offset = 0; offset < additions.length; offset += 6) {
    archives.push(...await Promise.all(additions.slice(offset, offset + 6)
      .map((item) => fetchLocked(item, directory, mode === '--verify-only'))));
  }
  if (mode === '--install') {
    execFileSync('apk', ['add', '--no-network', '--no-cache', '--repositories-file',
      '/dev/null', ...archives], { stdio: 'inherit' });
    await verifyInstalled(lock);
  }
  console.log(`Verified ${archives.length} exact APK archives (${mode})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
