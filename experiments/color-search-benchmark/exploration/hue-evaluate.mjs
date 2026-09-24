// Read-only paired evaluation and replay. Ranking always comes from OpenSearch.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE, hash, loadExpandedCorpus } from './service.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const methods = ['cutoff-shade-all-levels', 'cutoff-shade-hue-all-levels'];
const exampleIds = ['madness-wallhaven-ogg7ql', 'wallpaper-031', 'madness-wallhaven-gww23l', 'madness-wallhaven-9oov2d'];
const newCaseId = 'perceived-red-pagoda-001';
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const save = (filename, value) => writeFile(filename, JSON.stringify(value, null, 2) + '\n');
const mean = values => {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
};

async function configuration() {
  const config = await json(path.join(sourceDirectory, 'configs/hue-aware.json'));
  assert.equal(config.candidates.length, 49);
  assert.equal(new Set(config.candidates.map(candidate => candidate.id)).size, 49);
  const canonical = config.candidates.find(candidate => candidate.id === 'cutoff-shade-hue-all-levels');
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
  const directory = option('--output-directory') ?? path.join(STORE, 'hue-aware', `replay-${new Date().toISOString().replaceAll(':', '-')}`);
  await mkdir(directory, { recursive: true });
  const sourceNames = (await readdir(sourceDirectory)).filter(name => name.endsWith('.mjs')).sort();
  const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(path.join(sourceDirectory, name), 'utf8')])));
  const sourceHashes = Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)]));
  await save(path.join(directory, 'sources.json'), sources);
  const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
  const result = { createdAt: new Date().toISOString(), query, exampleIds, sourceHashes, matrix: [], notes: [
    'All ranks, scores and ordered hits come from real OpenSearch. No application reranking.',
    'The explicit pagoda-over-orange preference is tracked along with two earlier red portraits; no additional human pairs are inferred.',
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
  const byId = new Map(result.matrix.map(entry => [entry.id, entry]));
  const pairs = result.matrix.filter(entry => entry.method === methods[1]).map(candidate => {
    const baseline = byId.get(candidate.id.replace(methods[1], methods[0]));
    const changes = candidate.examples.map(example => {
      const before = baseline.examples.find(previous => previous.id === example.id);
      return { id: example.id, baselineRank: before.rank, candidateRank: example.rank,
        baselineScore: before.score, candidateScore: example.score,
        relativeScoreChange: before.score ? example.score / before.score - 1 : example.score === 0 ? 0 : null };
    });
    return { parameters: candidate.parameters, baselinePreferencePasses: baseline.examples[0].score > baseline.examples[1].score,
      candidatePreferencePasses: candidate.examples[0].score > candidate.examples[1].score, changes };
  });
  await save(path.join(directory, 'pair-summary.json'), { source: 'rank-matrix.json', selectedDevelopmentPair: true, pairs,
    baselinePasses: pairs.filter(pair => pair.baselinePreferencePasses).length,
    candidatePasses: pairs.filter(pair => pair.candidatePreferencePasses).length });
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
  assert.equal(run.dataset.caseCount, 38);
  assert.deepEqual(run.configuration.extraImageFiles, ['evaluation/perceived-red-pagoda-001.json']);
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
    assert.deepEqual(candidate.summary.coverage, { total: 38, ok: 32, unsupported: 6, error: 0 });
    const historicalCases = cases.filter(row => row.caseId !== newCaseId);
    const newPairCases = cases.filter(row => row.caseId === newCaseId);
    assert.equal(historicalCases.length, 31);
    assert.equal(historicalCases.filter(row => row.inputKind === 'image').length, 27);
    assert.equal(newPairCases.length, 1);
    assert.equal(newPairCases[0].accuracy.allPairs.assessedPairs, 1);
    const isProportion = row => row.query?.specifiedPercentages != null || Boolean(row.query?.colorTargets);
    const timed = cases.flatMap(row => row.performance.trials.filter(trial => Number.isFinite(trial.elapsedMs)));
    const samples = candidate.summary.performance.samplesMs;
    assert.equal(timed.length, samples.length, 'Raw timed request count');
    assert.equal(timed.length, candidate.summary.performance.sampleCount);
    assert.equal(Math.max(...timed.map(trial => trial.elapsedMs)), candidate.summary.performance.maxMs);
    assert.deepEqual(timed.map(trial => trial.elapsedMs).sort((a, b) => a - b), [...samples].sort((a, b) => a - b));
    const { samplesMs, ...performance } = candidate.summary.performance;
    assert.equal(performance.failures, 0);
    assert.equal(performance.sampleCount, 96);
    assert.ok(['p50Ms', 'p95Ms', 'maxMs'].every(key => Number.isFinite(performance[key]) && performance[key] >= 0));
    const row = { id: candidate.id, method: candidate.configuration.method, parameters: candidate.configuration.parameters ?? {},
      coverage: candidate.summary.coverage, all: aggregate(cases), real: aggregate(cases.filter(row => row.inputKind === 'image')),
      historical: aggregate(historicalCases), historicalReal: aggregate(historicalCases.filter(row => row.inputKind === 'image')),
      historicalVibe: aggregate(historicalCases.filter(row => !isProportion(row))), historicalProportions: aggregate(historicalCases.filter(isProportion)),
      newPair: { ...aggregate(newPairCases), selectedDevelopmentPair: true, caseId: newCaseId },
      vibe: aggregate(cases.filter(row => !isProportion(row))), proportions: aggregate(cases.filter(isProportion)),
      byCategory: Object.fromEntries([...new Set(cases.map(row => row.category))].map(category => [category, aggregate(cases.filter(row => row.category === category))])),
      performance, timedAtOrAbove1s: timed.filter(trial => trial.elapsedMs >= 1000).length,
      cases: cases.map(row => ({ caseId: row.caseId, category: row.category, inputKind: row.inputKind, query: row.query,
        agreement: row.accuracy.allPairs.agreement, withoutUncertain: row.accuracy.withoutUncertain.agreement,
        discrepancies: row.accuracy.discrepancies, expectedIds: row.accuracy.coverage.expectedIds })) };
    assert.equal(row.all.agreement, candidate.summary.accuracy.allPairs.queryMacroAgreement);
    assert.equal(row.historical.pairs, 233);
    assert.equal(row.historicalReal.pairs, 183);
    assert.equal(row.all.missingImages, 0);
    assert.equal(row.all.eligibilityViolations, 0);
    return row;
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  const comparisons = rows.filter(row => row.method === 'cutoff-shade-hue-all-levels' && Object.hasOwn(row.parameters, 'bucketCount')).map(candidate => {
    const baseline = byId.get(candidate.id.replace('cutoff-shade-hue-all-levels', 'cutoff-shade-all-levels'));
    assert.deepEqual(candidate.parameters, baseline.parameters);
    assert.deepEqual(candidate.cases.map(row => row.caseId).sort(), baseline.cases.map(row => row.caseId).sort());
    const baselineCases = new Map(baseline.cases.map(row => [row.caseId, row]));
    const changes = candidate.cases.map(row => ({ caseId: row.caseId, category: row.category, inputKind: row.inputKind,
      baselineAgreement: baselineCases.get(row.caseId)?.agreement, candidateAgreement: row.agreement,
      delta: row.agreement - baselineCases.get(row.caseId)?.agreement }));
    assert.ok(changes.every(change => Number.isFinite(change.delta)), 'Paired methods must support the same cases');
    return { candidate: candidate.id, baseline: baseline.id, parameters: candidate.parameters,
      allDelta: candidate.all.agreement - baseline.all.agreement,
      historicalDelta: candidate.historical.agreement - baseline.historical.agreement,
      historicalRealDelta: candidate.historicalReal.agreement - baseline.historicalReal.agreement,
      historicalRealWithoutUncertainDelta: candidate.historicalReal.withoutUncertain - baseline.historicalReal.withoutUncertain,
      historicalVibeDelta: candidate.historicalVibe.agreement - baseline.historicalVibe.agreement,
      historicalProportionsDelta: candidate.historicalProportions.agreement - baseline.historicalProportions.agreement,
      newPair: { caseId: newCaseId, baselineAgreement: baseline.newPair.agreement, candidateAgreement: candidate.newPair.agreement, selectedDevelopmentPair: true },
      realDelta: candidate.real.agreement - baseline.real.agreement,
      realWithoutUncertainDelta: candidate.real.withoutUncertain - baseline.real.withoutUncertain,
      vibeDelta: candidate.vibe.agreement - baseline.vibe.agreement,
      proportionsDelta: candidate.proportions.agreement - baseline.proportions.agreement,
      improvedCases: changes.filter(change => change.delta > 1e-12), regressedCases: changes.filter(change => change.delta < -1e-12),
      historicalImprovedCases: changes.filter(change => change.caseId !== newCaseId && change.delta > 1e-12),
      historicalRegressedCases: changes.filter(change => change.caseId !== newCaseId && change.delta < -1e-12),
      unchangedCases: changes.filter(change => Math.abs(change.delta) <= 1e-12).length };
  });
  assert.equal(comparisons.length, 24);
  const findings = { runId: run.id, analyzedAt: new Date().toISOString(), sourceRun: filename, sourceRunSha256: hash(await readFile(filename)),
    candidateCount: rows.length, pairedComparisons: comparisons.length, corpusSize: run.dataset.corpusSize,
    caseGroups: { historicalTotal: 37, historicalSupported: 31, historicalRealSupported: 27, added: newCaseId, newPairSelectedDevelopment: true },
    workload: run.workload ?? run.configuration.workload, sourceSnapshot: snapshot, verifiedSourceEntries, auxiliaryWorkspaceSources,
    timedRequests: rows.reduce((sum, row) => sum + row.performance.sampleCount, 0),
    timedAtOrAbove1s: rows.reduce((sum, row) => sum + row.timedAtOrAbove1s, 0),
    failures: rows.reduce((sum, row) => sum + row.performance.failures, 0),
    candidateP95Range: [Math.min(...rows.map(row => row.performance.p95Ms)), Math.max(...rows.map(row => row.performance.p95Ms))],
    maxTimedMs: Math.max(...rows.map(row => row.performance.maxMs)), rows, comparisons,
    limitations: [
      'Single-observer development preferences with repeated related images and queries; not an independent held-out accuracy study.',
      'Only the explicit pagoda-over-orange pair is newly scored. It was selected after inspecting model failures and helped choose this experiment; it is development feedback, not held-out validation. The earlier red portraits remain unjudged.',
      'Each query receives equal weight. Exact model ties receive half credit on a strict human preference.',
      'One warmup and three repeats at concurrency one on 545 assets cannot establish million-record latency or concurrent production capacity.',
      'Paired methods share the query formula and change the measured color similarity, so measurement-induced distribution changes can affect runtime.',
      'Stricter hue can suppress useful adjacent colors. Historical31supported cases are reported separately from the new result-selected pair; no production winner is chosen.',
    ] };
  if (option('--legacy')) {
    const legacyPath = path.resolve(option('--legacy'), 'run.json');
    const legacy = await json(legacyPath);
    assert.equal(legacy.dataset.caseCount, 37);
    assert.equal(legacy.dataset.corpusSize, 545);
    assert.ok(!legacy.configuration.extraImageFiles?.length);
    assert.deepEqual(legacy.candidates.map(candidate => candidate.id), methods);
    assert.equal(legacy.configuration.sourceSnapshot.sha256, snapshot.sha256, 'Main and canonical-only runs use different source snapshots');
    const canonicalChecks = legacy.candidates.map(candidate => {
      // The runner expands a canonical no-parameter candidate to parameters:{}.
      assert.ok(!Object.hasOwn(legacy.configuration.candidates.find(entry => entry.id === candidate.id), 'parameters'));
      assert.deepEqual(candidate.configuration.parameters ?? {}, {});
      assert.deepEqual(candidate.summary.coverage, { total: 37, ok: 31, unsupported: 6, error: 0 });
      assert.deepEqual(candidate.sourceHashes, referenceHashes);
      const primaryId = candidate.id === methods[1] ? candidate.id : `${candidate.id}-1024-blend0-i1`;
      const primary = run.candidates.find(record => record.id === primaryId);
      const comparable = rows => rows.filter(row => row.caseId !== newCaseId).map(({ caseId, status, hits }) => ({ caseId, status, hits })).sort((a, b) => a.caseId.localeCompare(b.caseId));
      assert.deepEqual(comparable(candidate.cases), comparable(primary.cases), `Historical result parity failed for ${candidate.id}`);
      const trials = candidate.cases.flatMap(row => row.performance.trials);
      assert.equal(trials.length, 93);
      assert.equal(candidate.summary.performance.failures, 0);
      assert.equal(candidate.summary.performance.sampleCount, trials.length);
      assert.ok(trials.every(trial => !trial.error && Number.isFinite(trial.elapsedMs) && trial.elapsedMs >= 0));
      assert.deepEqual(trials.map(trial => trial.elapsedMs).sort((a, b) => a - b), [...candidate.summary.performance.samplesMs].sort((a, b) => a - b));
      const { samplesMs, ...performance } = candidate.summary.performance;
      return { id: candidate.id, primaryId, historicalResultsIdentical: true, performance,
        timedAtOrAbove1s: trials.filter(trial => trial.elapsedMs >= 1000).length };
    });
    findings.legacyDefaultRun = { runId: legacy.id, sourceRun: legacyPath, sourceRunSha256: hash(await readFile(legacyPath)),
      sourceSnapshot: legacy.configuration.sourceSnapshot, datasetFingerprint: legacy.dataset.hash,
      canonicalChecks, timedRequests: canonicalChecks.reduce((sum, row) => sum + row.performance.sampleCount, 0),
      note: 'Separate historical37-case canonical run. Its timing samples are not added to the main38-case sweep.' };
    await save(path.join(path.dirname(filename), 'legacy-default-parity.json'), findings.legacyDefaultRun);
  }
  const output = path.join(path.dirname(filename), 'hue-findings.json');
  await save(output, findings);
  console.log(JSON.stringify({ ...findings, rows: undefined, comparisons: undefined, output }, null, 2));
  for (const comparison of comparisons) console.log(JSON.stringify({ ...comparison, improvedCases: comparison.improvedCases.length, regressedCases: comparison.regressedCases.length }));
}

try {
  const config = await configuration();
  if (args.includes('--dry-run')) console.log(JSON.stringify({ candidates: config.candidates.length, pairedSettings: 24, replaySearches: 48, replayInspections: 192, exampleIds, workload: config.workload }, null, 2));
  else if (args.includes('--replay')) await replay(config);
  else if (option('--analyze')) await analyze(config, option('--analyze'));
  else throw Error('Use --dry-run, --replay [--output-directory PATH], or --analyze RUN_DIRECTORY [--legacy HISTORICAL_RUN_DIRECTORY].');
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
