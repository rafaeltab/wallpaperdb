// Read-only live parity checks. Evidence stays outside the worktree.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STORE } from './service.mjs';

const inspector = process.env.COLOR_OVERLAP_INSPECTOR_URL ?? 'http://127.0.0.1:8227';
const comparison = process.env.COLOR_EXPLORATION_BROWSER ?? 'http://127.0.0.1:8225';
const createdAt = new Date().toISOString();
const directory = path.join(STORE, 'overlap-inspector', createdAt.replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
const config = await (await fetch(`${inspector}/api/config`)).json();
assert.deepEqual(config.methods.map(method => method.id), ['overlap-quality-dense', 'overlap-quality-hybrid']);
assert.deepEqual(config.corpus, { total: 545, real: 523, fixtures: 22 });
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); assert.equal(response.status, 200, value.error); assert.notEqual(value.supported, false, value.reason); return value;
}
const checks = [];
for (const method of config.methods) for (const { label, query } of config.presets) {
  const body = { methodId: method.id, query, limit: 12, includeFixtures: false };
  const current = await post(`${inspector}/api/search`, body);
  const prior = await post(`${comparison}/api/search`, body);
  assert.deepEqual(current.hits.map(({ id, score }) => ({ id, score })), prior.hits.map(({ id, score }) => ({ id, score })), `${method.id} ${label}: comparison mismatch`);
  assert.equal(current.hits.length, 12);
  const hit = current.hits[0];
  const diagnosis = await post(`${inspector}/api/inspect`, { id: hit.id, methodId: method.id, query });
  assert.ok(Math.abs(diagnosis.score.actual - hit.score) < 1e-7, `${label}: clicked score changed`);
  assert.ok(Math.abs(diagnosis.score.reconstructed - hit.score) < 2e-6, `${label}: explanation mismatch`);
  assert.equal(diagnosis.regions.length, 1024);
  assert.equal(new Set(diagnosis.regions.map(region => region.index)).size, 1024);
  assert.ok(Math.abs(diagnosis.score.terms.reduce((sum, term) => sum + term.scoreContribution, 0) - diagnosis.score.reconstructed) < 1e-10);
  for (const region of diagnosis.regions) {
    assert.ok(region.coverage >= 0 && region.coverage <= 1);
    assert.ok(region.conditionalQuality >= 0 && region.conditionalQuality <= 1);
    assert.ok(Math.abs(region.qualityMass - region.coverage * region.conditionalQuality) < 1e-10);
    if (region.coverage === 0) assert.equal(region.conditionalQuality, 0);
    for (const index of region.selectedBy) {
      const term = diagnosis.score.terms[index];
      assert.equal(term.regionIndex, region.index);
      assert.equal(term.coverage, region.coverage);
      assert.equal(term.conditionalQuality, region.conditionalQuality);
    }
  }
  const image = await fetch(`${inspector}${diagnosis.thumbnailUrl}`, { method: 'HEAD' }); assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /^image\//);
  await writeFile(path.join(directory, `${String(checks.length + 1).padStart(2, '0')}-diagnostic.json`), JSON.stringify(diagnosis));
  checks.push({ method: method.id, label, id: hit.id, score: hit.score, regionsUsed: diagnosis.score.terms.map(term => term.regionIndex), scoreDifference: diagnosis.score.difference, searchMs: current.elapsedMs, inspectionMs: diagnosis.elapsedMs });
}
const receipt = { createdAt, inspector, comparison, corpus: config.corpus, methods: config.methods.map(method => method.id), checks, status: 'passed', note: 'Read-only interface and score-parity validation. This does not add relevance judgments or establish production latency.' };
await writeFile(path.join(directory, 'validation.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ directory, checks: checks.length, status: receipt.status }, null, 2));
