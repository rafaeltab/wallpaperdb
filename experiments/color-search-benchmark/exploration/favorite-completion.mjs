// Read-only completion of the interrupted full1024 pilot. Frozen parents stay intact.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { FAVORITE_SNAPSHOT_ID, FAVORITE_VARIANTS, FAVORITE_WORKLOAD, loadFavoriteScaleInputs, favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';
import { favoriteScaleCases, favoriteQueryPlans, favoriteSourceSnapshot, favoriteResources, settleFavoriteActivity, summarizeFavoriteTrials, compactFavoriteTrial, createFavoriteRecorder } from './favorite-scale.mjs';
import { validateFavoriteArrivalArtifact } from './favorite-arrival.mjs';
import { checkFavoriteMaintainedParity } from './favorite-maintained.mjs';
import { runWorkload } from './rank-features-scale.mjs';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { BASE, STORE, api, searchIndex, hash } from './service.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
const atomicJson = async (filename, value) => { await writeFile(filename + '.tmp', JSON.stringify(value, null, 2)); await rename(filename + '.tmp', filename); };
const cpuMs = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);
export const FAVORITE_COMPLETION_NORMALIZATION = 'opensearch-omitted-source-enabled-true-v1';

export function favoriteCompletionConfiguration(args = []) {
  const options = {};
  for (let cursor = 0; cursor < args.length; cursor++) {
    const key = args[cursor];
    if (key === '--dry-run') { options.dryRun = true; continue; }
    if (!['--artifact', '--reference-artifact', '--directory'].includes(key)) throw Error('Unknown favorite completion option: ' + key);
    const value = args[++cursor]; if (!value || value.startsWith('--')) throw Error('Missing favorite completion option: ' + key);
    options[key.slice(2)] = value;
  }
  if (!options.artifact || !options['reference-artifact'] || !options.directory) throw Error('Provide --artifact interrupted-scale.json, --reference-artifact projection-scale.json, and --directory new-output.');
  const artifact = path.resolve(options.artifact), referenceArtifact = path.resolve(options['reference-artifact']), directory = path.resolve(options.directory);
  if ([path.dirname(artifact), path.dirname(referenceArtifact)].includes(directory)) throw Error('Completion requires a separate new output directory.');
  return { artifact, referenceArtifact, directory, dryRun: options.dryRun ?? false, count: 100000, concurrencies: [1], requests: 32, durationMs: 10000, settleMs: 600000, limit: 20, serviceTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000 };
}

export function normalizeFavoriteCompletionMapping(mapping) {
  // OpenSearch omits this default when serializing a mapping. Do not normalize
  // null, {}, disabled source, source filters or any other mapping setting.
  return Object.hasOwn(mapping, '_source') ? { ...mapping } : { ...mapping, _source: { enabled: true } };
}

export function validateFavoriteCompletionMapping({ artifact, inputs, mapping, settings, count }) {
  if (count !== 100000) throw Error('Full1024 completion index count differs from100k.');
  if (!settings?.uuid || settings.uuid !== artifact.indexSettings?.uuid) throw Error('Full1024 completion index UUID differs.');
  if (Number(settings.number_of_shards) !== 1 || Number(settings.number_of_replicas) !== 0) throw Error('Full1024 completion topology differs.');
  if (mapping?._meta?.experiment !== artifact.experiment || mapping._meta.identityHash !== artifact.identityHash || !same(mapping._meta.identity, artifact.identity)) throw Error('Full1024 completion identity differs.');
  const normalized = normalizeFavoriteCompletionMapping(mapping), { _meta, ...actual } = normalized;
  if (!same(actual, inputs.mapping.mappings)) throw Error('Full1024 completion mapping differs beyond omitted source-enabled default.');
  return { normalization: FAVORITE_COMPLETION_NORMALIZATION, omittedEnabledSourceDefault: !Object.hasOwn(mapping, '_source'), mappingHash: hash(canonical(normalized)), rawMappingHash: hash(canonical(mapping)) };
}

export function validateFavoriteCompletionParent({ artifact, inputs, checkpoint, primarySource, currentPrimarySource }) {
  if (artifact.finishedAt || artifact.experiment !== 'strict-hue-favorite-scale' || artifact.snapshotId !== FAVORITE_SNAPSHOT_ID || artifact.scope !== 'full' || artifact.configuration?.bucketCount !== 1024) throw Error('Expected the incomplete full1024 favorite pilot.');
  if (hash(artifact.identity) !== artifact.identityHash || artifact.identity.sourceIdentityHash !== inputs.identityHash || !same(artifact.identity.source, inputs.source) || !same(artifact.source, inputs.source)
    || artifact.identity.mappingHash !== hash(inputs.mapping) || !same(artifact.identity.fields, inputs.fields) || artifact.identity.workloadHash !== hash(FAVORITE_WORKLOAD) || artifact.identity.seed !== artifact.configuration.seed) throw Error('Full1024 parent source or mapping identity differs.');
  const config = artifact.configuration;
  if (!same(config.counts, [10000, 100000]) || !same(config.concurrencies, [1]) || config.requests !== 32 || config.durationSeconds !== 10 || config.limit !== 20 || config.scope !== 'full') throw Error('Full1024 parent timing settings differ.');
  const expected = favoriteScaleCases(config);
  if (!same(artifact.workload, expected) || !same(artifact.identity.variants, FAVORITE_VARIANTS.filter(variant => variant.bucketCount === 1024).map(({ id, method, parameters }) => ({ id, method, parameters })))) throw Error('Full1024 parent workload or favorite settings differ.');
  if (artifact.profiles.length !== 12 || new Set(artifact.profiles.map(profile => profile.caseId)).size !== 12 || artifact.profiles.some(profile => profile.count !== 10000 || profile.concurrency !== 1 || !expected.some(item => item.id === profile.caseId && item.method === profile.method && same(item.parameters, profile.parameters))) || artifact.warmups.some(group => group.count === 100000)) throw Error('Completion requires twelve10k profiles and no existing100k timing.');
  const interruptions = artifact.interruptions ?? [];
  if (interruptions.length !== 2 || !interruptions[0].error.startsWith('Error: Search queue or merges did not settle;') || !interruptions[1].error.startsWith('Error: Favorite scale mapping differs from frozen inputs.')) throw Error('Unexpected full1024 interruption history; this helper resolves only the recorded two interruptions.');
  if (checkpoint.index !== artifact.index || checkpoint.identityHash !== artifact.identityHash || checkpoint.nextIndex !== 100000 || checkpoint.completedStage !== 100000) throw Error('Full1024 checkpoint does not acknowledge the entire100k indexing stage.');
  if (hash(primarySource) !== artifact.sourceSnapshotHash || hash(currentPrimarySource) !== artifact.sourceSnapshotHash || !same(Object.fromEntries(Object.entries(primarySource).map(([name, source]) => [name, hash(source)])), artifact.identity.sourceHashes)) throw Error('Full1024 parent source snapshot changed.');
  if (!same(favoriteQueryPlans(expected, inputs.fields), artifact.queryPlans)) throw Error('Full1024 parent query plans differ.');
  return true;
}

export function favoriteCompletionCases(artifact, reference) {
  return favoriteScaleCases(artifact.configuration).map(item => {
    const ownPlan = artifact.queryPlans.find(plan => plan.caseId === item.id), referencePlan = reference.queryPlans.find(plan => plan.caseId === item.id);
    if (!referencePlan || !same(ownPlan, referencePlan)) throw Error('Projection reference query plan differs: ' + item.id);
    const groups = reference.warmups.filter(group => group.count === 100000 && group.caseId === item.id), references = [];
    for (const group of groups) for (const row of group.trials) if (!row.error) {
      if (row.phase !== 'warmup' || row.caseId !== item.id || row.method !== item.method || !same(row.parameters, item.parameters) || row.hitCount !== 20 || !/^[a-f0-9]{64}$/.test(row.hitsHash ?? '')) throw Error('Projection warmup reference provenance differs.');
      references.push({ warmupId: group.id, hitsHash: row.hitsHash });
    }
    if (!references.length || new Set(references.map(row => row.hitsHash)).size !== 1) throw Error('Expected a consistent successful same-count projection reference for ' + item.id);
    return { ...item, reference: { available: true, hitsHash: references[0].hitsHash, warmupIds: [...new Set(references.map(row => row.warmupId))] } };
  });
}

async function fileReceipt(filename) { const bytes = await readFile(filename); return { path: filename, sha256: hash(bytes), bytes: bytes.length }; }

async function readCompletionInputs(config) {
  const parentBytes = await readFile(config.artifact), artifact = JSON.parse(parentBytes), referenceBytes = await readFile(config.referenceArtifact), reference = JSON.parse(referenceBytes);
  const inputs = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 1024 }), projection = await loadFavoriteScaleInputs({ scope: 'projection' });
  const checkpointFile = path.join(STORE, artifact.index + '.checkpoint.json'), checkpointBytes = await readFile(checkpointFile), checkpoint = JSON.parse(checkpointBytes);
  const primarySource = JSON.parse(await readFile(artifact.sourceFile)), currentPrimarySource = await favoriteSourceSnapshot();
  validateFavoriteCompletionParent({ artifact, inputs, checkpoint, primarySource, currentPrimarySource });
  validateFavoriteArrivalArtifact(reference, projection);
  if (reference.sourceSnapshotHash !== artifact.sourceSnapshotHash || reference.source.identityHash !== inputs.source.identityHash || reference.source.descriptorHash !== inputs.source.descriptorHash) throw Error('Projection reference does not share frozen scorer and measured sources.');
  if (!same(reference.queryPlans, favoriteQueryPlans(reference.workload, projection.fields))) throw Error('Projection reference query plans changed.');
  const cases = favoriteCompletionCases(artifact, reference);
  const savedMappingFile = path.join(path.dirname(config.artifact), 'resume-mapping-response.json'), saved = JSON.parse(await readFile(savedMappingFile));
  const mappingDiagnosis = validateFavoriteCompletionMapping({ artifact, inputs, mapping: saved[artifact.index]?.mappings, settings: artifact.indexSettings, count: checkpoint.nextIndex });
  const parentFiles = await Promise.all([config.artifact, artifact.sourceFile, path.join(path.dirname(config.artifact), 'requests.jsonl'), path.join(path.dirname(config.artifact), 'resources.jsonl'), savedMappingFile, checkpointFile].map(fileReceipt));
  return { inputs, artifact, reference, parentBytes, referenceBytes, cases, parentFiles, mappingDiagnosis, checkpointReceipt: { path: checkpointFile, sha256: hash(checkpointBytes), checkpoint } };
}

export async function dryRunFavoriteCompletion(config) {
  const prepared = await readCompletionInputs(config);
  return { dryRun: true, noServiceRequests: true, parentArtifactHash: hash(prepared.parentBytes), referenceArtifactHash: hash(prepared.referenceBytes), parentIdentityHash: prepared.artifact.identityHash, mappingDiagnosis: prepared.mappingDiagnosis, count: config.count, queryCases: prepared.cases.length, concurrencies: config.concurrencies, requests: config.requests, durationMs: config.durationMs, parentInterruptionsPreserved: prepared.artifact.interruptions.length, parentTimedStages: [...new Set(prepared.artifact.profiles.map(profile => profile.count))], mappedFields: Object.keys(prepared.inputs.mapping.mappings.properties).length, allReferencesAvailable: prepared.cases.every(item => item.reference.available) };
}

async function inspectCompletionIndex(artifact, inputs) {
  const mapping = (await api(artifact.index + '/_mapping')).body[artifact.index]?.mappings, settings = (await api(artifact.index + '/_settings')).body[artifact.index]?.settings?.index, count = (await api(artifact.index + '/_count')).body.count;
  const normalized = validateFavoriteCompletionMapping({ artifact, inputs, mapping, settings, count });
  const verifiedOrdinals = [0, 49999, 99999], expected = verifiedOrdinals.map(ordinal => favoriteSyntheticDocument(inputs.documents, ordinal, { seed: artifact.configuration.seed, coverageFields: inputs.coverageFields }));
  const documents = (await api(artifact.index + '/_mget', { method: 'POST', body: { ids: expected.map(document => document.id) } })).body.docs;
  const actual = new Map(documents.map(document => [document._id, document]));
  for (const document of expected) if (!actual.get(document.id)?.found || !same(actual.get(document.id)._source, document)) throw Error('Full1024 completion sample values differ: ' + document.id);
  return { count, uuid: settings.uuid, ...normalized, sampleValuesHash: hash(expected), verifiedOrdinals, at: new Date().toISOString() };
}
async function completionLayout(index) {
  return { at: new Date().toISOString(), stats: (await api(index + '/_stats/store,docs,segments,merge')).body._all, segments: (await api(index + '/_segments')).body };
}

export async function runFavoriteCompletion(config) {
  const expectedConfig = favoriteCompletionConfiguration(['--artifact', config.artifact, '--reference-artifact', config.referenceArtifact, '--directory', config.directory]);
  if (!same(config, expectedConfig) || new URL(BASE).port !== '19217') throw Error('Completion requires the fixed read-only protocol on isolated port19217.');
  const prepared = await readCompletionInputs(config), { inputs, artifact, cases } = prepared, sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const sourceFile = path.join(config.directory, 'source-snapshot.json');
  const plan = { experiment: 'strict-hue-favorite-completion', snapshotId: FAVORITE_SNAPSHOT_ID, parentArtifact: config.artifact, parentArtifactHash: hash(prepared.parentBytes), parentIdentityHash: artifact.identityHash, parentFiles: prepared.parentFiles,
    referenceArtifact: config.referenceArtifact, referenceArtifactHash: hash(prepared.referenceBytes), primarySourceSnapshotHash: artifact.sourceSnapshotHash, sourceSnapshotHash: hash(sourceSnapshot), sourceFile, index: artifact.index, scope: 'full', bucketCount: 1024, count: 100000,
    readOnly: true, mappingNormalization: FAVORITE_COMPLETION_NORMALIZATION, mappingDiagnosis: prepared.mappingDiagnosis, configuration: config, checkpointReceipt: prepared.checkpointReceipt, workload: cases, queryPlans: favoriteQueryPlans(cases, inputs.fields),
    parentHistory: { invocations: artifact.invocations, interruptions: artifact.interruptions, settling: artifact.settling } };
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  await writeFile(sourceFile, JSON.stringify(sourceSnapshot, null, 2), { flag: 'wx' });
  await writeFile(path.join(config.directory, 'parent-scale.json'), prepared.parentBytes, { flag: 'wx' });
  await writeFile(path.join(config.directory, 'reference-scale.json'), prepared.referenceBytes, { flag: 'wx' });
  const result = { ...plan, planHash: hash(plan), startedAt: new Date().toISOString(), profiles: [], warmups: [], settling: [],
    latencyBoundary: 'Original compile-through-decoded-response timing, top20 global ranking; one serial warmup,32requests AND10seconds atC1. Successful-only timed percentiles; every error or >=1000ms including warmup fails.',
    limitations: ['This completes only the missing100k C1 query stage. Parent10k timings and both interruptions remain separate, immutable evidence.', 'Source-enabled default omission is the sole accepted mapping normalization; no source, score, index values or topology changed.', 'Full1024 schema, synthetic measured descriptor mixtures, one shared host/node/shard, no replicas; this is not full-schema million-wallpaper or production-concurrency proof.', 'Historical100k projection top20 hashes must match every successful completion response. Parity failures are validation failures, separately identified from performance timeouts.', 'Resource samples are observations at one-second intervals; cached node CPU and sampled heap/RSS are not instantaneous peaks.'] };
  const save = () => atomicJson(path.join(config.directory, 'completion.json'), result), recorder = createFavoriteRecorder(config.directory);
  const settle = async context => { const observation = await settleFavoriteActivity({ timeoutMs: config.settleMs }); result.settling.push({ ...context, ...observation }); await save(); if (!observation.settled) throw Error('Completion search or merge activity did not settle.'); };
  const trial = async (item, phase, ordinal, context) => {
    const started = performance.now(); let observed;
    try {
      const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, filter: item.filter, limit: 20 }); body.timeout = '950ms';
      const response = await searchIndex(artifact.index, body, { timeoutMs: 1500 }), elapsedMs = performance.now() - started, parity = checkFavoriteMaintainedParity(response.hits, item.reference);
      observed = { elapsedMs, serviceTookMs: response.evidence.serviceTookMs, hitCount: 20, hitsHash: parity.hitsHash, scoreParity: 'match', ...(phase === 'warmup' ? { hits: response.hits } : {}) };
    } catch (error) { observed = { elapsedMs: performance.now() - started, error: error.message, hitCount: 0, ...(error.code === 'FAVORITE_PARITY' ? { parityMismatch: true } : {}) }; }
    const row = { caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: item.selectivity, method: item.method, parameters: item.parameters, count: 100000, phase, concurrency: 1, ordinal, ...context, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    row.requestId = `${context.profileId ?? context.warmupId}:${phase}:${ordinal}`;
    await recorder.record('requests.jsonl', row); return { ...compactFavoriteTrial(row), ...(row.parityMismatch ? { parityMismatch: true } : {}) };
  };
  console.log('FAVORITE_COMPLETION_ARTIFACT ' + path.join(config.directory, 'completion.json')); await save();
  try {
    await settle({ phase: 'before-index-audit' }); result.indexBefore = await inspectCompletionIndex(artifact, inputs); result.layoutBefore = await completionLayout(artifact.index);
    result.engineVersion = (await api('')).body.version; result.nodeVersion = process.version;
    result.nodeConfiguration = (await api('_nodes/os,jvm,process,thread_pool?filter_path=nodes.*.name,nodes.*.os,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process,nodes.*.thread_pool.search')).body; await save();
    // The frozen driver's second count stage reverses the original case order.
    for (const item of [...cases].reverse()) {
      await settle({ caseId: item.id, phase: 'before-warmup' });
      const warmupId = `${item.id}:warmup`, profileId = `${item.id}:c1`, warmups = [await trial(item, 'warmup', 0, { warmupId })];
      result.warmups.push({ id: warmupId, caseId: item.id, count: 100000, trials: warmups }); await recorder.flush(); await save();
      if (warmups.some(row => row.parityMismatch)) throw Error('Projection score parity failed in warmup; no timing continued.');
      await settle({ caseId: item.id, phase: 'before-profile' });
      const before = await favoriteResources(), samples = [before]; let sampling = false, stopped = false, pendingSample = Promise.resolve();
      const timer = setInterval(() => {
        if (sampling || stopped) return; sampling = true;
        pendingSample = favoriteResources().then(async sample => { samples.push(sample); await recorder.record('resources.jsonl', { profileId, ...sample }); })
          .catch(async error => { const sample = { at: new Date().toISOString(), error: error.message }; samples.push(sample); await recorder.record('resources.jsonl', { profileId, ...sample }); }).finally(() => { sampling = false; });
      }, 1000);
      let measurement;
      try { measurement = await runWorkload({ items: [item], concurrency: 1, repetitions: 32, durationMs: 10000, trial: (_, ordinal) => trial(item, 'timed', ordinal, { warmupId, profileId }) }); }
      finally { stopped = true; clearInterval(timer); await pendingSample; }
      const after = await favoriteResources(); samples.push(after);
      const profile = { id: profileId, warmupId, warmupIds: [warmupId], caseId: item.id, variant: item.variantId, queryId: item.queryId, selectivity: item.selectivity, method: item.method, parameters: item.parameters, index: artifact.index, count: 100000, scope: 'full', concurrency: 1, effectiveConcurrency: 1, minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: measurement.elapsedMs,
        measurement: 'closed-loop-read-only-full1024-completion', ...summarizeFavoriteTrials(measurement.trials, warmups), throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000), cpuMs: cpuMs(after) - cpuMs(before), clientCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000,
        peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedClientRssBytes: Math.max(...samples.map(sample => sample.clientMemory?.rss ?? 0)), resourceSampleCount: samples.length, resourceErrors: samples.filter(sample => sample.error).length, reference: item.reference, before, after, trials: measurement.trials };
      result.profiles.push(profile); await recorder.flush(); result.recording = recorder.observation(); await save();
      console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, trials: undefined }));
      await settle({ caseId: item.id, profileId, phase: 'after-profile' });
      if (measurement.trials.some(row => row.parityMismatch)) throw Error('Projection score parity changed during timing; requests drained before stopping.');
    }
    await settle({ phase: 'after-campaign' }); result.indexAfter = await inspectCompletionIndex(artifact, inputs); result.layoutAfter = await completionLayout(artifact.index); result.finalIndexStats = result.layoutAfter.stats;
    if (result.indexBefore.uuid !== result.indexAfter.uuid || result.indexBefore.mappingHash !== result.indexAfter.mappingHash || result.indexBefore.sampleValuesHash !== result.indexAfter.sampleValuesHash) throw Error('Full1024 index changed during read-only completion.');
    for (const receipt of prepared.parentFiles) if (hash(await readFile(receipt.path)) !== receipt.sha256) throw Error('Immutable parent evidence changed: ' + receipt.path);
    if (hash(await readFile(config.referenceArtifact)) !== hash(prepared.referenceBytes) || hash(await favoriteSourceSnapshot(import.meta.url)) !== hash(sourceSnapshot)) throw Error('Reference or completion source changed during measurement.');
    result.recording = recorder.observation(); await recorder.close(); result.finishedAt = new Date().toISOString(); result.parentFilesUnchanged = true; await save(); return { directory: config.directory, result };
  } catch (error) {
    try { await recorder.close(); } catch (recordingError) { result.recordingError = recordingError.message; }
    result.recording = recorder.observation(); result.interruption = { at: new Date().toISOString(), error: error.stack ?? String(error) }; await save(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = favoriteCompletionConfiguration(process.argv.slice(2));
  if (config.dryRun) console.log(JSON.stringify(await dryRunFavoriteCompletion(config), null, 2));
  else await runFavoriteCompletion(config);
}
