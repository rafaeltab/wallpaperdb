// File-only result inventory. Never queries services or changes old evidence.
// Scope/index/artifact remain explicit; no cross-run averages or winner score.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const completed = value => Boolean(value.finishedAt || value.completedAt) && !value.error && !value.interruption;
const failure = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs >= 1000;
const sum = values => values.reduce((a, b) => a + b, 0);
const maximum = values => values.filter(Number.isFinite).length ? Math.max(...values.filter(Number.isFinite)) : null;
const minimum = values => values.filter(Number.isFinite).length ? Math.min(...values.filter(Number.isFinite)) : null;
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object?.[key] ?? null]));

export function optimizationResultsConfiguration(args = []) {
  const options = { feedback: [] };
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!['--root', '--output', '--feedback'].includes(key) || !value || value.startsWith('--')) throw Error('Use --root ARTIFACT_ROOT [--feedback run.json ...] [--output NEWFILE].');
    if (key === '--feedback') options.feedback.push(path.resolve(value));
    else if (options[key.slice(2)]) throw Error('Repeated option: ' + key);
    else options[key.slice(2)] = path.resolve(value);
  }
  if (!options.root) throw Error('Provide an artifact --root.');
  return options;
}

export function optimizationIndexSummary(state) {
  const mapping = state.mapping ?? state.mappings ?? {}, meta = mapping._meta ?? {};
  const primary = state.stats?.indices?.[state.index]?.primaries;
  const properties = mapping.properties?.utilities?.properties;
  return { index: state.index, count: state.count ?? null, uuid: state.uuid ?? null,
    scope: meta.scope ?? meta.identity?.scope ?? 'unknown', mode: meta.mode ?? meta.identity?.mode ?? null,
    encodings: meta.encodings ?? meta.identity?.encodings ?? null, numericPoints: meta.numericPoints ?? null,
    utilityCount: properties ? Object.keys(properties).length : null,
    sourceEnabled: Object.keys(mapping).length ? mapping._source?.enabled !== false : null,
    primaryStoreBytes: primary?.store?.size_in_bytes ?? null, segments: primary?.segments?.count ?? null,
    ...pick(state, ['mappingHash', 'metadataHash']) };
}

function totals(trials) {
  return { requests: trials.length, errors: trials.filter(row => row.error).length,
    atOrAboveOneSecond: trials.filter(row => row.elapsedMs >= 1000).length, strictFailures: trials.filter(failure).length };
}

function resources(profile) {
  const samples = [profile.before, ...(profile.samples ?? []), profile.after].filter(Boolean);
  const heap = sample => sum(Object.values(sample.nodes?.nodes ?? sample.nodes ?? {}).map(node => node.jvm?.mem?.heap_used_in_bytes ?? 0));
  const heapSamples = samples.filter(sample => sample.nodes).map(heap);
  const serverCpu = sample => sum(Object.values(sample?.nodes?.nodes ?? sample?.nodes ?? {}).map(node => node.process?.cpu?.total_in_millis ?? 0));
  const clientCpu = sample => sample?.clientCpu ? (sample.clientCpu.user + sample.clientCpu.system) / 1000 : null;
  const cpuMs = profile.cpuMs ?? (profile.before?.nodes && profile.after?.nodes ? serverCpu(profile.after) - serverCpu(profile.before) : null);
  const clientCpuMs = profile.clientCpuMs ?? (clientCpu(profile.before) !== null && clientCpu(profile.after) !== null ? clientCpu(profile.after) - clientCpu(profile.before) : null);
  const wallMs = profile.measuredWindowMs ?? profile.elapsedMs;
  return { serverCpuMs: cpuMs, clientCpuMs,
    meanServerCpuCores: cpuMs !== null && wallMs > 0 ? cpuMs / wallMs : null,
    meanClientCpuCores: clientCpuMs !== null && wallMs > 0 ? clientCpuMs / wallMs : null,
    peakSampledHeapBytes: profile.peakObservedHeapBytes ?? maximum(heapSamples),
    peakSampledClientRssBytes: profile.peakObservedClientRssBytes ?? maximum(samples.map(sample => sample.clientMemory?.rss)),
    resourceErrors: profile.resourceErrors ?? samples.filter(sample => sample.error).length,
    measurement: 'Sampled process/heap evidence; not a cgroup RSS/file-cache peak.' };
}

export function summarizeOptimizationPerformance(result, artifact) {
  const arrivals = result.experiment === 'favorite-optimization-arrival';
  const states = new Map((result.indexBefore ?? []).map(state => [state.index, state]));
  for (const state of result.indexAfter ?? []) states.set(state.index, state);
  const indexes = [...states.values()].map(optimizationIndexSummary), byIndex = new Map(indexes.map(index => [index.index, index]));
  const candidates = new Map((result.candidates ?? result.selection?.selected ?? []).map(candidate => [candidate.id, candidate]));
  const warmups = (result.warmups ?? []).flatMap(row => row.trials ?? [row]);
  const profiles = (result.profiles ?? []).map(profile => {
    const candidate = candidates.get(profile.candidateId) ?? {}, index = profile.index ?? candidate.index;
    const measured = totals(profile.trials ?? []);
    return { candidateId: profile.candidateId, method: profile.method ?? candidate.method, index, scope: byIndex.get(index)?.scope ?? 'unknown',
      parameters: profile.parameters ?? candidate.parameters ?? null, count: profile.count ?? result.configuration?.count ?? byIndex.get(index)?.count ?? null,
      queryId: profile.queryId ?? (arrivals ? result.configuration?.workload : null), selectivity: profile.selectivity ?? (arrivals ? 'all' : null),
      concurrency: profile.concurrency ?? null, arrivalRate: profile.rate ?? null,
      p95SuccessfulMs: arrivals ? null : profile.p95Ms ?? null, p95EndToEndMs: arrivals ? profile.p95Ms ?? null : null,
      ...pick(profile, ['p50Ms', 'p99Ms', 'maxMs', 'viableAtTestedLoad', 'strictWarmupFailures']),
      timed: measured, resources: resources(profile) };
  });
  const completedTimed = totals((result.profiles ?? []).flatMap(profile => profile.trials ?? []));
  return { artifact, kind: arrivals ? 'arrivals' : 'closed-loop', complete: completed(result), finishedAt: result.finishedAt ?? null,
    interruption: result.interruption?.error ?? result.error ?? null, configuration: result.configuration,
    sourceSnapshotHash: result.sourceSnapshotHash, indexes, profiles, timed: completedTimed, completedTimed, warmup: totals(warmups),
    timedCoverage: completed(result) ? 'completed-profile-set' : 'completed-profiles-only',
    pendingEvidence: completed(result) ? null : { status: 'unavailable', timed: null, warmup: null,
      reason: 'No matching independent raw-evidence audit. Completed-profile totals exclude unfinished work.' },
    failedProfiles: profiles.filter(profile => profile.viableAtTestedLoad === false).length,
    profilesWithoutViabilityResult: profiles.filter(profile => profile.viableAtTestedLoad === null).length,
    pendingProfilesAreNotPasses: !completed(result), skipped: result.skipped ?? [],
    limitations: result.limitations ?? [] };
}

// An interrupted recorder can leave timed rows outside its completed profiles.
// Bind the independent audit to the exact checkpoint/source objects, then stream
// and hash the raw log now. Older audits did not hash that log: reconciliation
// verifies their counts, not that the bytes are unchanged since the audit date.
async function bindPendingEvidence(campaign, checkpoint, audits) {
  const directory = path.dirname(campaign.artifact.path), require = (ok, message) => { if (!ok) throw Error(message); };
  const objectHash = value => hash(JSON.stringify(value));
  const matching = audits.filter(({ object }) => object.hashes?.benchmark === objectHash(checkpoint));
  require(matching.length > 0, 'No independent audit matches this benchmark checkpoint.');
  const { object: audit, artifact } = matching.at(-1);
  require(audit.schemaVersion === 1 && audit.integrityPassed === true && audit.errorCount === 0 && audit.errors?.length === 0,
    'Independent audit did not pass integrity checks.');
  require(path.resolve(audit.directory ?? '') === directory && path.resolve(checkpoint.configuration?.directory ?? '') === directory,
    'Independent audit directory differs from this campaign.');
  require(audit.complete === false && audit.profileCount === campaign.profiles.length, 'Independent audit completion/profile count differs.');
  const bindings = {};
  for (const [name, key] of [['plan.json', 'plan'], ['source-snapshot.json', 'archivedSources']]) {
    const bytes = await readFile(path.join(directory, name));
    require(objectHash(JSON.parse(bytes)) === audit.hashes[key], 'Independent audit ' + key + ' hash differs.');
    bindings[key] = { path: path.join(directory, name), sha256: hash(bytes) };
  }
  const counters = ['requests', 'errors', 'atOrAboveOneSecond', 'strictFailures'];
  const audited = phase => {
    const values = Object.fromEntries(counters.map((key, i) => [key, audit.totals?.[phase + ['Requests', 'Errors', 'OverOneSecond', 'StrictFailures'][i]]]));
    require(Object.values(values).every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid audited request counters.');
    require(values.strictFailures >= Math.max(values.errors, values.atOrAboveOneSecond) && values.strictFailures <= values.requests,
      'Invalid audited failure union.');
    return values;
  };
  const timed = audited('timed'), warmup = audited('warmup');
  const subtract = (all, done) => Object.fromEntries(counters.map(key => {
    require(all[key] >= done[key], 'Audited counters are below completed checkpoint totals.');
    return [key, all[key] - done[key]];
  }));
  const pendingTimed = subtract(timed, campaign.completedTimed), pendingWarmup = subtract(warmup, campaign.warmup);
  for (const values of [pendingTimed, pendingWarmup]) require(values.strictFailures >= Math.max(values.errors, values.atOrAboveOneSecond)
    && values.strictFailures <= Math.min(values.requests, values.errors + values.atOrAboveOneSecond), 'Invalid pending failure union.');
  require(audit.pendingTimedRows === pendingTimed.requests && audit.pendingWarmupRows === pendingWarmup.requests &&
    audit.rawRequestRows === timed.requests + warmup.requests, 'Audited pending/raw counts do not reconcile.');
  const filename = path.join(directory, 'requests.jsonl'), before = await stat(filename), digest = createHash('sha256');
  const raw = { timed: totals([]), warmup: totals([]) }, ids = new Set(); let byteCount = 0;
  const input = createReadStream(filename);
  input.on('data', bytes => { digest.update(bytes); byteCount += bytes.length; });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      const row = JSON.parse(line), values = raw[row.phase];
      require(['timed', 'warmup'].includes(row.phase) && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0
        && typeof row.requestId === 'string' && !ids.has(row.requestId), 'Invalid raw request identity, phase or latency.');
      ids.add(row.requestId); values.requests++; values.errors += Number(Boolean(row.error));
      values.atOrAboveOneSecond += Number(row.elapsedMs >= 1000); values.strictFailures += Number(failure(row));
    }
  } finally { input.destroy(); }
  const after = await stat(filename);
  require(before.size === byteCount && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino,
    'Raw request log changed during inventory.');
  for (const [phase, expected] of [['timed', timed], ['warmup', warmup]]) for (const key of counters)
    require(raw[phase][key] === expected[key], 'Raw request totals differ from independent audit: ' + phase + '/' + key);
  require(hash(await readFile(campaign.artifact.path)) === campaign.artifact.sha256, 'Benchmark checkpoint changed during inventory.');
  return { status: 'verified', timed: pendingTimed, warmup: pendingWarmup, allTimed: timed, allWarmup: warmup,
    audit: artifact, rawRequests: { path: filename, sha256: digest.digest('hex'), bytes: byteCount }, bindings,
    evidenceBoundary: 'Independent audit bound to checkpoint/plan/archived-source objects. Raw log hashed at inventory time and its counters reconciled with that audit; the older audit did not record a raw-log hash. Pending rows are observations, not completed profiles or final latency percentiles.' };
}

export function summarizeOptimizationFidelity(result, artifact) {
  const groups = new Map();
  for (const row of result.rows ?? []) {
    const method = row.method ?? result.method ?? 'unrecorded';
    if (!groups.has(method)) groups.set(method, []);
    groups.get(method).push(row);
  }
  const multiplicity = result.experiment === 'favorite-utility-multiplicity-fidelity' ? {
    duplicateSuiteExecutions: result.correctedExecutions ?? null,
    actualDuplicateWeightCorrections: (result.rows ?? []).filter(row => row.phase === 'corrected' && row.evidence?.multiplicity?.corrected === true).length,
    unchangedDuplicateSuiteControls: (result.rows ?? []).filter(row => row.phase === 'corrected' && row.evidence?.multiplicity?.corrected === false).length,
    distinctParentComparisons: result.distinctParentComparisons ?? null,
    filteredComparisons: (result.rows ?? []).filter(row => row.phase === 'filtered-duplicates').length,
    maximumIdealMeanError: maximum((result.rows ?? []).map(row => row.maxIdealMeanError)),
  } : null;
  return { artifact, experiment: result.experiment ?? null, complete: completed(result), passed: result.passed ?? null, executionPassed: result.executionPassed ?? null,
    failure: result.error ?? null, failedAt: result.failedAt ?? null,
    intendedArithmeticPassed: result.intendedArithmeticPassed ?? null, count: result.count ?? null, sourceSnapshotHash: result.sourceSnapshotHash,
    referenceCases: result.referenceCases ?? null, utilityCount: result.utilityCount ?? null,
    topology: result.shardCounts ? { primaryShards: result.shardCounts.length, documentsPerPrimaryShard: result.shardCounts,
      physicalNodeCount: result.physicalNodes?.length ?? null } : null,
    duplicateFallbacks: result.duplicateFallbacks ?? null, multiplicity,
    expectedExecutions: result.expectedExecutions ?? null, positiveBoundExecutions: result.positiveBoundExecutions ?? null,
    actuallyPrunedExecutions: result.actuallyPrunedExecutions ?? null,
    maximaRangeExecutions: result.maximaRangeExecutions ?? null, additionallyPrunedExecutions: result.additionallyPrunedExecutions ?? null,
    numericOracleFailures: result.numericChecks?.filter(row => row.oraclePassed === false) ?? [],
    duplicateDiagnostics: result.duplicateDiagnostics ?? [],
    fetchDiagnostics: result.diagnostics ?? [],
    methods: [...groups].map(([method, rows]) => ({ method, comparisons: rows.length,
      documentComparisons: sum(rows.map(row => row.count ?? 0)), identicalOrders: rows.filter(row => row.identicalIds || row.identicalFloat32ScoresAndIds || row.exactIdsAndOrder || row.exactIdsAndScores).length,
      identicalNumericScores: rows.filter(row => row.identicalScores || row.float32ScoresIdentical || row.identicalFloat32ScoresAndIds || row.exactFloat32Scores || row.exactIdsAndScores).length,
      identicalTransportScores: rows.filter(row => row.transportScoresIdentical === true || row.rawScoresIdentical === true).length,
      maximumTransportDelta: maximum(rows.map(row => row.maximumTransportDelta)),
      maximumScoreError: maximum(rows.map(row => row.maximumScoreError)), maximumOracleError: maximum(rows.map(row => row.maximumOracleError)),
      maximumTargetQuantizationError: maximum(rows.map(row => row.maximumTargetQuantizationError)),
      minimumTop20Overlap: minimum(rows.map(row => row.top20Overlap)), maximumRankMovement: maximum(rows.map(row => row.maxRankChange)),
      maximumInvertedScoreGap: maximum(rows.map(row => row.largestInversionScoreGap)),
      positiveBoundExecutions: rows.filter(row => row.bounds?.positiveThresholdApplied || row.bounds?.threshold > 0 || row.evidence?.globalBounds?.threshold > 0).length,
      actuallyPrunedExecutions: rows.filter(row => row.bounds?.prunedCount > 0 || row.pruning?.totalPruned > 0).length,
      maximaRangeExecutions: rows.filter(row => row.bounds?.maximaBounds?.addedRanges > 0 || row.evidence?.globalBounds?.maximaBounds?.addedRanges > 0).length,
      additionallyPrunedExecutions: rows.filter(row => row.pruning?.additionallyPruned > 0).length,
      controls: [...new Set(rows.map(row => JSON.stringify(row.parameters ?? {})))].map(text => JSON.parse(text)) })),
    limitations: result.limitations ?? [] };
}

export function summarizeOptimizationFeedback(run, artifact) {
  const accuracyOnly = run.experiment === 'favorite-multiplicity-feedback';
  return { artifact, runId: run.id ?? (run.configuration?.directory ? path.basename(run.configuration.directory) : null),
    createdAt: run.createdAt ?? run.startedAt, label: run.label ?? (accuracyOnly ? 'Duplicate-target correction · accuracy only' : null),
    accuracyOnly, complete: accuracyOnly ? completed(run) : null, passed: run.passed ?? null, limitations: run.limitations ?? [],
    sourceSnapshotHash: run.configuration?.sourceSnapshot?.sha256 ?? run.sourceSnapshotHash ?? null,
    candidates: (run.candidates ?? []).map(candidate => {
      const coverage = accuracyOnly ? { ok: candidate.coverage?.ok ?? 0, unsupported: candidate.coverage?.unsupported ?? 0,
        error: candidate.coverage?.errors ?? null, total: candidate.cases?.length ?? null } : candidate.summary?.coverage;
      const accuracy = candidate.summary?.accuracy ?? candidate.accuracy;
      return { id: candidate.id, method: candidate.configuration?.method ?? candidate.metadata?.id ?? null,
      coverage, agreement: accuracy?.allPairs,
      withoutUncertain: accuracy?.withoutUncertain,
      zeroCaseErrors: coverage?.error === 0,
      eligibilityViolations: accuracy?.eligibilityViolations,
      errors: (candidate.cases ?? []).filter(item => item.status === 'error').map(item => ({ caseId: item.caseId, reason: item.reason })),
      interpretation: 'Query-macro preference-pair agreement; compare case support before comparing methods. Ties receive half credit.' }; }) };
}

function summarizeIndexReceipt(receipt, artifact) {
  const meta = receipt.after?.mapping?.[receipt.index]?.mappings ?? {};
  const settings = receipt.after?.settings?.[receipt.index]?.settings?.index;
  const state = optimizationIndexSummary({ index: receipt.index, count: receipt.count, uuid: receipt.uuid ?? settings?.uuid,
    mapping: meta, stats: receipt.after?.stats });
  return { artifact, complete: completed(receipt), ...state, scope: receipt.configuration?.scope ?? state.scope,
    mode: receipt.configuration?.mode ?? state.mode, encodings: receipt.configuration?.encodings ?? state.encodings,
    utilityCount: receipt.utilities ?? state.utilityCount, sourceEnabled: receipt.configuration?.source ?? state.sourceEnabled,
    ...pick(receipt, ['identityHash', 'planHash', 'indexingMs', 'elapsedMs', 'serializedDocumentBytes', 'bulkBytes', 'encodingValueCounts']),
    indexedCount: receipt.indexed ?? null, requestedCount: receipt.configuration?.count ?? null,
    failure: receipt.error ?? null };
}

async function discover(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discover(file));
    else if (['benchmark.json', 'arrival.json', 'index.json', 'fidelity.json', 'failure.json', 'completion.json', 'feedback.json'].includes(entry.name)
      || /^(?:audit.*|multiplicity-independent-audit.*)\.json$/.test(entry.name)) files.push(file);
  }
  return files;
}

export async function generateOptimizationResults(config) {
  const unfinished = [], performanceAudits = [];
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), root: config.root,
    favoriteUrl: 'http://zerotwo:8227/', optimizationUrl: 'http://zerotwo:8228/',
    performance: [], fidelity: [], feedback: [], indexes: [], completions: [], audits: [], warnings: [],
    interpretation: ['Projection/full scopes and artifact identities are never merged.', 'Missing concurrency or arrival measurements are unmeasured, not passing.',
      'Strict failure means any error or latency at/above1000ms; warmups remain separate and count toward profile viability.',
      'Closed-loop p95 uses successful requests. Arrival p95 includes scheduled delay and failures.',
      'This is a summary of saved artifacts, not a replacement for the independent raw-evidence audit or real-image human feedback.'] };
  for (const filename of await discover(config.root)) {
    let object, bytes;
    try { bytes = await readFile(filename); object = JSON.parse(bytes); } catch (error) { result.warnings.push({ artifact: filename, error: error.message }); continue; }
    // Hash the exact bytes parsed, including when another process is still
    // replacing an unfinished campaign receipt.
    const artifact = { path: filename, sha256: hash(bytes) };
    if (['favorite-optimization-benchmark', 'favorite-optimization-arrival'].includes(object.experiment)) {
      const campaign = summarizeOptimizationPerformance(object, artifact); result.performance.push(campaign);
      if (!campaign.complete && campaign.kind === 'closed-loop') unfinished.push({ campaign, checkpoint: object });
    }
    else if (object.experiment === 'favorite-multiplicity-feedback') result.feedback.push(summarizeOptimizationFeedback(object, artifact));
    else if (['fidelity.json', 'failure.json'].includes(path.basename(filename)) && Array.isArray(object.rows)) result.fidelity.push(summarizeOptimizationFidelity(object, artifact));
    else if (path.basename(filename) === 'index.json' && String(object.experiment).startsWith('strict-hue-favorite-')) result.indexes.push(summarizeIndexReceipt(object, artifact));
    else if (object.experiment === 'strict-hue-favorite-utilities-completion') result.completions.push({ artifact,
      ...pick(object, ['index', 'count', 'uuid', 'completedAt', 'identityHash', 'mappingVerified', 'sampleAudit', 'originalReceipt', 'originalFailurePreserved']),
      indexState: optimizationIndexSummary({ index: object.index, count: object.count, uuid: object.uuid,
        mapping: object.after?.mapping?.[object.index]?.mappings, stats: object.after?.stats }) });
    else if (object.experiment === 'favorite-optimization-audit') {
      performanceAudits.push({ object, artifact });
      result.audits.push({ artifact, ...pick(object, ['directory', 'complete', 'accepted', 'integrityPassed', 'errorCount', 'profileCount', 'failedProfiles', 'totals', 'hashes']) });
    }
    else if (['precision', 'execution', 'fetch-transport', 'maxima-execution'].includes(object.kind) && object.summaryHash && typeof object.integrityPassed === 'boolean') result.audits.push({ artifact,
      ...pick(object, ['kind', 'directory', 'auditedAt', 'integrityPassed', 'experimentPassed', 'sourceSnapshotHash', 'summaryHash', 'auditCodeHash', 'queryPresetCombinations', 'documentScores', 'executions', 'comparisons', 'pairedDiagnostics']) });
    else if (object.kind === 'multishard-execution' && object.summarySha256 && typeof object.passed === 'boolean') result.audits.push({ artifact,
      kind: object.kind, integrityPassed: object.passed, summaryHash: object.summarySha256,
      ...pick(object, ['sourceSnapshotHash', 'documents', 'utilityFields', 'shardCounts', 'physicalNodeCount', 'referenceCases', 'referenceOracleScores', 'executions', 'returnedScores', 'winningScoresRetained', 'limitations']) });
    else if (object.experiment === 'favorite-multiplicity-independent-audit') result.audits.push({ artifact, kind: 'multiplicity',
      ...pick(object, ['auditedAt', 'integrityPassed', 'errors', 'fidelity', 'feedback', 'limitations', 'auditCodeSha256']) });
  }
  for (const { campaign, checkpoint } of unfinished) {
    try {
      campaign.pendingEvidence = await bindPendingEvidence(campaign, checkpoint, performanceAudits);
      campaign.timed = campaign.pendingEvidence.allTimed;
      campaign.warmup = campaign.pendingEvidence.allWarmup;
      campaign.timedCoverage = 'audited-raw-log';
    } catch (error) {
      campaign.pendingEvidence.reason = error.message;
      result.warnings.push({ artifact: campaign.artifact.path, error: 'Pending request evidence unavailable: ' + error.message });
    }
  }
  for (const filename of config.feedback ?? []) {
    if (result.feedback.some(run => run.artifact.path === filename)) continue;
    const bytes = await readFile(filename);
    result.feedback.push(summarizeOptimizationFeedback(JSON.parse(bytes), { path: filename, sha256: hash(bytes) }));
  }
  result.feedback.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = optimizationResultsConfiguration(process.argv.slice(2)), result = await generateOptimizationResults(config);
  if (config.output) {
    await writeFile(config.output, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ output: config.output, performanceCampaigns: result.performance.length, fidelityCampaigns: result.fidelity.length,
      feedbackRuns: result.feedback.length, indexReceipts: result.indexes.length, warnings: result.warnings.length }));
  } else console.log(JSON.stringify(result, null, 2));
}
