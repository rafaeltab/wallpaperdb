// Read-only live parity checks. Evidence stays outside the worktree.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STORE } from './service.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapIndexForCount, overlapRegionsForCount } from './overlap-banks.mjs';
import { resolveOverlapTargets } from './methods-overlap.mjs';

const inspector = process.env.COLOR_OVERLAP_INSPECTOR_URL ?? 'http://127.0.0.1:8227';
const comparison = process.env.COLOR_EXPLORATION_BROWSER ?? 'http://127.0.0.1:8225';
const createdAt = new Date().toISOString();
const directory = path.join(STORE, 'overlap-inspector', createdAt.replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
const config = await (await fetch(`${inspector}/api/config`)).json();
assert.deepEqual(config.methods.map(method => method.id), ['overlap-quality-dense', 'overlap-quality-hybrid']);
assert.deepEqual(config.corpus, { total: 545, real: 523, fixtures: 22 });
assert.deepEqual(config.bucketCounts, OVERLAP_BUCKET_COUNTS);
assert.equal(config.defaultBucketCount, 1024);
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); assert.equal(response.status, 200, value.error); assert.notEqual(value.supported, false, value.reason); return value;
}
const checks = [];
const namedHybridRankings = new Map();
const cases = [
  ...config.presets.map(preset => ({ ...preset, tuning: {}, compareOriginal: true })),
  ...[config.presets[0], config.presets[3]].flatMap(preset => [
    { qualityInfluence: 0, minimumQuality: .7 },
    { qualityInfluence: 2.4, minimumQuality: .8 },
    { qualityInfluence: 3, minimumQuality: 1 },
  ].map(tuning => ({ ...preset, label: `${preset.label} / quality ${tuning.qualityInfluence}, minimum ${tuning.minimumQuality}`, tuning, compareOriginal: false }))),
];
for (const method of config.methods) for (const bucketCount of config.bucketCounts) for (const { label, query, tuning, compareOriginal } of cases) {
  const caption = `${method.id} / ${bucketCount} buckets / ${label}`;
  const body = { methodId: method.id, query, parameters: { bucketCount, ...tuning }, limit: 12, includeFixtures: false };
  const current = await post(`${inspector}/api/search`, body);
  assert.equal(current.parameters.bucketCount, bucketCount, `${caption}: search lost selected bank`);
  assert.equal(current.evidence.index, overlapIndexForCount(bucketCount), `${caption}: wrong search index`);
  const ranking = current.hits.map(({ id, score }) => ({ id, score }));
  if (bucketCount === 1024 && compareOriginal) {
    // The comparison may still run the original process, whose parameters do
    // not yet include bucketCount. Its unchanged defaults are the control.
    const { parameters, ...originalBody } = body;
    const prior = await post(`${comparison}/api/search`, originalBody);
    assert.deepEqual(ranking, prior.hits.map(({ id, score }) => ({ id, score })), `${caption}: comparison mismatch`);
  }
  if (method.id === 'overlap-quality-hybrid' && query.targets.every(target => target.name)) {
    if (namedHybridRankings.has(label)) assert.deepEqual(ranking, namedHybridRankings.get(label), `${caption}: named features changed between banks`);
    else namedHybridRankings.set(label, ranking);
  }
  assert.equal(current.hits.length, 12);
  const hit = current.hits[0];
  const diagnosis = await post(`${inspector}/api/inspect`, { id: hit.id, methodId: current.methodId, query: current.query, parameters: current.parameters });
  assert.deepEqual(diagnosis.parameters, current.parameters, `${caption}: inspection changed saved parameters`);
  assert.equal(diagnosis.evidence.index, overlapIndexForCount(bucketCount), `${caption}: wrong inspection index`);
  assert.equal(diagnosis.definition.anchorCount, bucketCount);
  assert.ok(Math.abs(diagnosis.score.actual - hit.score) < 1e-7, `${caption}: clicked score changed`);
  assert.ok(Math.abs(diagnosis.score.reconstructed - hit.score) < 2e-6, `${caption}: explanation mismatch`);
  const bank = overlapRegionsForCount(bucketCount);
  assert.equal(diagnosis.regions.length, bucketCount);
  assert.equal(new Set(diagnosis.regions.map(region => region.index)).size, bucketCount);
  assert.deepEqual(diagnosis.regions.map(region => ({ index: region.index, hex: region.hex })), bank.map(region => ({ index: region.index, hex: region.hex })), `${caption}: wrong anchor bank`);
  // Separate Node runtimes may differ by a few ULPs in RGB-to-OKLab math.
  // Anchor identity must remain exact; geometry permits only rounding noise.
  for (let i = 0; i < bank.length; i++) for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(diagnosis.regions[i].lab[channel] - bank[i].lab[channel]) < 1e-12, `${caption}: wrong anchor geometry`);
  }
  const expectedTargets = resolveOverlapTargets(method, query, { parameters: current.parameters }).targets;
  assert.deepEqual(diagnosis.score.terms.map(term => ({ regionIndex: term.regionIndex, coverageField: term.coverageField, qualityField: term.qualityField })), expectedTargets.map(target => ({ regionIndex: target.regionIndex, coverageField: target.coverageField, qualityField: target.qualityField })), `${caption}: wrong selected anchors`);
  assert.ok(Math.abs(diagnosis.score.terms.reduce((sum, term) => sum + term.scoreContribution, 0) - diagnosis.score.reconstructed) < 1e-10);
  for (const term of diagnosis.score.terms) {
    if (term.regionIndex !== null) assert.ok(bank.some(region => region.index === term.regionIndex), `${caption}: selected anchor is outside this bank`);
    assert.equal(term.qualityInfluence, current.parameters.qualityInfluence);
    assert.equal(term.minimumQuality, current.parameters.minimumQuality);
    const passes = !term.qualityThresholdApplies || term.conditionalQuality >= Math.fround(current.parameters.minimumQuality);
    assert.equal(term.passesMinimumQuality, passes, `${caption}: wrong quality gate`);
    if (!passes) assert.equal(term.scoreContribution, 0);
  }
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
  await writeFile(path.join(directory, `${String(checks.length + 1).padStart(3, '0')}-diagnostic.json`), JSON.stringify({ request: body, search: current, inspection: diagnosis }));
  checks.push({ method: method.id, bucketCount, index: diagnosis.evidence.index, label, parameters: current.parameters, comparedOriginal: bucketCount === 1024 && compareOriginal, id: hit.id, score: hit.score, regionsUsed: diagnosis.score.terms.map(term => term.regionIndex), scoreDifference: diagnosis.score.difference, searchMs: current.elapsedMs, inspectionMs: diagnosis.elapsedMs });
}
const receipt = { createdAt, inspector, comparison, corpus: config.corpus, bucketCounts: config.bucketCounts, methods: config.methods.map(method => method.id), checks, status: 'passed', note: 'Read-only API routing, saved-parameter, anchor-bank, quality-control and score-parity validation. The 1024-bucket defaults also match the existing comparison. This does not add relevance judgments or establish production latency.' };
await writeFile(path.join(directory, 'validation.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ directory, checks: checks.length, status: receipt.status }, null, 2));
