// Read-only post-maintenance confirmation of the immutable favorite campaign.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { FAVORITE_SNAPSHOT_ID, loadFavoriteScaleInputs, favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';
import { favoriteScaleCases, favoriteQueryPlans, favoriteSourceSnapshot, favoriteResources, settleFavoriteActivity, remainingFavoriteConcurrencies, summarizeFavoriteTrials, compactFavoriteTrial, createFavoriteRecorder, validateFavoriteStoredFields } from './favorite-scale.mjs';
import { validateFavoriteArrivalArtifact, validateFavoriteArrivalMapping } from './favorite-arrival.mjs';
import { runWorkload } from './rank-features-scale.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { BASE, api, searchIndex, hash } from './service.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
const cpuMs = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);

export function favoriteMaintainedConfiguration(args = []) {
  const options = {};
  for (let cursor = 0; cursor < args.length; cursor++) {
    const key = args[cursor];
    if (!['--artifact', '--directory', '--maintenance-record'].includes(key)) throw Error('Unknown favorite maintained option: ' + key);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing favorite maintained option: ' + key);
    options[key.slice(2)] = value;
  }
  if (!options.artifact || !options.directory) throw Error('Provide --artifact completed-scale.json and --directory new-output-directory.');
  const artifact = path.resolve(options.artifact), directory = path.resolve(options.directory);
  if (path.dirname(artifact) === directory) throw Error('Maintained output requires a separate new directory.');
  return { artifact, directory, ...(options['maintenance-record'] ? { maintenanceRecord: path.resolve(options['maintenance-record']) } : {}), concurrencies: [1, 4, 16], requests: 32, durationMs: 10000, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000 };
}

export function validateFavoriteMaintainedParent({ artifact, inputs, primarySource, currentPrimarySource }) {
  if (artifact.scope !== 'projection' || inputs.scope !== 'projection' || artifact.configuration?.bucketCount != null) throw Error('Maintained confirmation requires the original two-bank million-record projection.');
  validateFavoriteArrivalArtifact(artifact, inputs);
  if (hash(primarySource) !== artifact.sourceSnapshotHash || hash(currentPrimarySource) !== artifact.sourceSnapshotHash
    || !same(Object.fromEntries(Object.entries(primarySource).map(([name, source]) => [name, hash(source)])), artifact.identity.sourceHashes)) throw Error('Favorite primary recursive source snapshot differs.');
  if (!same(favoriteQueryPlans(artifact.workload, inputs.fields), artifact.queryPlans)) throw Error('Favorite primary query plans differ.');
  return true;
}

export function favoriteMaintainedCases(artifact) {
  const cases = favoriteScaleCases(artifact.configuration).filter(item => item.selectivity === 'all');
  if (cases.length !== 8 || cases.some(item => item.filter)) throw Error('Expected exactly eight unfiltered favorite cases.');
  return cases.map(item => {
    const groups = artifact.warmups.filter(group => group.count === 1000000 && group.caseId === item.id);
    const references = [];
    for (const group of groups) for (const row of group.trials) {
      if (row.error) continue;
      if (row.caseId !== item.id || row.phase !== 'warmup' || row.method !== item.method || !same(row.parameters, item.parameters)
        || row.hitCount !== 20 || !/^[a-f0-9]{64}$/.test(row.hitsHash ?? '') || !Number.isFinite(row.elapsedMs)) throw Error('Original warmup reference provenance differs: ' + item.id);
      references.push({ warmupId: group.id, hitsHash: row.hitsHash, elapsedMs: row.elapsedMs });
    }
    if (new Set(references.map(reference => reference.hitsHash)).size > 1) throw Error('Original successful warmups have inconsistent result hashes: ' + item.id);
    const reference = references.length ? { available: true, hitsHash: references[0].hitsHash, warmupIds: [...new Set(references.map(row => row.warmupId))], observations: references }
      : { available: false, reason: 'No successful original million-record warmup response is available for score parity.' };
    return { ...item, reference };
  });
}

export function checkFavoriteMaintainedParity(hits, reference) {
  if (hits.length !== 20) throw Error('Maintained query returned an incomplete global top20.');
  for (let i = 1; i < hits.length; i++) if (hits[i].score > hits[i - 1].score || (hits[i].score === hits[i - 1].score && hits[i].id < hits[i - 1].id)) throw Error('Maintained global hits are not ordered by score then ID.');
  const hitsHash = hash(hits);
  if (reference.available && hitsHash !== reference.hitsHash) {
    const error = Error('Original warmup top20 score parity failed after maintenance.'); error.code = 'FAVORITE_PARITY'; throw error;
  }
  return { available: reference.available, matches: reference.available ? true : null, hitsHash };
}

async function inspectRetainedIndex(artifact, inputs) {
  const mapping = (await api(artifact.index + '/_mapping')).body[artifact.index]?.mappings;
  const settings = (await api(artifact.index + '/_settings')).body[artifact.index]?.settings?.index;
  const count = (await api(artifact.index + '/_count')).body.count;
  validateFavoriteArrivalMapping({ artifact, inputs, mapping, settings, count });
  const ordinals = [0, 499999, 999999], expected = ordinals.map(index => favoriteSyntheticDocument(inputs.documents, index, { seed: artifact.configuration.seed, coverageFields: inputs.coverageFields }));
  const fields = Object.keys(expected[0]), observed = new Map(expected.map(document => [document.id, {}]));
  for (let offset = 0; offset < fields.length; offset += 100) {
    const body = (await api(artifact.index + '/_search?request_cache=false', { method: 'POST', body: { size: expected.length, _source: false,
      query: { ids: { values: expected.map(document => document.id) } }, docvalue_fields: fields.slice(offset, offset + 100) } })).body;
    if (body.timed_out || body._shards?.failed || body.hits?.hits?.length !== expected.length) throw Error('Maintained sample audit returned incomplete results.');
    for (const hit of body.hits.hits) {
      if (!observed.has(hit._id)) throw Error('Unexpected maintained sample ID.');
      Object.assign(observed.get(hit._id), hit.fields);
    }
  }
  for (const document of expected) validateFavoriteStoredFields(document, observed.get(document.id));
  return { count, uuid: settings.uuid, mappingHash: hash(canonical(mapping)), sampleValuesHash: hash(expected), verifiedOrdinals: ordinals, at: new Date().toISOString() };
}

async function retainedLayout(index) {
  // Both endpoints are read-only. No refresh/flush/merge operation belongs in
  // this runner: maintenance must finish before the independent confirmation.
  const stats = (await api(index + '/_stats/store,docs,segments,merge')).body;
  const segments = (await api(index + '/_segments')).body;
  return { at: new Date().toISOString(), stats: stats._all, segments };
}

export async function runFavoriteMaintained(config) {
  const args = ['--artifact', config.artifact, '--directory', config.directory, ...(config.maintenanceRecord ? ['--maintenance-record', config.maintenanceRecord] : [])];
  if (!same(config, favoriteMaintainedConfiguration(args))) throw Error('Maintained confirmation controls are fixed by the bounded protocol.');
  if (new URL(BASE).port !== '19217') throw Error('Maintained confirmation requires isolated OpenSearch port19217.');
  const primaryBytes = await readFile(config.artifact), artifact = JSON.parse(primaryBytes);
  const inputs = await loadFavoriteScaleInputs({ scope: 'projection' });
  const primarySource = JSON.parse(await readFile(artifact.sourceFile)), currentPrimarySource = await favoriteSourceSnapshot();
  validateFavoriteMaintainedParent({ artifact, inputs, primarySource, currentPrimarySource });
  const cases = favoriteMaintainedCases(artifact), queryPlans = favoriteQueryPlans(cases, inputs.fields), sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const maintenanceBytes = config.maintenanceRecord ? await readFile(config.maintenanceRecord) : null;
  const maintenance = maintenanceBytes ? { path: config.maintenanceRecord, sha256: hash(maintenanceBytes), record: JSON.parse(maintenanceBytes) } : { supplied: false, note: 'No separate maintenance receipt supplied; live before/after layout is recorded.' };
  const plan = { experiment: 'strict-hue-favorite-maintained', snapshotId: FAVORITE_SNAPSHOT_ID, primaryArtifact: config.artifact, primaryArtifactHash: hash(primaryBytes), primaryIdentityHash: artifact.identityHash,
    index: artifact.index, scope: 'projection', count: 1000000, configuration: config, sourceSnapshotHash: hash(sourceSnapshot), workload: cases, queryPlans, maintenance };
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'primary-scale.json'), primaryBytes, { flag: 'wx' });
  const result = { ...plan, planHash: hash(plan), startedAt: new Date().toISOString(), profiles: [], warmups: [], skipped: [], settling: [],
    latencyBoundary: 'Compile query through complete decoded OpenSearch response, top20 global ranking; successful-only timed percentiles. Any error or >=1000ms including the case warmup fails the block.',
    limitations: [
      'This separate confirmation preserves the original campaign and its failures. Maintenance changes physical segment/search layout, not scoring inputs or query settings.',
      'Seventy selected numeric fields are a workload projection shared by both banks, not a full-schema million-wallpaper capacity result.',
      'Mixtures of523real measurements are not one million independent photographs. Repeated queries/warmups favor warm caches; request_cache=false leaves filter and OS caches uncontrolled.',
      'Single shared host/node, one shard, no replicas. Short closed-loop blocks do not establish sustained arrival capacity.',
      'Score parity is checked against every available successful original case warmup hash; a missing original successful response is explicitly marked, not inferred.',
      'Resource observations are sampled at one second; CPU counters may be cached, heap/RSS peaks may be missed.',
    ] };
  const save = () => atomicJson(path.join(config.directory, 'maintained.json'), result), recorder = createFavoriteRecorder(config.directory);
  const settle = async context => {
    const observation = await settleFavoriteActivity(); result.settling.push({ ...context, ...observation }); await save();
    if (!observation.settled) throw Error('Search activity or merges failed to settle; maintained confirmation stopped.');
  };
  const trial = async (item, phase, concurrency, ordinal, context) => {
    const started = performance.now(); let observed;
    try {
      const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, limit: 20 }); body.timeout = '950ms';
      const response = await searchIndex(artifact.index, body, { timeoutMs: 1500 }), elapsedMs = performance.now() - started;
      const parity = checkFavoriteMaintainedParity(response.hits, item.reference);
      observed = { elapsedMs, serviceTookMs: response.evidence.serviceTookMs, hitCount: response.hits.length, hitsHash: parity.hitsHash, scoreParity: parity.available ? 'match' : 'unavailable', ...(phase === 'warmup' ? { hits: response.hits } : {}) };
    } catch (error) { observed = { elapsedMs: performance.now() - started, error: error.message, hitCount: 0, ...(error.code === 'FAVORITE_PARITY' ? { parityMismatch: true } : {}) }; }
    const row = { caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: 'all', method: item.method, parameters: item.parameters, count: 1000000, phase, concurrency, ordinal, ...context, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    row.requestId = `${context.profileId ?? context.warmupId}:${phase}:${ordinal}`;
    await recorder.record('requests.jsonl', row);
    return { ...compactFavoriteTrial(row), ...(row.parityMismatch ? { parityMismatch: true } : {}) };
  };
  console.log('FAVORITE_MAINTAINED_ARTIFACT ' + path.join(config.directory, 'maintained.json')); await save();
  try {
    await settle({ phase: 'before-index-audit' });
    result.indexBefore = await inspectRetainedIndex(artifact, inputs); result.layoutBefore = await retainedLayout(artifact.index);
    result.engineVersion = (await api('')).body.version; result.nodeVersion = process.version;
    result.nodeConfiguration = (await api('_nodes/os,jvm,process,thread_pool?filter_path=nodes.*.name,nodes.*.os,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process,nodes.*.thread_pool.search')).body;
    await save();
    for (const item of cases) {
      await settle({ caseId: item.id, phase: 'before-warmup' });
      const warmupId = `${item.id}:warmup`, warmups = [await trial(item, 'warmup', 1, 0, { warmupId })];
      result.warmups.push({ id: warmupId, count: 1000000, caseId: item.id, trials: warmups }); await recorder.flush(); await save();
      if (warmups.some(row => row.parityMismatch)) throw Error('Original score parity failed in warmup; refusing further timing.');
      const allowed = remainingFavoriteConcurrencies({ requested: config.concurrencies, profiles: [], warmups });
      for (const concurrency of allowed) {
        await settle({ caseId: item.id, concurrency, phase: 'before-profile' });
        const profileId = `${item.id}:c${concurrency}`, layoutBefore = await retainedLayout(artifact.index), before = await favoriteResources(), samples = [before];
        let pendingSample = Promise.resolve(), sampling = false, stopped = false;
        const timer = setInterval(() => {
          if (sampling || stopped) return; sampling = true;
          pendingSample = favoriteResources().then(async sample => { samples.push(sample); await recorder.record('resources.jsonl', { profileId, ...sample }); })
            .catch(async error => { const sample = { at: new Date().toISOString(), error: error.message }; samples.push(sample); await recorder.record('resources.jsonl', { profileId, ...sample }); }).finally(() => { sampling = false; });
        }, 1000);
        let measurement;
        try { measurement = await runWorkload({ items: [item], concurrency, repetitions: 32, durationMs: 10000, trial: (_, ordinal) => trial(item, 'timed', concurrency, ordinal, { profileId, warmupId }) }); }
        finally { stopped = true; clearInterval(timer); await pendingSample; }
        const after = await favoriteResources(); samples.push(after);
        const profile = { id: profileId, warmupId, warmupIds: [warmupId], caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: 'all', method: item.method, parameters: item.parameters, index: artifact.index, count: 1000000, scope: 'projection', concurrency, effectiveConcurrency: concurrency,
          minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: measurement.elapsedMs, measurement: 'closed-loop-post-maintenance-favorite', ...summarizeFavoriteTrials(measurement.trials, warmups), throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000),
          cpuMs: cpuMs(after) - cpuMs(before), clientCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000,
          peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedClientRssBytes: Math.max(...samples.map(sample => sample.clientMemory?.rss ?? 0)), resourceSampleCount: samples.length, resourceErrors: samples.filter(sample => sample.error).length,
          reference: item.reference, layoutBefore, before, after, trials: measurement.trials };
        result.profiles.push(profile); await recorder.flush(); result.recording = recorder.observation(); await save();
        console.log(JSON.stringify({ ...profile, layoutBefore: undefined, before: undefined, after: undefined, trials: undefined }));
        await settle({ caseId: item.id, profileId, phase: 'after-profile' }); profile.layoutAfter = await retainedLayout(artifact.index); await save();
        if (measurement.trials.some(row => row.parityMismatch)) throw Error('Original score parity changed during timing; campaign stopped after draining requests.');
        if (!profile.viableAtTestedLoad) break;
      }
      const completed = result.profiles.filter(profile => profile.caseId === item.id).map(profile => profile.concurrency);
      const omitted = config.concurrencies.filter(concurrency => !completed.includes(concurrency));
      if (omitted.length) { result.skipped.push({ caseId: item.id, concurrencies: omitted, warmupId, reason: 'Case failed strict viability, including its warmup; higher load omitted.' }); await save(); }
    }
    await settle({ phase: 'after-campaign' }); result.indexAfter = await inspectRetainedIndex(artifact, inputs); result.layoutAfter = await retainedLayout(artifact.index);
    if (result.indexBefore.uuid !== result.indexAfter.uuid || result.indexBefore.mappingHash !== result.indexAfter.mappingHash || result.indexBefore.sampleValuesHash !== result.indexAfter.sampleValuesHash) throw Error('Retained favorite index changed during maintained confirmation.');
    if (hash(await readFile(config.artifact)) !== hash(primaryBytes)) throw Error('Primary campaign artifact changed during confirmation.');
    if (hash(await favoriteSourceSnapshot(import.meta.url)) !== hash(sourceSnapshot)) throw Error('Maintained confirmation source changed during measurement.');
    result.recording = recorder.observation(); await recorder.close(); result.finishedAt = new Date().toISOString(); await save();
    return { directory: config.directory, result };
  } catch (error) {
    try { await recorder.close(); } catch (recordingError) { result.recordingError = recordingError.message; }
    result.recording = recorder.observation(); result.interruption = { at: new Date().toISOString(), error: error.stack ?? String(error) }; await save(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFavoriteMaintained(favoriteMaintainedConfiguration(process.argv.slice(2)));
