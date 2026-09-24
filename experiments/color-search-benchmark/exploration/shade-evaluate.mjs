// Read-only paired evaluation and replay. Ranking always comes from OpenSearch.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE, hash, loadExpandedCorpus } from './service.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const methods = ['cutoff-all-levels', 'cutoff-shade-all-levels'];
const exampleIds = ['madness-wallhaven-gww23l', 'madness-wallhaven-9oov2d', 'wallpaper-004', 'wallpaper-031'];
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const save = (filename, value) => writeFile(filename, JSON.stringify(value, null, 2) + '\n');
const mean = values => {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
};

async function configuration() {
  const config = await json(path.join(sourceDirectory, 'configs/shade-aware.json'));
  assert.equal(config.candidates.length, 49);
  assert.equal(new Set(config.candidates.map(candidate => candidate.id)).size, 49);
  const canonical = config.candidates.find(candidate => candidate.id === 'cutoff-shade-all-levels');
  assert.ok(canonical && !Object.hasOwn(canonical, 'parameters'), 'Canonical method must use registered defaults');
  const paired = config.candidates.filter(candidate => candidate.parameters);
  for (const bucketCount of [16, 64, 256, 1024]) for (const qualityInfluence of [1, 3]) for (const cutoffBlendExponent of [0, 3, 6]) {
    const pair = paired.filter(candidate => candidate.parameters.bucketCount === bucketCount && candidate.parameters.qualityInfluence === qualityInfluence && candidate.parameters.cutoffBlendExponent === cutoffBlendExponent);
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map(candidate => candidate.method).sort(), [...methods].sort());
    assert.deepEqual(pair[0].parameters, pair[1].parameters);
    assert.equal(pair[0].parameters.qualityCurve, 'power');
    assert.equal(pair[0].parameters.minimumQuality, 0);
  }
  return config;
}

async function replay(config) {
  const { createOverlapInspectorProvider } = await import('./overlap-inspector-provider.mjs');
  const provider = await createOverlapInspectorProvider();
  const corpus = await loadExpandedCorpus();
  const realIds = new Set(corpus.filter(asset => asset.cohort !== 'controlled-fixture' && !asset.filename.endsWith('.svg')).map(asset => asset.id));
  assert.equal(corpus.length, 545); assert.equal(realIds.size, 523);
  for (const id of exampleIds) assert.ok(realIds.has(id), `Missing replay image ${id}`);
  const directory = option('--output-directory') ?? path.join(STORE, 'shade-aware', `replay-${new Date().toISOString().replaceAll(':', '-')}`);
  await mkdir(directory, { recursive: true });
  const sourceNames = (await readdir(sourceDirectory)).filter(name => name.endsWith('.mjs')).sort();
  const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(path.join(sourceDirectory, name), 'utf8')])));
  const sourceHashes = Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)]));
  await save(path.join(directory, 'sources.json'), sources);
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const result = { createdAt: new Date().toISOString(), query, exampleIds, sourceHashes, matrix: [], notes: [
    'All ranks, scores and ordered hits come from real OpenSearch. No application reranking.',
    'Both reported user examples and two diagnostic comparison images are tracked without inventing preference pairs.',
    'The 523 real wallpapers are globally ranked; controlled fixtures are excluded inside OpenSearch.',
    '48 paired searches plus 192 single-document inspections. These explanatory replays are not latency benchmarks.',
    'Ranks assume picked #FF0000, vibe mode, power quality and minimum average quality zero; exact earlier user controls were not recorded.',
  ] };
  for (const candidate of config.candidates.filter(candidate => candidate.parameters)) {
    const request = { method: candidate.method, query, parameters: candidate.parameters };
    const search = await provider.search({ ...request, limit: corpus.length });
    assert.equal(search.supported, true);
    assert.equal(search.hits.length, realIds.size);
    assert.deepEqual(new Set(search.hits.map(hit => hit.id)), realIds);
    const examples = [];
    for (const id of exampleIds) {
      const position = search.hits.findIndex(hit => hit.id === id), hit = search.hits[position];
      const inspection = await provider.inspect({ ...request, id });
      assert.ok(Math.abs(hit.score - inspection.score.actual) < 1e-6);
      assert.ok(Math.abs(inspection.score.difference) < 1e-6);
      const greater = search.hits.filter(other => other.score > hit.score).length;
      const tied = search.hits.filter(other => other.score === hit.score).length;
      examples.push({ id, rank: position + 1, rankIntervalIgnoringIdTieBreak: [greater + 1, greater + tied], score: hit.score,
        terms: inspection.score.terms, formula: inspection.score.formula, reconstructionDifference: inspection.score.difference,
        selectedRegion: inspection.regions.find(region => region.selectedBy?.length), inspectionEvidence: inspection.evidence });
    }
    result.matrix.push({ id: candidate.id, ...request, parameters: search.parameters, hitCount: search.hits.length, examples, orderedHits: search.hits, evidence: search.evidence });
    await save(path.join(directory, 'rank-matrix.partial.json'), result);
    console.log(JSON.stringify({ candidate: candidate.id, examples: examples.map(({ id, rank, score }) => ({ id, rank, score })) }));
  }
  result.finishedAt = new Date().toISOString();
  result.sourceSnapshotSha256 = hash(sources);
  await save(path.join(directory, 'rank-matrix.json'), result);
  console.log(JSON.stringify({ directory, searches: result.matrix.length, inspections: result.matrix.length * exampleIds.length }));
}

function aggregate(cases) {
  return { cases: cases.length, agreement: mean(cases.map(row => row.accuracy.allPairs.agreement)),
    withoutUncertain: mean(cases.map(row => row.accuracy.withoutUncertain.agreement)),
    pairs: cases.reduce((sum, row) => sum + row.accuracy.allPairs.assessedPairs, 0),
    ties: cases.reduce((sum, row) => sum + row.accuracy.allPairs.tied, 0),
    missingImages: cases.reduce((sum, row) => sum + row.accuracy.coverage.missingIds.length, 0),
    eligibilityViolations: cases.reduce((sum, row) => sum + row.accuracy.eligibility.violations, 0) };
}

async function analyze(config, input) {
  const filename = input.endsWith('.json') ? path.resolve(input) : path.resolve(input, 'run.json');
  const run = await json(filename);
  assert.equal(run.dataset.corpusSize, 545);
  assert.equal(run.dataset.caseCount, 37);
  assert.deepEqual(run.candidates.map(candidate => candidate.id), config.candidates.map(candidate => candidate.id));
  const snapshot = run.configuration.sourceSnapshot;
  const sources = await json(snapshot.path);
  assert.equal(hash(sources), snapshot.sha256, 'Immutable source snapshot hash');
  const referenceHashes = run.candidates[0].sourceHashes;
  const auxiliaryWorkspaceSources = [];
  for (const [filename, digest] of Object.entries(referenceHashes)) {
    if (filename.endsWith('.mjs')) continue;
    assert.equal(hash(await readFile(path.resolve(sourceDirectory, '..', filename))), digest, `Auxiliary workspace source differs: ${filename}`);
    auxiliaryWorkspaceSources.push(filename);
  }
  let verifiedSourceEntries = 0;
  const rows = run.candidates.map(candidate => {
    assert.deepEqual(candidate.sourceHashes, referenceHashes, 'Query sources changed during the feedback run');
    for (const [filename, digest] of Object.entries(candidate.sourceHashes)) {
      if (!filename.endsWith('.mjs')) continue;
      const key = filename.replace(/^exploration\//, '');
      // This feedback adapter records source files in the exploration directory.
      assert.ok(Object.hasOwn(sources, key), `Missing snapshot source ${filename}`);
      assert.equal(hash(sources[key]), digest, `Source snapshot differs: ${filename}`);
      verifiedSourceEntries++;
    }
    const cases = candidate.cases.filter(row => row.status === 'ok');
    assert.deepEqual(candidate.summary.coverage, { total: 37, ok: 31, unsupported: 6, error: 0 });
    const isProportion = row => row.query?.specifiedPercentages != null || Boolean(row.query?.colorTargets);
    const timed = cases.flatMap(row => row.performance.trials.filter(trial => Number.isFinite(trial.elapsedMs)));
    const samples = candidate.summary.performance.samplesMs;
    assert.equal(timed.length, samples.length, 'Raw timed request count');
    assert.equal(timed.length, candidate.summary.performance.sampleCount);
    assert.equal(Math.max(...timed.map(trial => trial.elapsedMs)), candidate.summary.performance.maxMs);
    assert.deepEqual(timed.map(trial => trial.elapsedMs).sort((a, b) => a - b), [...samples].sort((a, b) => a - b));
    const { samplesMs, ...performance } = candidate.summary.performance;
    assert.equal(performance.failures, 0);
    assert.equal(performance.sampleCount, 93);
    assert.ok(['p50Ms', 'p95Ms', 'maxMs'].every(key => Number.isFinite(performance[key]) && performance[key] >= 0));
    const row = { id: candidate.id, method: candidate.configuration.method, parameters: candidate.configuration.parameters ?? {},
      coverage: candidate.summary.coverage, all: aggregate(cases), real: aggregate(cases.filter(row => row.inputKind === 'image')),
      vibe: aggregate(cases.filter(row => !isProportion(row))), proportions: aggregate(cases.filter(isProportion)),
      byCategory: Object.fromEntries([...new Set(cases.map(row => row.category))].map(category => [category, aggregate(cases.filter(row => row.category === category))])),
      performance, timedAtOrAbove1s: timed.filter(trial => trial.elapsedMs >= 1000).length,
      cases: cases.map(row => ({ caseId: row.caseId, category: row.category, inputKind: row.inputKind, query: row.query,
        agreement: row.accuracy.allPairs.agreement, withoutUncertain: row.accuracy.withoutUncertain.agreement,
        discrepancies: row.accuracy.discrepancies, expectedIds: row.accuracy.coverage.expectedIds })) };
    assert.equal(row.all.agreement, candidate.summary.accuracy.allPairs.queryMacroAgreement);
    assert.equal(row.all.missingImages, 0);
    assert.equal(row.all.eligibilityViolations, 0);
    return row;
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  const comparisons = rows.filter(row => row.method === 'cutoff-shade-all-levels' && Object.hasOwn(row.parameters, 'bucketCount')).map(candidate => {
    const baseline = byId.get(candidate.id.replace('cutoff-shade-all-levels', 'cutoff-all-levels'));
    assert.deepEqual(candidate.parameters, baseline.parameters);
    assert.deepEqual(candidate.cases.map(row => row.caseId).sort(), baseline.cases.map(row => row.caseId).sort());
    const baselineCases = new Map(baseline.cases.map(row => [row.caseId, row]));
    const changes = candidate.cases.map(row => ({ caseId: row.caseId, category: row.category, inputKind: row.inputKind,
      baselineAgreement: baselineCases.get(row.caseId)?.agreement, candidateAgreement: row.agreement,
      delta: row.agreement - baselineCases.get(row.caseId)?.agreement }));
    assert.ok(changes.every(change => Number.isFinite(change.delta)), 'Paired methods must support the same cases');
    return { candidate: candidate.id, baseline: baseline.id, parameters: candidate.parameters,
      allDelta: candidate.all.agreement - baseline.all.agreement,
      realDelta: candidate.real.agreement - baseline.real.agreement,
      realWithoutUncertainDelta: candidate.real.withoutUncertain - baseline.real.withoutUncertain,
      vibeDelta: candidate.vibe.agreement - baseline.vibe.agreement,
      proportionsDelta: candidate.proportions.agreement - baseline.proportions.agreement,
      improvedCases: changes.filter(change => change.delta > 1e-12), regressedCases: changes.filter(change => change.delta < -1e-12),
      unchangedCases: changes.filter(change => Math.abs(change.delta) <= 1e-12).length };
  });
  assert.equal(comparisons.length, 24);
  const findings = { runId: run.id, analyzedAt: new Date().toISOString(), sourceRun: filename, sourceRunSha256: hash(await readFile(filename)),
    candidateCount: rows.length, pairedComparisons: comparisons.length, corpusSize: run.dataset.corpusSize,
    workload: run.workload ?? run.configuration.workload, sourceSnapshot: snapshot, verifiedSourceEntries, auxiliaryWorkspaceSources,
    timedRequests: rows.reduce((sum, row) => sum + row.performance.sampleCount, 0),
    timedAtOrAbove1s: rows.reduce((sum, row) => sum + row.timedAtOrAbove1s, 0),
    failures: rows.reduce((sum, row) => sum + row.performance.failures, 0),
    candidateP95Range: [Math.min(...rows.map(row => row.performance.p95Ms)), Math.max(...rows.map(row => row.performance.p95Ms))],
    maxTimedMs: Math.max(...rows.map(row => row.performance.maxMs)), rows, comparisons,
    limitations: [
      'Single-observer development preferences with repeated related images and queries; not an independent held-out accuracy study.',
      'The archive wallpapers, including the two newly reported examples, have no scored human relevance labels.',
      'Each query receives equal weight. Exact model ties receive half credit on a strict human preference.',
      'One warmup and three repeats at concurrency one on 545 assets cannot establish million-record latency or concurrent production capacity.',
      'Paired methods share the query formula and change the measured color similarity, so measurement-induced distribution changes can affect runtime.',
      'A shade-tolerant distance can regress precise-swatch intent. This experiment does not replace the original method or choose a production winner.',
    ] };
  const output = path.join(path.dirname(filename), 'shade-findings.json');
  await save(output, findings);
  console.log(JSON.stringify({ ...findings, rows: undefined, comparisons: undefined, output }, null, 2));
  for (const comparison of comparisons) console.log(JSON.stringify({ ...comparison, improvedCases: comparison.improvedCases.length, regressedCases: comparison.regressedCases.length }));
}

try {
  const config = await configuration();
  if (args.includes('--dry-run')) console.log(JSON.stringify({ candidates: config.candidates.length, pairedSettings: 24, replaySearches: 48, replayInspections: 192, exampleIds, workload: config.workload }, null, 2));
  else if (args.includes('--replay')) await replay(config);
  else if (option('--analyze')) await analyze(config, option('--analyze'));
  else throw Error('Use --dry-run, --replay [--output-directory PATH], or --analyze RUN_DIRECTORY.');
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
