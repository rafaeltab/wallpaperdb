// Diagnostic regression replay. Both ranking and component scores come from OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExpandedCorpus, STORE, hash } from './service.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const csv = (name, fallback, valid) => {
  const values = [...new Set(option(name, fallback).split(',').map(Number))];
  assert.ok(values.length && values.every(value => Number.isFinite(value) && valid(value)), `Invalid ${name}`);
  return values;
};
const save = (filename, value) => writeFile(filename, JSON.stringify(value, null, 2) + '\n');

try {
  const preferredId = option('--preferred-id'), otherId = option('--other-id');
  assert.ok(preferredId && otherId && preferredId !== otherId, 'Supply distinct --preferred-id and --other-id');
  const method = option('--method', 'cutoff-shade-all-levels');
  const banks = csv('--banks', '16,64,256,1024', value => [16, 64, 256, 1024].includes(value));
  const influences = csv('--influences', '1,3', value => value >= 0 && value <= 3);
  const blends = csv('--blends', '0,3,6', value => value >= 0 && value <= 6);
  const color = option('--color', '#ff0000');
  assert.match(color, /^#[0-9a-f]{6}$/i, 'Expected six-digit query color');
  const qualityCurve = option('--quality-curve', 'power');
  assert.ok(['power', 'linear'].includes(qualityCurve), 'Invalid quality curve');
  const minimumQuality = Number(option('--minimum-quality', '0'));
  assert.ok(Number.isFinite(minimumQuality) && minimumQuality >= 0 && minimumQuality <= 1);
  const query = { mode: 'vibe', targets: [{ color }] };
  const configurations = banks.flatMap(bucketCount => influences.flatMap(qualityInfluence => blends.map(cutoffBlendExponent => ({
    bucketCount, qualityInfluence, cutoffBlendExponent, qualityCurve, minimumQuality, namedMode: 'concrete-swatches',
  }))));
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ method, query, preferredId, otherId, configurations, assertPreference: args.includes('--assert-preference') }, null, 2));
  } else {
    const { createOverlapInspectorProvider } = await import('./overlap-inspector-provider.mjs');
    const provider = await createOverlapInspectorProvider(), corpus = await loadExpandedCorpus();
    const realIds = new Set(corpus.filter(asset => asset.cohort !== 'controlled-fixture' && !asset.filename.endsWith('.svg')).map(asset => asset.id));
    assert.equal(corpus.length, 545); assert.equal(realIds.size, 523);
    assert.ok(realIds.has(preferredId) && realIds.has(otherId), 'Both preference endpoints must be real corpus wallpapers');
    const directory = option('--output-directory', path.join(STORE, 'shade-pair', new Date().toISOString().replaceAll(':', '-')));
    await mkdir(directory, { recursive: true });
    const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
    const sourceNames = (await readdir(sourceDirectory)).filter(name => name.endsWith('.mjs')).sort();
    const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(path.join(sourceDirectory, name), 'utf8')])));
    const sourceHashes = Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)]));
    await save(path.join(directory, 'sources.json'), sources);
    const report = { createdAt: new Date().toISOString(), method, query, sourceHashes, sourceSnapshotSha256: hash(sources),
      preference: { preferred: preferredId, other: otherId, source: 'Explicit user preference: the red pagoda/moon scene should outrank the orange/yellow sky for a red query.',
        kind: 'strict pair', numericAreaLabels: null, inferredAdditionalPairs: [] },
      corpus: { total: corpus.length, real: realIds.size, images: [preferredId, otherId].map(id => {
        const asset = corpus.find(asset => asset.id === id); return { id, filename: asset.filename, sha256: asset.sha256 };
      }) },
      matrix: [], notes: [
        'Both complete result order and inspected scores come from real OpenSearch; no application candidate reranking.',
        'Controlled fixtures are excluded inside the search service, retaining all 523 real corpus images.',
        'This is a preference regression replay, not a latency or throughput benchmark.',
        'The reported display ranks were pagoda93 and sky61. Exact original query controls were not captured; qualitative preference is evaluated independently of reproducing those exact ranks.',
        'A tied score fails the strict preference assertion. Rankings alone do not assign human color percentages or component quality labels.',
      ] };
    for (const parameters of configurations) {
      const request = { method, query, parameters };
      const search = await provider.search({ ...request, limit: corpus.length });
      assert.equal(search.supported, true);
      assert.deepEqual(new Set(search.hits.map(hit => hit.id)), realIds);
      assert.equal(search.hits.length, realIds.size);
      const examples = [];
      for (const id of [preferredId, otherId]) {
        const position = search.hits.findIndex(hit => hit.id === id), hit = search.hits[position];
        const inspection = await provider.inspect({ ...request, id });
        assert.ok(Math.abs(hit.score - inspection.score.actual) < 1e-6, 'Search and diagnostic scores differ');
        assert.ok(Math.abs(inspection.score.difference) < 1e-6, 'Diagnostic reconstruction differs');
        const greater = search.hits.filter(other => other.score > hit.score).length;
        const tied = search.hits.filter(other => other.score === hit.score).length;
        examples.push({ id, rank: position + 1, rankIntervalIgnoringIdTieBreak: [greater + 1, greater + tied], score: hit.score,
          definition: inspection.definition, terms: inspection.score.terms, formula: inspection.score.formula,
          reconstructionDifference: inspection.score.difference,
          selectedRegion: inspection.regions.find(region => region.selectedBy?.length), inspectionEvidence: inspection.evidence });
      }
      const [preferred, other] = examples;
      const entry = { parameters: search.parameters, hitCount: search.hits.length, preferred, other,
        preferencePasses: preferred.score > other.score, scoreDifference: preferred.score - other.score,
        orderedHits: search.hits, evidence: search.evidence };
      report.matrix.push(entry);
      await save(path.join(directory, 'pair-replay.partial.json'), report);
      console.log(JSON.stringify({ bucketCount: parameters.bucketCount, qualityInfluence: parameters.qualityInfluence,
        cutoffBlendExponent: parameters.cutoffBlendExponent, preferredRank: preferred.rank, otherRank: other.rank,
        preferredScore: preferred.score, otherScore: other.score, preferencePasses: entry.preferencePasses }));
    }
    report.finishedAt = new Date().toISOString();
    report.assertion = { enabled: args.includes('--assert-preference'), expected: `${preferredId} score > ${otherId} score`,
      passed: report.matrix.filter(row => row.preferencePasses).length,
      failed: report.matrix.filter(row => !row.preferencePasses).length,
      allConfigurationsPass: report.matrix.every(row => row.preferencePasses) };
    await save(path.join(directory, 'pair-replay.json'), report);
    console.log(JSON.stringify({ directory, searches: report.matrix.length, inspections: report.matrix.length * 2, assertion: report.assertion }));
    if (report.assertion.enabled && !report.assertion.allConfigurationsPass) {
      console.error(`Preference regression: ${report.assertion.failed}/${report.matrix.length} configurations fail ${report.assertion.expected}`);
      process.exitCode = 1;
    }
  }
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
