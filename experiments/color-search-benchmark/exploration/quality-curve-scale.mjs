// Compare changed query curves on the retained field projection. No reindexing.
import { mkdir, readFile, writeFile, appendFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUTOFF_SCALE_INDEX, CUTOFF_SCALE_WORKLOAD, CUTOFF_SCALE_LIMITATIONS, cutoffProjectionMapping } from './cutoff-scale.mjs';
import { buildCutoffQuery, resolveCutoffTargets } from './methods-cutoff.mjs';
import { runWorkload, summarizeTrials } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { BASE, STORE, api, searchIndex, hash } from './service.mjs';

export const QUALITY_CURVE_STORAGE_SOURCES = Object.freeze(['cutoff-definition.mjs', 'cutoff-index.mjs', 'overlap-regions.mjs', 'overlap-banks.mjs', 'overlap-index.mjs', 'corpus-colors.mjs', 'overlap-scale-corpus.mjs']);
const SOURCE_FILES = [...new Set(['quality-curve-scale.mjs', 'quality-curve.mjs', 'methods-cutoff.mjs', 'methods-overlap.mjs', 'query.mjs', 'service.mjs', 'rank-features-scale.mjs', 'arrival-load.mjs', 'cutoff-scale.mjs', ...QUALITY_CURVE_STORAGE_SOURCES, '../ranges.mjs', '../proportions.mjs'])];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));

export function qualityCurveScaleConfiguration(args = []) {
  const options = { requests: '16', concurrency: '1,4' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], key = flag.slice(2);
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    if (!flag.startsWith('--') || !['requests', 'concurrency', 'artifact', 'directory'].includes(key)) throw Error('Unknown quality-curve scale option: ' + flag);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw Error('Missing quality-curve scale option value: ' + flag);
    options[key] = value;
  }
  const config = { requests: Number(options.requests), concurrencies: options.concurrency.split(',').map(Number), artifact: options.artifact, directory: options.directory, dryRun: options.dryRun ?? false };
  if (!Number.isSafeInteger(config.requests) || config.requests < 16 || config.requests > 128) throw Error('Quality-curve blocks require 16..128 requests.');
  if (!config.concurrencies.length || !config.concurrencies.every((value, index) => [1, 4].includes(value) && (index === 0 || value > config.concurrencies[index - 1]))) throw Error('Choose increasing concurrency values from 1,4.');
  return config;
}
export function qualityCurveScaleVariants() {
  return ['hard', 'feather'].flatMap(profile => [256, 1024].flatMap(bucketCount => ['linear', 'power'].map(qualityCurve => ({
    id: `${profile}-b${bucketCount}-q0-${qualityCurve}-i3`, method: 'cutoff-' + profile,
    parameters: { bucketCount, pixelCutoff: 0, qualityCurve, qualityInfluence: 3, minimumQuality: 0 },
  }))));
}
export function qualityCurveScaleCases() {
  const variants = qualityCurveScaleVariants(), cases = [];
  for (const method of ['cutoff-hard', 'cutoff-feather']) for (const bucketCount of [256, 1024]) {
    // Compare the curves adjacent to one another for the same query. Each
    // measured block contains only that query, never a mixed easy/heavy workload.
    for (const queryId of ['picked-one-vibe', 'picked-five-portions']) for (const qualityCurve of ['linear', 'power']) {
      const variant = variants.find(item => item.method === method && item.parameters.bucketCount === bucketCount && item.parameters.qualityCurve === qualityCurve);
      const item = CUTOFF_SCALE_WORKLOAD.find(item => item.id === queryId);
      if (!item || item.filter) throw Error('Expected an existing unfiltered query in the retained projection workload.');
      cases.push({ ...variant, id: variant.id + ':' + queryId, variantId: variant.id, queryId, query: item.query });
    }
  }
  return cases;
}
function validateOriginalArtifact(main, checkpoint) {
  if (!main.finishedAt || main.index !== CUTOFF_SCALE_INDEX || checkpoint.identityHash !== main.identityHash || checkpoint.nextIndex !== 1000000 || hash(main.identity) !== main.identityHash) throw Error('The original completed million-document projection artifact and checkpoint must agree.');
  if (main.identity.kind !== 'query-field-projection-only' || main.projection.fullIndexCapacityMeasured !== false || main.projection.fieldCount !== main.identity.fields.length || !same(main.projection.fields, main.identity.fields)) throw Error('Original projection identity or field declaration differs.');
  if (hash(cutoffProjectionMapping(main.identity.fields)) !== main.identity.mappingHash) throw Error('Original projection mapping fingerprint differs.');
}
export function validateQualityCurveProjection({ main, checkpoint, mapping, count }) {
  validateOriginalArtifact(main, checkpoint);
  if (count !== 1000000 || mapping?._meta?.identityHash !== main.identityHash || mapping._meta?.fullIndexCapacityMeasured !== false || !same(mapping._meta?.identity, main.identity)) throw Error('Retained million-document projection count or source identity differs.');
  const expected = cutoffProjectionMapping(main.identity.fields).mappings;
  if (mapping.dynamic !== 'strict' || mapping._source?.enabled !== false || !same(mapping.properties, expected.properties)) throw Error('Retained projection mapping differs.');
  return true;
}
export function validateQualityCurveStorageSources(storedHashes, currentHashes) {
  // Query methods intentionally change. Pixel extraction, region geometry and
  // synthetic values may not change underneath the retained benchmark index.
  for (const name of QUALITY_CURVE_STORAGE_SOURCES) if (!storedHashes[name] || currentHashes[name] !== storedHashes[name]) throw Error('Retained storage source changed: ' + name);
  return true;
}

async function readInputs(config) {
  const checkpointFile = path.join(STORE, CUTOFF_SCALE_INDEX + '.checkpoint.json');
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  const artifact = config.artifact ?? path.join(checkpoint.directory, 'scale.json'), main = JSON.parse(await readFile(artifact, 'utf8'));
  validateOriginalArtifact(main, checkpoint);
  const sourceHashes = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
  validateQualityCurveStorageSources(main.identity.computationHashes, sourceHashes);
  const variants = qualityCurveScaleVariants(), cases = qualityCurveScaleCases();
  const queryPlans = cases.map(item => {
    const targets = resolveCutoffTargets(item.method, item.query, { parameters: item.parameters }).targets;
    const requiredFields = [...new Set(targets.flatMap(target => target.components.flatMap(component => [component.coverageField, component.qualityField])))].sort();
    if (requiredFields.some(field => !main.identity.fields.includes(field))) throw Error('Retained projection does not contain every required quality-curve field.');
    const body = buildCutoffQuery({ method: item.method, query: item.query, parameters: item.parameters, limit: 20 }); body.timeout = '950ms';
    return { caseId: item.id, requiredFields, body, bodyHash: hash(body) };
  });
  return { checkpoint, artifact, main, variants, cases, queryPlans, sourceHashes };
}
export async function dryRunQualityCurveScale(config = qualityCurveScaleConfiguration()) {
  const inputs = await readInputs(config);
  return { dryRun: true, noServiceRequests: true, liveIndexVerified: false, mainArtifact: inputs.artifact, storageIdentityHash: inputs.main.identityHash, projectionFieldCount: inputs.main.projection.fieldCount,
    variants: inputs.variants, queryCases: inputs.cases.length, plannedTimedProfiles: inputs.cases.length * config.concurrencies.length, requestsPerProfile: config.requests,
    storageSourcesUnchanged: true, currentQuerySourceHashes: inputs.sourceHashes, queryPlans: inputs.queryPlans.map(({ body, ...plan }) => ({ ...plan, scriptFunctions: JSON.stringify(body).includes('script_score') })), limitations: CUTOFF_SCALE_LIMITATIONS };
}
const atomicJson = async (filename, value) => { await writeFile(filename + '.tmp', JSON.stringify(value, null, 2)); await rename(filename + '.tmp', filename); };
async function resources() {
  return { at: new Date().toISOString(), nodes: (await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.indices.search,nodes.*.thread_pool.search')).body.nodes, clientCpu: process.cpuUsage(), clientMemory: process.memoryUsage() };
}
const cpuMs = sample => Object.values(sample.nodes).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);

export async function runQualityCurveScale(config = qualityCurveScaleConfiguration()) {
  if (new URL(BASE).port !== '19217') throw Error('Quality-curve scale requires isolated port19217.');
  const inputs = await readInputs(config), { main, checkpoint, artifact, cases, variants, queryPlans, sourceHashes } = inputs;
  const index = main.index, mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  validateQualityCurveProjection({ main, checkpoint, mapping, count: (await api(index + '/_count')).body.count });
  const directory = config.directory ?? path.join(STORE, 'quality-curve-scale', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory, { recursive: false });
  const sourceDirectory = path.join(directory, 'sources', 'exploration'); await mkdir(sourceDirectory, { recursive: true });
  for (const name of SOURCE_FILES) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(sourceDirectory, name));
  const result = { schemaVersion: 1, experiment: 'quality-curve-comparison-on-retained-projection', index, count: 1000000, base: BASE, startedAt: new Date().toISOString(), configuration: config,
    mainArtifact: artifact, storageIdentityHash: main.identityHash, originalStorageSource: main.identity.source, originalSourceDirectory: main.sourceDirectory,
    currentQuerySourceHashes: sourceHashes, sourceDirectory, intentionalQueryChange: 'Linear versus power quality at influence3; stored measured coverage/quality and the existing synthetic index are unchanged.',
    fullIndexCapacityMeasured: false, projectionFields: main.projection.fieldCount, limitations: [...CUTOFF_SCALE_LIMITATIONS, 'Fixed order: linear then power for each query/bank/kernel. Short blocks do not establish stable comparative production capacity.'],
    workload: cases, variants, queryPlans, nativeTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000,
    latencyBoundary: 'Query compilation through decoded OpenSearch response. Each block contains exactly one query. Errors and >=1000ms including serial warmups fail the block; partial responses are rejected. Percentiles contain successful timed responses only.',
    profiles: [], warmups: [], skipped: [], settling: [], nodeVersion: process.version,
    engineVersion: (await api('')).body.version, nodeConfiguration: (await api('_nodes/os,jvm?filter_path=nodes.*.name,nodes.*.os,nodes.*.jvm.mem.heap_max_in_bytes')).body };
  const save = () => atomicJson(path.join(directory, 'scale.json'), result);
  let pendingWrites = Promise.resolve();
  const settle = async context => { const observation = await settleSearchQueue(); result.settling.push({ ...context, ...observation }); await save(); if (!observation.settled) throw Error('Search queue did not settle.'); };
  const trial = async (item, phase, concurrency, ordinal) => {
    const started = performance.now(); let observed;
    try {
      const body = buildCutoffQuery({ method: item.method, parameters: item.parameters, query: item.query, limit: 20 }); body.timeout = '950ms';
      const response = await searchIndex(index, body, { timeoutMs: 1500 });
      if (response.hits.length !== 20) throw Error('Expected20 globally ranked unfiltered hits.');
      observed = { elapsedMs: performance.now() - started, serviceTookMs: response.evidence.serviceTookMs, hits: response.hits };
    } catch (error) { observed = { elapsedMs: performance.now() - started, error: error.message }; }
    const row = { caseId: item.id, variant: item.variantId, queryId: item.queryId, method: item.method, parameters: item.parameters, phase, concurrency, ordinal, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    pendingWrites = pendingWrites.then(() => appendFile(path.join(directory, 'requests.jsonl'), JSON.stringify(row) + '\n'));
    const { hits, ...metrics } = row; return { ...metrics, hitCount: hits?.length ?? 0 };
  };
  console.log('QUALITY_CURVE_SCALE_ARTIFACT ' + path.join(directory, 'scale.json')); await save();
  try {
    for (const item of cases) {
      await settle({ caseId: item.id, phase: 'before-warmup' });
      const warmups = [await trial(item, 'warmup', 1, 0)]; result.warmups.push({ caseId: item.id, variant: item.variantId, queryId: item.queryId, trials: warmups }); await pendingWrites; await save();
      if (warmups.some(row => row.error || row.overOneSecond)) await settle({ caseId: item.id, phase: 'after-failed-warmup' });
      for (const concurrency of config.concurrencies) {
        const before = await resources();
        const measurement = await runWorkload({ items: [item], concurrency, repetitions: config.requests, trial: (_, ordinal) => trial(item, 'timed', concurrency, ordinal) });
        const after = await resources();
        const profile = { id: `${item.id}:c${concurrency}`, caseId: item.id, variant: item.variantId, queryId: item.queryId, method: item.method, parameters: item.parameters, concurrency, effectiveConcurrency: Math.min(concurrency, config.requests), elapsedMs: measurement.elapsedMs, measurement: 'closed-loop-single-query-quality-curve-projection',
          ...summarizeTrials(measurement.trials, warmups), throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000), cpuMs: cpuMs(after) - cpuMs(before), before, after, trials: measurement.trials, fullIndexCapacityMeasured: false };
        result.profiles.push(profile); await pendingWrites; await save(); console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, trials: undefined }));
        if (!profile.viableAtTestedLoad) { result.skipped.push({ caseId: item.id, queryId: item.queryId, concurrencies: config.concurrencies.filter(value => value > concurrency), reason: 'This query/curve block failed strict viability; higher concurrency skipped for this case only.' }); await save(); await settle({ caseId: item.id, phase: 'after-failed-profile' }); break; }
      }
    }
    await pendingWrites; await settle({ phase: 'after-campaign' });
    result.finalIndexStats = (await api(index + '/_stats/store,docs,segments,merge')).body._all;
    result.finishedAt = new Date().toISOString(); await save(); return { directory, result };
  } catch (error) {
    await pendingWrites; result.interruptions ??= []; result.interruptions.push({ at: new Date().toISOString(), error: error.stack ?? String(error) }); await save(); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = qualityCurveScaleConfiguration(process.argv.slice(2));
  if (config.dryRun) console.log(JSON.stringify(await dryRunQualityCurveScale(config), null, 2));
  else await runQualityCurveScale(config);
}
