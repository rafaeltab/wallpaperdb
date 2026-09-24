// Dedicated unfiltered five-color bursts against an EXISTING completed projection.
// Read-only OpenSearch queries; this does not measure full-schema capacity.
import { mkdir, readFile, writeFile, appendFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUTOFF_SCALE_INDEX, CUTOFF_SCALE_WORKLOAD, CUTOFF_SCALE_LIMITATIONS } from './cutoff-scale.mjs';
import { CUTOFF_METHODS, buildCutoffQuery, resolveCutoffTargets } from './methods-cutoff.mjs';
import { runWorkload, summarizeTrials } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { BASE, STORE, api, searchIndex, hash } from './service.mjs';

export function cutoffHeavyConfiguration(args = []) {
  const options = { requests: '32', concurrency: '1,4,16', 'bucket-counts': '256,1024' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], key = flag.slice(2);
    if (!flag.startsWith('--') || !['requests', 'concurrency', 'bucket-counts', 'artifact', 'directory'].includes(key)) throw Error('Unknown heavy-query option: ' + flag);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw Error('Missing heavy-query option value: ' + flag);
    options[key] = value;
  }
  const config = { requests: Number(options.requests), concurrencies: options.concurrency.split(',').map(Number), bucketCounts: options['bucket-counts'].split(',').map(Number), artifact: options.artifact, directory: options.directory };
  if (!Number.isSafeInteger(config.requests) || config.requests < 32 || config.requests > 256) throw Error('Heavy-query blocks require 32..256 requests.');
  if (!config.concurrencies.length || !config.concurrencies.every((value, index) => [1, 4, 16].includes(value) && (index === 0 || value > config.concurrencies[index - 1]))) throw Error('Choose increasing concurrency values from 1,4,16.');
  if (!config.bucketCounts.length || new Set(config.bucketCounts).size !== config.bucketCounts.length || config.bucketCounts.some(value => ![256, 1024].includes(value))) throw Error('Heavy-query bucket counts must be 256 and/or1024.');
  return config;
}
export function cutoffHeavyVariants(config) {
  return CUTOFF_METHODS.flatMap(method => config.bucketCounts.map(bucketCount => ({ id: `${method.profile}-b${bucketCount}-q50`, method: method.id, parameters: { bucketCount, pixelCutoff: .5 } })));
}
export function mainSerialFailed(main, variant) {
  return main.profiles.some(profile => profile.count === 1000000 && profile.variant === variant.id && profile.concurrency === 1 && !profile.viableAtTestedLoad);
}
const atomicJson = async (filename, value) => { await writeFile(filename + '.tmp', JSON.stringify(value, null, 2)); await rename(filename + '.tmp', filename); };
async function resources() {
  return { at: new Date().toISOString(), nodes: (await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.indices.search,nodes.*.thread_pool.search')).body.nodes, clientCpu: process.cpuUsage(), clientMemory: process.memoryUsage() };
}
const cpuMs = sample => Object.values(sample.nodes).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);

export async function runCutoffHeavy(config = cutoffHeavyConfiguration()) {
  if (new URL(BASE).port !== '19217') throw Error('Heavy cutoff queries require isolated port19217.');
  const checkpoint = JSON.parse(await readFile(path.join(STORE, CUTOFF_SCALE_INDEX + '.checkpoint.json'), 'utf8'));
  const artifact = config.artifact ?? path.join(checkpoint.directory, 'scale.json'), main = JSON.parse(await readFile(artifact, 'utf8'));
  if (!main.finishedAt || main.index !== CUTOFF_SCALE_INDEX || checkpoint.identityHash !== main.identityHash || checkpoint.nextIndex !== 1000000) throw Error('The coordinated million-document projection campaign must be completed first.');
  const index = main.index, mapping = (await api(index + '/_mapping')).body[index]?.mappings;
  if (mapping?._meta?.identityHash !== main.identityHash || mapping._meta?.fullIndexCapacityMeasured !== false || (await api(index + '/_count')).body.count !== 1000000) throw Error('Existing million-document projection identity differs.');
  for (const [name, expected] of Object.entries(main.identity.computationHashes)) if (hash(await readFile(new URL(name, import.meta.url))) !== expected) throw Error('Campaign source changed before heavy-query follow-up: ' + name);
  const variants = cutoffHeavyVariants(config), item = CUTOFF_SCALE_WORKLOAD.find(item => item.id === 'picked-five-portions');
  if (!item || item.filter) throw Error('Expected the original unfiltered five-color query.');
  for (const variant of variants) {
    const targets = resolveCutoffTargets(variant.method, item.query, { parameters: variant.parameters }).targets;
    for (const target of targets) for (const component of target.components) for (const field of [component.coverageField, component.qualityField]) if (!mapping.properties[field]) throw Error('Projection lacks required heavy-query field: ' + field);
  }
  const directory = config.directory ?? path.join(path.dirname(artifact), 'heavy-' + new Date().toISOString().replaceAll(':', '-'));
  await mkdir(directory, { recursive: false });
  await copyFile(fileURLToPath(import.meta.url), path.join(directory, 'cutoff-heavy.mjs'));
  const result = { schemaVersion: 1, experiment: 'dedicated-unfiltered-five-color-projection', index, count: 1000000, base: BASE, startedAt: new Date().toISOString(), configuration: config, mainArtifact: artifact, identityHash: main.identityHash,
    sourceHash: hash(await readFile(fileURLToPath(import.meta.url))), mainSourceDirectory: main.sourceDirectory, fullIndexCapacityMeasured: false, projectionFields: main.projection.fieldCount, limitations: CUTOFF_SCALE_LIMITATIONS,
    purpose: 'Expose concurrent heavy-query cost without the mixed workload’s selective filters. Each timed block contains only unfiltered five-color proportion queries.',
    workload: item, variants, nativeTimeoutMs: 950, clientTimeoutMs: 1500, strictBoundaryMs: 1000,
    latencyBoundary: 'Compilation through decoded service response; errors and >=1000ms including serial warmups fail the block. Native timeout/partial responses are errors. Successful-request percentiles omit errors; maximum includes them.',
    profiles: [], warmups: [], skipped: [], settling: [] };
  const save = () => atomicJson(path.join(directory, 'heavy.json'), result);
  let pendingWrites = Promise.resolve();
  const settle = async context => { const observation = await settleSearchQueue(); result.settling.push({ ...context, ...observation }); await save(); if (!observation.settled) throw Error('Search queue did not settle.'); };
  const trial = async (variant, phase, concurrency, ordinal) => {
    const started = performance.now(); let observed;
    try {
      const body = buildCutoffQuery({ method: variant.method, parameters: variant.parameters, query: item.query, limit: 20 }); body.timeout = '950ms';
      const response = await searchIndex(index, body, { timeoutMs: 1500 });
      if (response.hits.length !== 20) throw Error('Expected20 globally ranked unfiltered hits.');
      observed = { elapsedMs: performance.now() - started, serviceTookMs: response.evidence.serviceTookMs, hits: response.hits };
    } catch (error) { observed = { elapsedMs: performance.now() - started, error: error.message }; }
    const row = { variant: variant.id, method: variant.method, parameters: variant.parameters, phase, concurrency, ordinal, ...observed, overOneSecond: observed.elapsedMs >= 1000 };
    pendingWrites = pendingWrites.then(() => appendFile(path.join(directory, 'requests.jsonl'), JSON.stringify(row) + '\n'));
    const { hits, ...metrics } = row; return { ...metrics, hitCount: hits?.length ?? 0 };
  };
  console.log('CUTOFF_HEAVY_ARTIFACT ' + path.join(directory, 'heavy.json')); await save();
  try {
    for (const variant of variants) {
      await settle({ variant: variant.id, phase: 'before-warmup' });
      const warmups = [await trial(variant, 'warmup', 1, 0)]; result.warmups.push({ variant: variant.id, trials: warmups }); await pendingWrites; await save();
      if (warmups.some(row => row.error || row.overOneSecond)) await settle({ variant: variant.id, phase: 'after-failed-warmup' });
      for (const concurrency of config.concurrencies) {
        if (concurrency > 1 && mainSerialFailed(main, variant)) { result.skipped.push({ variant: variant.id, concurrency, reason: 'Main campaign serial profile already failed strict viability.' }); await save(); continue; }
        const before = await resources(), profileId = `${variant.id}:c${concurrency}`;
        const measurement = await runWorkload({ items: [item], concurrency, repetitions: config.requests, trial: (_, ordinal) => trial(variant, 'timed', concurrency, ordinal) });
        const after = await resources();
        const profile = { id: profileId, variant: variant.id, method: variant.method, parameters: variant.parameters, concurrency, effectiveConcurrency: Math.min(concurrency, config.requests), elapsedMs: measurement.elapsedMs, measurement: 'closed-loop-dedicated-heavy-query-projection', ...summarizeTrials(measurement.trials, warmups),
          throughputPerSecond: measurement.trials.length / (measurement.elapsedMs / 1000), cpuMs: cpuMs(after) - cpuMs(before), before, after, trials: measurement.trials, fullIndexCapacityMeasured: false };
        result.profiles.push(profile); await pendingWrites; await save(); console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, trials: undefined }));
        if (!profile.viableAtTestedLoad) { result.skipped.push({ variant: variant.id, concurrencies: config.concurrencies.filter(value => value > concurrency), reason: 'Dedicated heavy-query block failed strict viability.' }); await save(); await settle({ variant: variant.id, phase: 'after-failed-profile' }); break; }
      }
    }
    await pendingWrites; await settle({ phase: 'after-campaign' }); result.finishedAt = new Date().toISOString(); await save(); return { directory, result };
  } catch (error) {
    await pendingWrites; result.interruptions ??= []; result.interruptions.push({ at: new Date().toISOString(), error: error.stack ?? String(error) }); await save(); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCutoffHeavy(cutoffHeavyConfiguration(process.argv.slice(2)));
