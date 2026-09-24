// Offline evidence audit. No OpenSearch calls, ranking, or imports from the
// benchmark/scorer implementation. Request evidence is read one JSONL row at a
// time; only the checkpoint's compact trials and small counters remain in RAM.
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const failed = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs >= 1000;
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const percentile = (values, portion) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * portion) - 1)] : null;
const compact = row => row.phase === 'warmup' ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'hits'))
  : Object.fromEntries(['ordinal', 'elapsedMs', 'serviceTookMs', 'hitCount', 'overOneSecond', 'error'].filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const countRows = rows => ({ requests: rows.length, errors: rows.filter(row => Boolean(row.error)).length,
  overOneSecond: rows.filter(row => row.elapsedMs >= 1000).length, strictFailures: rows.filter(failed).length });

export function independentlySummarizeFavoriteOptimization(trials, warmups, elapsedMs) {
  const timed = countRows(trials), warm = countRows(warmups), successful = trials.filter(row => !row.error).map(row => row.elapsedMs);
  const timedRequestsViable = timed.requests > 0 && timed.strictFailures === 0;
  return { requests: timed.requests, errors: timed.errors, overOneSecond: timed.overOneSecond,
    warmupErrors: warm.errors, warmupOverOneSecond: warm.overOneSecond,
    strictTimedFailures: timed.strictFailures, strictWarmupFailures: warm.strictFailures, strictFailures: timed.strictFailures + warm.strictFailures,
    timedRequestsViable, viableAtTestedLoad: timedRequestsViable && warm.requests > 0 && warm.strictFailures === 0,
    p50Ms: percentile(successful, .5), p95Ms: percentile(successful, .95), p99Ms: percentile(successful, .99),
    maxMs: trials.length ? trials.reduce((maximum, trial) => Math.max(maximum, trial.elapsedMs), 0) : null,
    throughputPerSecond: trials.length / (elapsedMs / 1000), successfulThroughputPerSecond: successful.length / (elapsedMs / 1000) };
}

/** A valid completed audit can contain performance failures. `accepted` means
 * the evidence is complete and internally consistent, not that it is fast. */
export async function auditFavoriteOptimization(directory, { checkCurrentSources = false } = {}) {
  directory = path.resolve(directory);
  const [plan, result, sources] = await Promise.all(['plan.json', 'benchmark.json', 'source-snapshot.json'].map(name => readJson(path.join(directory, name))));
  const errors = [], warnings = []; let errorCount = 0;
  const problem = text => { errorCount++; if (errors.length < 200) errors.push(text); };
  const assert = (condition, text) => { if (!condition) problem(text); };
  const completedMarker = typeof result.finishedAt === 'string' && Number.isFinite(Date.parse(result.finishedAt)) && !result.interruption;
  const config = plan.configuration ?? {}, cases = new Map((plan.cases ?? []).map(item => [item.id, item]));
  assert(plan.schemaVersion === 1 && plan.experiment === 'favorite-optimization-benchmark', 'Unexpected optimization plan schema or experiment.');
  assert(hash(plan) === result.planHash, 'planHash differs from recorded plan.json.');
  for (const [key, value] of Object.entries(plan)) assert(same(value, result[key]), 'Checkpoint differs from plan field ' + key + '.');
  assert(hash(sources) === plan.sourceSnapshotHash, 'Archived sourceSnapshotHash differs.');
  assert(same(Object.keys(sources).sort(), Object.keys(plan.sourceHashes ?? {}).sort()), 'Archived source file inventory differs.');
  for (const [filename, source] of Object.entries(sources)) {
    assert(typeof source === 'string' && hash(source) === plan.sourceHashes?.[filename], 'Archived source hash differs: ' + filename);
    if (checkCurrentSources) {
      const root = fileURLToPath(new URL('../', import.meta.url)), current = path.resolve(root, filename);
      if (!current.startsWith(root)) { problem('Unsafe archived source path: ' + filename); continue; }
      try { assert(hash(await readFile(current)) === hash(source), 'Current source differs from archive: ' + filename); }
      catch (error) { problem('Current source cannot be read: ' + filename + ': ' + error.message); }
    }
  }
  assert(cases.size === plan.cases?.length && cases.size > 0, 'Missing or duplicate planned cases.');
  const plans = new Map((plan.queryPlans ?? []).map(item => [item.caseId, item]));
  assert(plans.size === cases.size && plans.size === plan.queryPlans?.length, 'Query-plan inventory differs from cases.');
  for (const [id, item] of cases) {
    const query = plans.get(id);
    assert(query && query.bodyHash === hash(query.body), 'Query bodyHash differs: ' + id);
    assert(query?.candidateId === item.candidateId && query?.index === item.index, 'Query-plan routing differs: ' + id);
    assert(query?.body?.size === 20 && query?.body?.timeout === '950ms' && !query?.body?.profile, 'Timed query must be unprofiled top20 with 950ms service timeout: ' + id);
  }
  assert(config.requests === 32 && config.durationMs === 10000, 'Plan must require 32 requests AND 10000ms.');
  assert(Array.isArray(config.concurrencies) && config.concurrencies[0] === 1 && config.concurrencies.every((n, i, all) => [1, 4, 16].includes(n) && (!i || n > all[i - 1])), 'Invalid planned concurrency sequence.');
  assert([100000, 1000000].includes(config.count), 'Unexpected planned corpus size.');

  const before = new Map((result.indexBefore ?? []).map(state => [state.index, state])), after = new Map((result.indexAfter ?? []).map(state => [state.index, state]));
  const wantedIndexes = [...new Set((plan.candidates ?? []).map(candidate => candidate.index))].sort();
  assert(same([...before.keys()].sort(), wantedIndexes), 'Initial index inventory differs from candidates.');
  const validateState = (state, label) => {
    assert(state.count === config.count && Boolean(state.uuid), label + ' index count or UUID differs.');
    assert(state.mappingHash === hash(canonical(state.mapping)), label + ' mappingHash differs.');
    assert(state.metadataHash === hash(canonical(state.mapping?._meta ?? {})), label + ' metadataHash differs.');
    assert(Number.isSafeInteger(state.indexing?.index_total) && Number.isSafeInteger(state.indexing?.delete_total), label + ' indexing counters missing.');
  };
  for (const [index, state] of before) {
    validateState(state, index + ' before');
    const fingerprint = (plan.indexFingerprints ?? []).find(item => item.index === index);
    assert(Boolean(fingerprint), 'Missing index fingerprint: ' + index);
    if (fingerprint) for (const key of ['index', 'count', 'uuid', 'mappingHash', 'metadataHash', 'indexing']) assert(same(state[key], fingerprint[key]), 'Initial index fingerprint differs: ' + index + '/' + key);
  }
  if (completedMarker) assert(same([...after.keys()].sort(), wantedIndexes), 'Completed campaign has incomplete final index evidence.');
  for (const [index, state] of after) {
    validateState(state, index + ' after');
    for (const key of ['count', 'uuid', 'mappingHash', 'metadataHash', 'indexing']) assert(same(state[key], before.get(index)?.[key]), 'Index changed during measurement: ' + index + '/' + key);
  }

  const profiles = new Map(), seenOrdinals = new Map(), warmups = new Map(), seenWarmups = new Set();
  for (const item of result.warmups ?? []) {
    assert(cases.has(item.caseId) && !warmups.has(item.caseId), 'Unknown or duplicate warmup group: ' + item.caseId);
    assert(item.trials?.length === 1, 'Require one explicit warmup per case: ' + item.caseId);
    warmups.set(item.caseId, item.trials ?? []);
  }
  for (const profile of result.profiles ?? []) {
    assert(!profiles.has(profile.id) && cases.has(profile.caseId), 'Unknown or duplicate completed profile: ' + profile.id);
    profiles.set(profile.id, profile); seenOrdinals.set(profile.id, new Uint8Array(profile.trials?.length ?? 0));
    const item = cases.get(profile.caseId);
    for (const key of ['candidateId', 'method', 'index', 'parameters', 'queryId', 'selectivity']) assert(same(profile[key], item?.[key]), 'Profile routing differs: ' + profile.id + '/' + key);
    assert(profile.count === config.count && config.concurrencies?.includes(profile.concurrency), 'Profile count or concurrency differs: ' + profile.id);
    assert(profile.minimumRequests === 32 && profile.trials?.length >= 32, 'Profile minimumRequests/actual request count below 32: ' + profile.id);
    assert(profile.requestedDurationMs === 10000 && Number.isFinite(profile.elapsedMs) && profile.elapsedMs >= 10000, 'Profile duration below required 10000ms: ' + profile.id);
    assert(Array.isArray(profile.trials) && profile.trials.every((row, ordinal) => row.ordinal === ordinal && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0), 'Invalid compact trial latency or ordinals: ' + profile.id);
    const recomputed = independentlySummarizeFavoriteOptimization(profile.trials ?? [], warmups.get(profile.caseId) ?? [], profile.elapsedMs);
    if (profile.finalResourceCollectionComplete === false) {
      assert(!completedMarker && Boolean(result.interruption) && profile.measurementComplete === true
        && profile.after === null && profile.cpuMs === null && profile.clientCpuMs === null
        && typeof profile.resourceCollectionError?.error === 'string' && profile.resourceErrors >= 1,
      'Incomplete final resource evidence cannot qualify or invent CPU deltas: ' + profile.id);
      recomputed.viableAtTestedLoad = false;
    }
    for (const [key, value] of Object.entries(recomputed)) assert(same(profile[key], value), 'Profile summary differs: ' + profile.id + '/' + key);
  }
  const totals = { timedRequests: 0, warmupRequests: 0, timedErrors: 0, timedOverOneSecond: 0, timedStrictFailures: 0, warmupErrors: 0, warmupOverOneSecond: 0, warmupStrictFailures: 0 };
  const pending = new Map(), hitHashes = new Map(); let rawRequestRows = 0, rawResourceRows = 0, pendingTimedRows = 0, pendingWarmupRows = 0;
  const noteHitHash = row => {
    if (row.error) return;
    assert(typeof row.hitsHash === 'string' && /^[a-f0-9]{64}$/.test(row.hitsHash), 'Missing successful hitsHash: ' + row.requestId);
    if (!hitHashes.has(row.caseId)) hitHashes.set(row.caseId, new Set());
    hitHashes.get(row.caseId).add(row.hitsHash);
    if (row.hits) {
      assert(hash(row.hits) === row.hitsHash, 'Warmup hitsHash differs: ' + row.requestId);
      assert(row.hits.length === row.hitCount && new Set(row.hits.map(hit => hit.id)).size === row.hitCount, 'Warmup hit count/identity differs: ' + row.requestId);
      assert(row.hits.every((hit, i, all) => typeof hit.id === 'string' && Number.isFinite(hit.score) && hit.score >= 0 && (!i || hit.score <= all[i - 1].score)), 'Warmup scores invalid or unordered: ' + row.requestId);
    }
    assert(row.hitCount === 20, 'Successful request lacks global top20: ' + row.requestId);
  };
  async function lines(filename, visit, optional = false) {
    let bytes;
    try { bytes = (await stat(filename)).size; } catch (error) { if (optional && error.code === 'ENOENT') return 0; throw error; }
    let ordinal = 0;
    for await (const line of createInterface({ input: createReadStream(filename), crlfDelay: Infinity })) {
      ordinal++;
      try { if (!line.trim()) throw Error('Blank JSONL row'); await visit(JSON.parse(line), ordinal); }
      catch (error) { problem(path.basename(filename) + ' row ' + ordinal + ': ' + error.message); }
    }
    return bytes;
  }
  const requestBytes = await lines(path.join(directory, 'requests.jsonl'), row => {
    rawRequestRows++;
    const item = cases.get(row.caseId);
    assert(Boolean(item), 'Unknown request case: ' + row.caseId);
    for (const key of ['candidateId', 'method', 'index', 'parameters', 'queryId', 'selectivity']) assert(same(row[key], item?.[key]), 'Raw request routing differs: ' + row.requestId + '/' + key);
    assert(row.count === config.count && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0, 'Invalid raw request count or latency: ' + row.requestId);
    assert(row.overOneSecond === (row.elapsedMs >= 1000), 'Raw overOneSecond flag differs: ' + row.requestId);
    assert(row.requestId === row.profileId + ':' + row.ordinal, 'Raw request identity differs: ' + row.requestId);
    assert(Number.isSafeInteger(row.ordinal) && row.ordinal >= 0, 'Invalid raw ordinal: ' + row.requestId);
    noteHitHash(row);
    if (!['timed', 'warmup'].includes(row.phase)) { problem('Unknown raw request phase: ' + row.requestId); return; }
    const prefix = row.phase === 'timed' ? 'timed' : 'warmup';
    totals[prefix + 'Requests']++; totals[prefix + 'Errors'] += Number(Boolean(row.error));
    totals[prefix + 'OverOneSecond'] += Number(row.elapsedMs >= 1000); totals[prefix + 'StrictFailures'] += Number(failed(row));
    if (row.phase === 'warmup') {
      assert(row.profileId === row.caseId + ':warmup' && row.concurrency === 1 && row.ordinal === 0, 'Warmup identity/concurrency differs: ' + row.requestId);
      assert(!seenWarmups.has(row.requestId), 'Raw duplicate warmup: ' + row.requestId); seenWarmups.add(row.requestId);
      const expected = warmups.get(row.caseId)?.[row.ordinal];
      if (expected) assert(same(compact(row), expected), 'Raw warmup/checkpoint parity differs: ' + row.requestId);
      else { pendingWarmupRows++; if (completedMarker) problem('Raw warmup absent from completed checkpoint: ' + row.requestId); }
    } else {
      assert(row.profileId === config.count + ':' + row.caseId + ':c' + row.concurrency, 'Timed profile identity differs: ' + row.requestId);
      const profile = profiles.get(row.profileId), seen = seenOrdinals.get(row.profileId);
      if (profile) {
        assert(row.concurrency === profile.concurrency, 'Raw concurrency differs: ' + row.requestId);
        assert(row.ordinal < seen.length && !seen[row.ordinal], 'Raw duplicate or out-of-range ordinal: ' + row.requestId);
        if (row.ordinal < seen.length) seen[row.ordinal] = 1;
        assert(same(compact(row), profile.trials[row.ordinal]), 'Raw timed/checkpoint parity differs: ' + row.requestId);
      } else {
        pendingTimedRows++;
        if (!pending.has(row.profileId)) pending.set(row.profileId, new Set());
        assert(!pending.get(row.profileId).has(row.ordinal), 'Raw duplicate pending ordinal: ' + row.requestId); pending.get(row.profileId).add(row.ordinal);
        if (completedMarker) problem('Raw timed profile absent from completed checkpoint: ' + row.profileId);
      }
    }
  });
  const resourceBytes = await lines(path.join(directory, 'resources.jsonl'), row => {
    rawResourceRows++;
    assert(typeof row.profileId === 'string', 'Raw resource row lacks profile identity.');
    if (completedMarker) assert(profiles.has(row.profileId), 'Raw resource profile absent from completed checkpoint: ' + row.profileId);
  }, true);
  for (const [id, seen] of seenOrdinals) assert(seen.every(value => value === 1), 'Checkpoint compact trials absent from raw requests: ' + id);
  for (const [id, rows] of warmups) for (const row of rows) assert(seenWarmups.has(row.requestId), 'Checkpoint warmup absent from raw requests: ' + id);
  for (const [id, hashes] of hitHashes) assert(hashes.size === 1, 'Repeated successful query changed hit/score hash: ' + id);
  if (completedMarker) {
    assert(result.recording?.totalRows === rawRequestRows + rawResourceRows, 'recording.totalRows differs from raw files.');
    assert(result.recording?.totalBytes === requestBytes + resourceBytes, 'recording.totalBytes differs from raw file bytes.');
  }

  for (const [id] of cases) {
    const completed = [...profiles.values()].filter(profile => profile.caseId === id).sort((a, b) => a.concurrency - b.concurrency);
    const omitted = (result.skipped ?? []).filter(item => item.caseId === id).flatMap(item => item.concurrencies);
    const failures = completed.filter(profile => !profile.viableAtTestedLoad);
    if (completedMarker) assert(warmups.has(id), 'Completed campaign has unaccounted warmup: ' + id);
    for (const concurrency of config.concurrencies ?? []) {
      const measured = completed.filter(profile => profile.concurrency === concurrency), skipped = omitted.filter(value => value === concurrency);
      assert(measured.length <= 1 && skipped.length <= 1 && !(measured.length && skipped.length), 'Duplicate measured/skipped concurrency: ' + id + '/c' + concurrency);
      if (completedMarker) assert(measured.length + skipped.length === 1, 'Completed campaign has unaccounted concurrency: ' + id + '/c' + concurrency);
      if (skipped.length) assert(failures.some(profile => profile.concurrency < concurrency), 'Skipped concurrency lacks lower-load failure: ' + id + '/c' + concurrency);
      if (measured.length) assert(!failures.some(profile => profile.concurrency < concurrency), 'Higher load measured after strict failure: ' + id + '/c' + concurrency);
    }
    assert(omitted.every(value => config.concurrencies?.includes(value)), 'Skipped unplanned concurrency: ' + id);
  }
  for (const item of result.skipped ?? []) assert(cases.has(item.caseId), 'Skipped unknown case: ' + item.caseId);
  if (completedMarker) assert((result.settling ?? []).every(observation => observation.settled), 'Completed campaign contains unsettled service activity.');
  const instrumentationRoots = [];
  for (const observation of result.instrumentation ?? []) {
    assert(observation.excludedFromTiming === true && observation.excludedFromViability === true, 'Instrumentation must be excluded from latency and viability.');
    const query = plans.get(observation.caseId);
    assert(query && query.index === observation.index && query.candidateId === observation.candidateId, 'Instrumentation routing differs: ' + observation.caseId);
    assert(observation.serverTimeoutMs === config.instrumentationServiceTimeoutMs && observation.clientTimeoutMs === config.instrumentationClientTimeoutMs, 'Instrumentation timeouts differ: ' + observation.caseId);
    if (query) assert(hash({ ...query.body, timeout: observation.serverTimeoutMs + 'ms', profile: true }) === observation.bodyHash, 'Instrumentation bodyHash differs: ' + observation.caseId);
    if (!observation.error) {
      assert(observation.partial === Boolean(observation.body?.timed_out || observation.body?._shards?.failed), 'Instrumentation partial-response marker differs: ' + observation.caseId);
      const expectedNodes = [], expectedCollectors = [];
      for (const shard of observation.body?.profile?.shards ?? []) for (const [search, entry] of (shard.searches ?? []).entries()) {
        const collect = (nodes, trail) => {
          for (const [ordinal, node] of (nodes ?? []).entries()) {
            const queryPath = [...trail, ordinal], counts = Object.fromEntries(Object.entries(node.breakdown ?? {}).filter(([key]) => key.endsWith('_count')));
            expectedNodes.push({ shard: shard.id, search, queryPath, type: node.type, description: node.description, timeInNanos: node.time_in_nanos, counts, breakdown: node.breakdown ?? {} });
            if (!trail.length) instrumentationRoots.push({ caseId: observation.caseId, shard: shard.id, search, type: node.type, partial: observation.partial, counts });
            collect(node.children, queryPath);
          }
        };
        collect(entry.query, []);
        expectedCollectors.push(...(entry.collector ?? []).map(collector => ({ shard: shard.id, search, ...collector })));
      }
      assert(same(expectedNodes, observation.summary?.queryNodes), 'Raw instrumentation query counters differ from summary: ' + observation.caseId);
      assert(same(expectedCollectors, observation.summary?.collectors), 'Raw instrumentation collectors differ from summary: ' + observation.caseId);
    }
  }
  if (!completedMarker) warnings.push('Campaign is incomplete. Completed profiles may be audited individually; pending raw rows and stale recorder totals are retained without being called final.');
  if (!checkCurrentSources) warnings.push('Archived source hashes verified. Current worktree source is intentionally not required to remain unchanged after a completed campaign.');
  return { schemaVersion: 1, experiment: 'favorite-optimization-audit', directory, auditedAt: new Date().toISOString(), complete: completedMarker,
    integrityPassed: errorCount === 0, accepted: completedMarker && errorCount === 0, errorCount, errors, warnings,
    profileCount: profiles.size, failedProfiles: [...profiles.values()].filter(profile => !profile.viableAtTestedLoad).length,
    incompleteResourceProfiles: [...profiles.values()].filter(profile => profile.finalResourceCollectionComplete === false).length,
    rawRequestRows, rawResourceRows, pendingTimedRows, pendingWarmupRows, totals, instrumentationRoots,
    hashes: { plan: hash(plan), benchmark: hash(result), archivedSources: hash(sources) },
    limitations: ['Offline internal-consistency audit; no re-execution of queries or independent proof of extraction/index contents.',
      'Latency percentiles use successful requests. Strict failures are the union of errors and requests at or above one second, including warmups.',
      'Global ranking correctness and cross-method score fidelity require the separate real-corpus fidelity audit.'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (['--allow-incomplete', '--check-current-sources'].includes(arg)) values[arg.slice(2)] = true;
    else if (['--directory', '--output'].includes(arg) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) values[arg.slice(2)] = process.argv[++i];
    else throw Error('Unknown or missing audit option: ' + arg);
  }
  if (!values.directory) throw Error('Provide --directory containing archived benchmark artifacts.');
  const result = await auditFavoriteOptimization(values.directory, { checkCurrentSources: values['check-current-sources'] ?? false });
  if (values.output) await writeFile(path.resolve(values.output), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
  if (!result.integrityPassed) process.exitCode = 1;
  else if (!result.complete && !values['allow-incomplete']) process.exitCode = 2;
}
