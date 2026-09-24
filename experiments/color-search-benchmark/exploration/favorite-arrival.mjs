// Bounded scheduled-arrival follow-up. Existing favorite indexes are read-only.
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runArrivals, summarizeArrivals } from './arrival-scheduler.mjs';
import { FAVORITE_VARIANTS, FAVORITE_WORKLOAD, FAVORITE_INDEX_PREFIX, FAVORITE_SNAPSHOT_ID, loadFavoriteScaleInputs, favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';
import { favoriteScaleCases, favoriteQueryPlans, settleFavoriteActivity, favoriteResources, favoriteSourceSnapshot } from './favorite-scale.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { BASE, api, searchIndex, safeIndexName, hash } from './service.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
const failed = row => Boolean(row.error) || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs >= 1000;
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
const cpuMs = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);
const rssBytes = sample => {
  const values = Object.values(sample.nodes ?? {}).map(node => node.process?.mem?.resident_in_bytes).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};
const observedMaximum = values => { const available = values.filter(Number.isFinite); return available.length ? Math.max(...available) : null; };

export function favoriteArrivalConfiguration(args = []) {
  const options = {};
  for (let cursor = 0; cursor < args.length; cursor++) {
    const key = args[cursor];
    if (!['--artifact', '--directory'].includes(key)) throw Error('Unknown favorite arrival option: ' + key);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing favorite arrival option: ' + key);
    options[key.slice(2)] = value;
  }
  if (!options.artifact || !options.directory) throw Error('Provide --artifact completed-scale.json and --directory new-output-directory.');
  const artifact = path.resolve(options.artifact), directory = path.resolve(options.directory);
  if (path.dirname(artifact) === directory) throw Error('Arrival output must use a separate new directory.');
  return { artifact, directory, rates: [1, 4, 8, 16], durationMs: 30000, maxInFlight: 128, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000 };
}

export function validateFavoriteArrivalArtifact(artifact, inputs) {
  if (!artifact.finishedAt || !Number.isFinite(Date.parse(artifact.finishedAt))) throw Error('A finished primary scale artifact is required.');
  if (artifact.experiment !== 'strict-hue-favorite-scale' || artifact.snapshotId !== FAVORITE_SNAPSHOT_ID || !artifact.index?.startsWith(FAVORITE_INDEX_PREFIX)) throw Error('Unexpected favorite scale artifact identity.');
  safeIndexName(artifact.index);
  if (hash(artifact.identity) !== artifact.identityHash || artifact.identity.sourceIdentityHash !== inputs.identityHash || !same(artifact.identity.source, inputs.source) || !same(artifact.source, inputs.source)
    || artifact.identity.mappingHash !== hash(inputs.mapping) || !same(artifact.identity.fields, inputs.fields) || artifact.identity.workloadHash !== hash(FAVORITE_WORKLOAD)) throw Error('Favorite primary source or mapping identity differs.');
  if (artifact.scope !== inputs.scope || artifact.configuration.scope !== inputs.scope || artifact.identity.seed !== artifact.configuration.seed) throw Error('Favorite primary configuration identity differs.');
  if (artifact.finalIndexStats?.primaries?.docs?.count !== 1000000) throw Error('Arrival follow-up requires a completed million-record stage.');
  const expected = favoriteScaleCases(artifact.configuration);
  if (!same(artifact.workload, expected)) throw Error('Favorite primary workload or parameters differ from the snapshot.');
  const variants = FAVORITE_VARIANTS.filter(variant => artifact.configuration.bucketCount == null || variant.bucketCount === artifact.configuration.bucketCount).map(({ id, method, parameters }) => ({ id, method, parameters }));
  if (!same(artifact.identity.variants, variants)) throw Error('Favorite primary variant parameters differ.');
  return true;
}

export function selectFavoriteArrivalCases(artifact) {
  const selected = [], omitted = [];
  for (const variant of FAVORITE_VARIANTS) for (const queryId of ['picked-one-vibe', 'picked-five-portions']) {
    const caseId = variant.id + ':' + queryId;
    const item = artifact.workload.find(candidate => candidate.id === caseId && candidate.selectivity === 'all');
    let reason;
    const profiles = artifact.profiles.filter(profile => profile.count === 1000000 && profile.caseId === caseId && profile.concurrency === 1);
    const groups = artifact.warmups.filter(group => group.count === 1000000 && group.caseId === caseId), warmups = groups.flatMap(group => group.trials);
    if (!item) reason = 'This bank/query was not included in the primary campaign.';
    else if (!profiles.length) reason = 'No million-record C1 profile was measured.';
    else if (!warmups.length || warmups.some(row => failed(row) || row.caseId !== caseId || row.phase !== 'warmup' || !same(row.parameters, item.parameters))) reason = 'Million-record case warmup is missing, failed, slow or uses different parameters.';
    else if (profiles.some(profile => {
      const ids = profile.warmupIds ?? [profile.warmupId];
      return !profile.viableAtTestedLoad || profile.method !== item.method || !same(profile.parameters, item.parameters) || !Array.isArray(profile.trials) || profile.trials.length < 32
        || !(profile.minimumRequests >= 32) || !(profile.requestedDurationMs >= 10000) || !(profile.elapsedMs >= profile.requestedDurationMs)
        || !ids.length || ids.some(id => !groups.some(group => group.id === id && group.trials.length))
        // Timed summaries deliberately compact repeated context into the profile.
        || profile.trials.some((row, ordinal) => row.ordinal !== ordinal || failed(row)
          || (row.caseId != null && row.caseId !== caseId) || (row.phase != null && row.phase !== 'timed')
          || (row.parameters != null && !same(row.parameters, item.parameters)));
    })) reason = 'Million-record C1 timed evidence is missing, incomplete, failed or at least one second.';
    if (reason) omitted.push({ caseId, variantId: variant.id, queryId, reason });
    else selected.push({ ...item, primaryProfileIds: profiles.map(profile => profile.id), primaryWarmupIds: groups.map(group => group.id) });
  }
  return { selected, omitted };
}

export function summarizeFavoriteArrival(trials, warmups = []) {
  if (trials.some((row, ordinal) => row.ordinal !== ordinal || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || !Number.isFinite(row.schedulerDelayMs) || row.schedulerDelayMs < 0)) throw Error('Arrival ordinals must be contiguous and timing values finite.');
  const strictTimedFailures = trials.filter(failed).length, strictWarmupFailures = warmups.filter(failed).length;
  return { ...summarizeArrivals(trials), strictTimedFailures, strictWarmupFailures, strictFailures: strictTimedFailures + strictWarmupFailures,
    warmupErrors: warmups.filter(row => row.error).length, warmupOverOneSecond: warmups.filter(row => row.elapsedMs >= 1000).length,
    viableAtTestedLoad: trials.length > 0 && strictTimedFailures === 0 && strictWarmupFailures === 0 };
}

export function validateFavoriteArrivalMapping({ artifact, inputs, mapping, settings, count }) {
  if (count !== 1000000) throw Error('Favorite retained index count differs.');
  if (!settings?.uuid || settings.uuid !== artifact.indexSettings?.uuid) throw Error('Favorite retained index UUID differs.');
  if (Number(settings.number_of_shards) !== 1 || Number(settings.number_of_replicas) !== 0) throw Error('Favorite retained index topology differs.');
  if (mapping?._meta?.experiment !== artifact.experiment || mapping._meta.identityHash !== artifact.identityHash || !same(mapping._meta.identity, artifact.identity)) throw Error('Favorite retained index identity differs.');
  const { _meta, ...actualMapping } = mapping;
  if (!same(actualMapping, inputs.mapping.mappings)) throw Error('Favorite retained index mapping differs.');
  return true;
}

export function favoriteArrivalValueMatches(field, actual, expected) {
  return field.startsWith('quality_') ? Number.isFinite(actual) && Number.isFinite(expected) && Math.fround(actual) === Math.fround(expected) : actual === expected;
}

async function inspectRetainedIndex(artifact, inputs) {
  const mapping = (await api(artifact.index + '/_mapping')).body[artifact.index]?.mappings;
  const settings = (await api(artifact.index + '/_settings')).body[artifact.index]?.settings?.index;
  const count = (await api(artifact.index + '/_count')).body.count;
  validateFavoriteArrivalMapping({ artifact, inputs, mapping, settings, count });
  const expected = [0, 499999, 999999].map(index => favoriteSyntheticDocument(inputs.documents, index, { seed: artifact.configuration.seed, coverageFields: inputs.coverageFields }));
  // Small field batches also permit auditing a retained full schema without
  // changing OpenSearch's docvalue_fields request limit.
  for (let offset = 0; offset < inputs.fields.length; offset += 80) {
    const fields = inputs.fields.slice(offset, offset + 80);
    const body = (await api(artifact.index + '/_search?request_cache=false', { method: 'POST', body: { size: 3, _source: false,
      query: { ids: { values: expected.map(document => document.id) } }, docvalue_fields: ['id', 'partition', 'tags', ...fields] } })).body;
    if (body.timed_out || body._shards?.failed || body.hits?.hits?.length !== 3) throw Error('Favorite retained sample audit returned incomplete results.');
    const actual = new Map(body.hits.hits.map(hit => [hit._id, hit.fields]));
    for (const document of expected) {
      const values = actual.get(document.id);
      for (const field of ['id', 'partition', ...fields]) {
        const actualValue = values?.[field]?.[0], expectedValue = document[field];
        const matches = favoriteArrivalValueMatches(field, actualValue, expectedValue);
        if (values?.[field]?.length !== 1 || !matches) throw Error('Favorite retained sample values differ: ' + field);
      }
      if (!same([...(values.tags ?? [])].sort(), [...document.tags].sort())) throw Error('Favorite retained sample tags differ.');
    }
  }
  return { count, uuid: settings.uuid, mappingHash: hash(canonical(mapping)), sampleValuesHash: hash(expected), verifiedOrdinals: [0, 499999, 999999], at: new Date().toISOString() };
}

export async function runFavoriteArrival(config) {
  const expectedConfig = favoriteArrivalConfiguration(['--artifact', config.artifact, '--directory', config.directory]);
  if (!same(config, expectedConfig)) throw Error('Favorite arrival rates, duration, limits and timeouts are fixed by the bounded protocol.');
  if (new URL(BASE).port !== '19217') throw Error('Favorite arrival requires isolated OpenSearch port19217.');
  const artifactBytes = await readFile(config.artifact), artifact = JSON.parse(artifactBytes);
  const inputs = await loadFavoriteScaleInputs({ scope: artifact.scope, bucketCount: artifact.configuration?.bucketCount });
  validateFavoriteArrivalArtifact(artifact, inputs);
  const primarySource = JSON.parse(await readFile(artifact.sourceFile));
  const currentPrimarySource = await favoriteSourceSnapshot();
  if (hash(primarySource) !== artifact.sourceSnapshotHash || hash(currentPrimarySource) !== artifact.sourceSnapshotHash
    || !same(Object.fromEntries(Object.entries(primarySource).map(([name, source]) => [name, hash(source)])), artifact.identity.sourceHashes)) throw Error('Favorite primary recursive source snapshot differs.');
  const expectedPlans = favoriteQueryPlans(artifact.workload, inputs.fields);
  if (!same(expectedPlans, artifact.queryPlans)) throw Error('Favorite primary query plans differ.');
  const selection = selectFavoriteArrivalCases(artifact), sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const queryPlans = favoriteQueryPlans(selection.selected, inputs.fields);
  const plan = { experiment: 'strict-hue-favorite-arrival', snapshotId: FAVORITE_SNAPSHOT_ID, primaryArtifact: config.artifact, primaryArtifactHash: hash(artifactBytes),
    primaryIdentityHash: artifact.identityHash, index: artifact.index, scope: artifact.scope, count: 1000000, configuration: config, sourceSnapshotHash: hash(sourceSnapshot), selection, queryPlans };
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'primary-scale.json'), artifactBytes, { flag: 'wx' });
  const result = { ...plan, planHash: hash(plan), startedAt: new Date().toISOString(), profiles: [], warmups: [], skipped: [...selection.omitted], settling: [],
    latencyBoundary: 'Scheduled arrival through complete decoded OpenSearch response, including scheduler delay; top20 global ranking. All requests, errors, client rejections and warmups remain in failure accounting.',
    limitations: ['Query-field projection does not establish full-schema capacity when scope is projection.', 'One shared node and host, one shard and no replicas; bounded evenly spaced arrivals are not a production concurrency guarantee.',
      'Mixtures of523real measurements are not one million independent photographs. Repeated queries and warmups favor warm caches; request_cache=false leaves filter and OS caches uncontrolled.',
      'All-request arrival percentiles include scheduler delay and failed requests. Error and >=1s sets are unioned, never double counted.',
      'Resource samples run once per second and may miss peaks; process CPU counters include background work.'] };
  const save = () => atomicJson(path.join(config.directory, 'arrival.json'), result);
  let pendingWrites = Promise.resolve();
  const record = (file, row) => { pendingWrites = pendingWrites.then(() => appendFile(path.join(config.directory, file), JSON.stringify(row) + '\n')); };
  const settle = async context => {
    const observation = await settleFavoriteActivity(); result.settling.push({ ...context, ...observation }); await save();
    if (!observation.settled) throw Error('Search activity or merges failed to settle; arrival campaign stopped.');
  };
  console.log('FAVORITE_ARRIVAL_ARTIFACT ' + path.join(config.directory, 'arrival.json'));
  await save();
  try {
    result.indexBefore = await inspectRetainedIndex(artifact, inputs);
    result.engineVersion = (await api('')).body.version;
    const request = async item => {
      const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: 20 }); body.timeout = '950ms';
      const response = await searchIndex(artifact.index, body, { timeoutMs: 1500 });
      if (response.hits.length !== 20) throw Error('Favorite arrival returned an incomplete global top20.');
      for (let i = 1; i < response.hits.length; i++) if (response.hits[i].score > response.hits[i - 1].score) throw Error('Favorite arrival service scores are not descending.');
      return { serviceTookMs: response.evidence.serviceTookMs, hitCount: response.hits.length, hitsHash: hash(response.hits), topHit: response.hits[0] };
    };
    for (const item of selection.selected) {
      await settle({ caseId: item.id, phase: 'before-warmup' });
      const started = performance.now(); let observed;
      try { observed = await request(item); } catch (error) { observed = { error: error.message }; }
      const warmup = { caseId: item.id, phase: 'warmup', ordinal: 0, schedulerDelayMs: 0, elapsedMs: performance.now() - started, parameters: item.parameters, ...observed };
      result.warmups.push(warmup); record('requests.jsonl', warmup); await pendingWrites; await save();
      if (failed(warmup)) { result.skipped.push({ caseId: item.id, rates: config.rates, reason: 'Arrival warmup failed strict viability; no rate escalation.' }); await save(); continue; }
      for (const rate of config.rates) {
        await settle({ caseId: item.id, rate, phase: 'before-profile' });
        const before = await favoriteResources(), samples = [before]; let pendingSample = Promise.resolve(), sampling = false, stopped = false;
        const timer = setInterval(() => {
          if (sampling || stopped) return; sampling = true;
          pendingSample = favoriteResources().then(sample => { samples.push(sample); record('resources.jsonl', { caseId: item.id, rate, ...sample }); })
            .catch(error => { const sample = { at: new Date().toISOString(), error: error.message }; samples.push(sample); record('resources.jsonl', { caseId: item.id, rate, ...sample }); }).finally(() => { sampling = false; });
        }, 1000);
        let measurement; const profileStarted = performance.now();
        try {
          measurement = await runArrivals({ rate, durationMs: config.durationMs, maxInFlight: config.maxInFlight, run: () => request(item) });
          const remaining = config.durationMs - (performance.now() - profileStarted);
          if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        }
        finally { stopped = true; clearInterval(timer); await pendingSample; }
        const observedWindowMs = Math.max(config.durationMs, performance.now() - profileStarted);
        const after = await favoriteResources(); samples.push(after);
        const trials = measurement.trials.map(row => ({ ...row, caseId: item.id, phase: 'timed', rate, parameters: item.parameters }));
        for (const row of trials) record('requests.jsonl', row);
        const profile = { ...measurement, ...summarizeFavoriteArrival(trials, [warmup]), trials, caseId: item.id, variantId: item.variantId, queryId: item.queryId, parameters: item.parameters,
          schedulerElapsedMs: measurement.elapsedMs, elapsedMs: observedWindowMs, offeredRatePerSecond: rate, throughputPerSecond: trials.length / (observedWindowMs / 1000), successfulThroughputPerSecond: trials.filter(row => !row.error).length / (observedWindowMs / 1000),
          cpuMs: cpuMs(after) - cpuMs(before), clientCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000,
          peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedOpenSearchRssBytes: observedMaximum(samples.map(rssBytes)),
          peakObservedClientRssBytes: Math.max(...samples.map(sample => sample.clientMemory?.rss ?? 0)), resourceErrors: samples.filter(sample => sample.error).length, before, after, samples };
        result.profiles.push(profile); await pendingWrites; await save();
        console.log(JSON.stringify({ ...profile, trials: undefined, before: undefined, after: undefined, samples: undefined }));
        await settle({ caseId: item.id, rate, phase: 'after-profile' });
        if (!profile.viableAtTestedLoad) { result.skipped.push({ caseId: item.id, rates: config.rates.filter(value => value > rate), reason: 'Arrival profile failed strict viability; higher rates omitted.' }); await save(); break; }
      }
    }
    await settle({ phase: 'after-campaign' }); result.indexAfter = await inspectRetainedIndex(artifact, inputs);
    if (result.indexBefore.mappingHash !== result.indexAfter.mappingHash || result.indexBefore.sampleValuesHash !== result.indexAfter.sampleValuesHash) throw Error('Favorite retained index changed during arrival measurement.');
    if (hash(await favoriteSourceSnapshot(import.meta.url)) !== hash(sourceSnapshot)) throw Error('Favorite arrival source changed during measurement.');
    await pendingWrites; result.finishedAt = new Date().toISOString(); await save(); return { directory: config.directory, result };
  } catch (error) { await pendingWrites; result.interruption = { at: new Date().toISOString(), error: error.stack ?? String(error) }; await save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFavoriteArrival(favoriteArrivalConfiguration(process.argv.slice(2)));
