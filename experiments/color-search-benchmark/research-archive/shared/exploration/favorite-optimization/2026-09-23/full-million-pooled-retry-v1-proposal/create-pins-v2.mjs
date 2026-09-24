import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const workspace = '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7';
const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(workspace, 'experiments/color-search-benchmark');
const { favoriteSourceSnapshot } = await import(pathToFileURL(path.join(sourceRoot, 'exploration/favorite-scale.mjs')));
const configuration = JSON.parse(await readFile(path.join(directory, 'favorite-full-million-four-methods-pooled.json')));
const roots = ['favorite-optimization-benchmark.mjs', 'favorite-optimization-arrival.mjs', 'favorite-optimization-audit.mjs', 'favorite-optimization-arrival-audit.mjs',
  ...configuration.candidates.flatMap(row => [row.builder.module, row.executor.module]).map(file => file.replace(/^\.\//, ''))];
const files = new Set();
for (const name of new Set(roots)) for (const file of Object.keys(await favoriteSourceSnapshot(pathToFileURL(path.join(sourceRoot, 'exploration', name))))) files.add(path.join(sourceRoot, file));
for (const file of ['Makefile', 'experiments/color-search-benchmark/exploration/favorite-optimization-pipeline.py',
  'experiments/color-search-benchmark/exploration/configs/favorite-pooled-feedback.json',
  'experiments/color-search-benchmark/exploration/configs/favorite-pooled-full-1m.json']) files.add(path.join(workspace, file));
for (const name of ['retry-plan.json', 'favorite-full-million-four-methods-pooled.json', 'create-pins-v2.mjs']) files.add(path.join(directory, name));
const pins = [];
for (const file of [...files].sort()) {
  const bytes = await readFile(file); pins.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = { schemaVersion: 1, experiment: 'favorite-pooled-retry-source-pins', createdAt: new Date().toISOString(), fileOnly: true,
  workspace, roots: [...new Set(roots)], pinCount: pins.length, pins,
  tests: { logs: ['/tmp/favorite-pooled-integration-tests.log', '/tmp/favorite-arrival-retention-tests.log'], adapter: 4, benchmark: 11, benchmarkAudit: 11, arrival: 21, arrivalAudit: 13 },
  limitation: 'A file-only launch review manifest, not an extra waiting gate. Existing benchmark/arrival verify captured source/config/index identities during the run.' };
await writeFile(path.join(directory, 'source-config-plan-pins-v2.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ pinCount: pins.length, manifest: path.join(directory, 'source-config-plan-pins-v2.json') }));
