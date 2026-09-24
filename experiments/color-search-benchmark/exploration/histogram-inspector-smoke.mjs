// Read-only live parity checks. Diagnostics are saved outside the worktree.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STORE } from './service.mjs';

const inspector = process.env.COLOR_HISTOGRAM_INSPECTOR_URL ?? 'http://127.0.0.1:8226';
const comparison = process.env.COLOR_EXPLORATION_BROWSER ?? 'http://127.0.0.1:8225';
const createdAt = new Date().toISOString();
const directory = path.join(STORE, 'histogram-inspector', createdAt.replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
const config = await (await fetch(`${inspector}/api/config`)).json();
assert.equal(config.method.id, 'histogram-intent-balanced');
assert.deepEqual(config.corpus, { total: 545, real: 523, fixtures: 22 });
const labels = [
  'Feels red', '40% green, rest free', '80% grayscale + 20% red',
  '80% grayscale + 10% red, rest free', 'Precise orange-red',
  'Dark grayscale · HSL range', 'Dark with bright spots',
];
const cases = labels.map(label => {
  const preset = config.presets.find(item => item.label === label);
  assert.ok(preset, `Missing ${label}`);
  return preset;
});
cases.push({ label: 'Grayscale with red accents', query: { mode: 'vibe', targets: [{ name: 'grayscale', color: '#808080' }, { name: 'red', color: '#ef2020' }] } });
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  assert.equal(response.status, 200, value.error);
  return value;
}
const checks = [];
for (const [i, { label, query }] of cases.entries()) {
  const body = { query, limit: 12, includeFixtures: false };
  const current = await post(`${inspector}/api/search`, body);
  const prior = await post(`${comparison}/api/search`, { ...body, methodId: config.method.id });
  assert.deepEqual(current.hits.map(({ id, score }) => ({ id, score })), prior.hits.map(({ id, score }) => ({ id, score })), `${label}: comparison changed`);
  assert.equal(current.hits.length, 12);
  const hit = current.hits[0];
  const diagnostic = await post(`${inspector}/api/inspect`, { id: hit.id, query });
  assert.ok(Math.abs(diagnostic.score.actual - hit.score) < 1e-7, `${label}: clicked score changed`);
  assert.ok(Math.abs(diagnostic.score.reconstructed - hit.score) < 2e-6, `${label}: explanation mismatch`);
  assert.equal(diagnostic.bins.length, 4096);
  assert.equal(new Set(diagnostic.bins.map(bin => bin.index)).size, 4096);
  assert.ok(Math.abs(diagnostic.bins.reduce((sum, bin) => sum + bin.coverage, 0) - 1) < 1e-9);
  assert.equal(diagnostic.bins.reduce((sum, bin) => sum + bin.count, 0), diagnostic.totals.pixelCount);
  assert.equal(diagnostic.bins.filter(bin => bin.occupied).length, diagnostic.totals.occupiedBinCount);
  for (const bin of diagnostic.bins) if (!bin.occupied) {
    assert.equal(bin.count, 0);
    assert.equal(bin.coverage, 0);
    assert.equal(bin.leaveOneOutEffect, 0);
  }
  const image = await fetch(`${inspector}${diagnostic.thumbnailUrl}`, { method: 'HEAD' });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\//);
  await writeFile(path.join(directory, `${String(i + 1).padStart(2, '0')}-diagnostic.json`), JSON.stringify(diagnostic));
  checks.push({ label, id: hit.id, score: hit.score, occupiedBins: diagnostic.totals.occupiedBinCount, scoreDifference: diagnostic.score.difference, searchMs: current.elapsedMs, inspectionMs: diagnostic.elapsedMs });
}
const receipt = { createdAt, inspector, comparison, corpus: config.corpus, method: config.method.id, checks, status: 'passed', note: 'Read-only score and interface validation; no relevance judgments or production performance claims.' };
await writeFile(path.join(directory, 'validation.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ directory, checks: checks.length, status: receipt.status }, null, 2));
