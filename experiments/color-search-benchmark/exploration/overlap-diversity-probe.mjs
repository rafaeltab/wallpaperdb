// THROWAWAY diagnostic benchmark. Read-only native OpenSearch queries; no index mutations.
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { overlapFingerprints } from './overlap-index.mjs';
import { buildOverlapQuery } from './methods-overlap.mjs';
import { runWorkload, summarizeTrials } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { api, searchIndex, safeIndexName, hash, BASE, STORE } from './service.mjs';

const METHOD = 'overlap-quality-dense';
const INDEX = 'color-exploration-overlap-scale-v1';
const ANCHOR_COUNT = 128;

export function diversityConfiguration(args = []) {
  const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  const configuration = {
    index: safeIndexName(option('--index', INDEX)), count: Number(option('--counts', '1000000')),
    concurrencies: option('--concurrency', '4').split(',').map(Number), repetitions: Number(option('--repeats', '2')),
    seed: Number(option('--seed', '99539473')), limit: Number(option('--limit', '20')),
    directory: option('--directory'),
  };
  if (configuration.count !== 1000000) throw Error('This diversity probe requires exactly one million existing records.');
  if (!configuration.concurrencies.length || !configuration.concurrencies.every((value, index, array) => Number.isInteger(value) && value >= 1 && value <= 16 && (!index || value > array[index - 1]))) throw Error('Concurrencies must be increasing integers between1 and16.');
  if (!Number.isInteger(configuration.repetitions) || configuration.repetitions < 1 || configuration.repetitions > 4) throw Error('Use one to four repeated passes.');
  if (!Number.isSafeInteger(configuration.seed)) throw Error('Seed must be a safe integer.');
  if (!Number.isInteger(configuration.limit) || configuration.limit < 1 || configuration.limit > 100) throw Error('Result limit must be1..100.');
  return configuration;
}

export function buildDiversityWorkload({ seed = 99539473 } = {}) {
  if (!Number.isSafeInteger(seed)) throw Error('Seed must be a safe integer.');
  const items = [];
  for (let i = 0; i < ANCHOR_COUNT; i++) {
    const region = OVERLAP_REGIONS[Math.floor(i * OVERLAP_REGIONS.length / ANCHOR_COUNT)];
    for (const mode of ['vibe', 'proportions']) items.push({
      id: `${region.key}-${mode}`, regionIndex: region.index, color: region.hex, fields: regionFields(region.index),
      query: { mode, targets: [{ color: region.hex, ...(mode === 'proportions' ? { percent: 40 } : {}) }] },
    });
  }
  // Stable Fisher-Yates ordering avoids traversing the field bank in index order.
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

export function summarizeDiversityTrials(trials, firstPass = []) {
  const summary = summarizeTrials(trials, firstPass);
  const strictViable = summary.timedRequestsViable && summary.warmupErrors === 0 && summary.warmupOverOneSecond === 0;
  return { ...summary, priorErrors: summary.warmupErrors, priorOverOneSecond: summary.warmupOverOneSecond,
    // The first pass has no prior warmup; every first-pass request is itself measured.
    viableAtTestedLoad: strictViable, strictViable };
}

const canonicalJson = value => JSON.stringify(canonicalValue(value));
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}

export function validateDiversityIndex({ count, mapping, workload, expectedFingerprints, checkpoint, index = INDEX }) {
  if (count !== 1000000) throw Error('Diversity measurements require exactly one million records.');
  const metadata = mapping?._meta;
  // OpenSearch may reorder keys when serializing _meta. The external checkpoint
  // retains the original ordered identity and its hash; compare service values
  // canonically, while still verifying the checkpoint's original hash verbatim.
  if (!checkpoint?.identity || checkpoint.index !== index || checkpoint.identityHash !== hash(checkpoint.identity) || checkpoint.nextIndex !== count) throw Error('Unverified overlap scale checkpoint identity or completed count.');
  if (metadata?.experiment !== 'overlap-scale' || !metadata.identity || metadata.identityHash !== checkpoint.identityHash || canonicalJson(metadata.identity) !== canonicalJson(checkpoint.identity)) throw Error('Unverified overlap scale index identity.');
  for (const field of ['definitionHash', 'computationHash', 'corpusHash', 'featureHash', 'preparationHash']) {
    if (!expectedFingerprints?.[field] || metadata.identity.fingerprints?.[field] !== expectedFingerprints[field]) throw Error(`Diversity index ${field} fingerprint does not match current query geometry and descriptor sources.`);
  }
  for (const item of workload) {
    if (mapping.properties?.[item.fields.coverage]?.type !== 'integer' || mapping.properties?.[item.fields.quality]?.type !== 'float') throw Error(`Missing or unexpected selected field mapping: ${item.id}`);
  }
  return true;
}

const cpuMs = sample => Object.values(sample?.nodes ?? {}).reduce((sum, node) => sum + (node.process?.cpu?.total_in_millis ?? 0), 0);
const heapBytes = sample => Object.values(sample?.nodes ?? {}).reduce((sum, node) => sum + (node.jvm?.mem?.heap_used_in_bytes ?? 0), 0);
async function resources() {
  const snapshot = (await api('_nodes/stats/os,process,jvm,indices,thread_pool?filter_path=nodes.*.os.cpu,nodes.*.os.mem,nodes.*.process.cpu,nodes.*.process.mem,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search')).body;
  return { at: new Date().toISOString(), nodes: snapshot.nodes, clientMemory: process.memoryUsage(), clientCpu: process.cpuUsage() };
}

export async function runOverlapDiversity(configuration = diversityConfiguration()) {
  const config = diversityConfiguration([
    '--index', configuration.index ?? INDEX, '--counts', String(configuration.count ?? 1000000),
    '--concurrency', (configuration.concurrencies ?? [4]).join(','), '--repeats', String(configuration.repetitions ?? 2),
    '--seed', String(configuration.seed ?? 99539473), '--limit', String(configuration.limit ?? 20),
    ...(configuration.directory ? ['--directory', configuration.directory] : []),
  ]);
  if (new URL(BASE).port !== '19217') throw Error('Diversity probe requires isolated OpenSearch port19217.');
  const workload = buildDiversityWorkload(config), queriesById = new Map(workload.map(item => [item.id, item]));
  const currentFingerprints = await overlapFingerprints();
  const checkpointFile = path.join(STORE, config.index + '.checkpoint.json');
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  const mapping = (await api(`${config.index}/_mapping`)).body[config.index]?.mappings;
  const count = (await api(`${config.index}/_count`)).body.count;
  validateDiversityIndex({ count, mapping, workload, expectedFingerprints: currentFingerprints, checkpoint, index: config.index });
  const settings = (await api(`${config.index}/_settings`)).body[config.index]?.settings;
  const directory = config.directory ?? path.join(STORE, 'overlap-diversity', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
  await mkdir(directory, { recursive: true });
  const sourceNames = (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.mjs')).sort();
  const snapshot = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(new URL(name, import.meta.url), 'utf8')])));
  await writeFile(path.join(directory, 'sources.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  await writeFile(path.join(directory, 'queries.json'), JSON.stringify(workload, null, 2));
  const result = {
    schemaVersion: 1, startedAt: new Date().toISOString(), method: METHOD, base: BASE, index: config.index, count, configuration: config,
    sourceSnapshot: path.join(directory, 'sources.json'), sourceSnapshotHash: hash(snapshot), queryHash: hash(workload),
    indexIdentity: { uuid: settings?.index?.uuid, metadata: mapping._meta, checkpointFile, checkpoint, currentFingerprints, mappingHash: hash(mapping), canonicalMappingHash: hash(canonicalJson(mapping)), settingsHash: hash(settings), mapping, settings },
    version: (await api('')).body.version,
    nodeConfiguration: (await api('_nodes/os,jvm,process?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process')).body,
    indexStatsBefore: (await api(`${config.index}/_stats/store,docs,segments`)).body._all,
    workload: { queries: workload.length, requestedRegionCount: ANCHOR_COUNT, requestedColorFieldCount: ANCHOR_COUNT * 2,
      regionIndices: [...new Set(workload.map(item => item.regionIndex))].sort((a, b) => a - b),
      colorFields: [...new Set(workload.flatMap(item => [item.fields.coverage, item.fields.quality]))].sort(),
      selection: 'Every eighth anchor in deterministic farthest-point selection order; each anchor gets a picked vibe query and a40%target. Seeded shuffled execution.',
      normalQueryAccess: 'Each single-target search references one coverage and one quality field, plus native eligibility and ID sorting. It does not read all1024regions.' },
    limitations: [
      'Additional query-diversity diagnostic; it does not replace the shared mixed-query benchmark or erase earlier latency failures.',
      'First pass is first in this invocation, not guaranteed cold. No OS, JVM, field-data or query caches are flushed.',
      'One million deterministic mixtures of545source descriptors; these are not independent real wallpapers or new human judgments.',
      '128of1024regions sampled. These exact indexed-anchor queries exclude nearest-anchor approximation error and cover single-color vibe and40%amount only.',
      'Shared host, one node, bounded closed-loop request counts. Not an arrival-rate capacity guarantee.',
      'Node OS counters may describe the host; process CPU includes background activity. Memory samples are observations, not guaranteed peaks.',
    ],
    latencyBoundary: 'Query compilation through decoded OpenSearch response. Every error or request>=1000ms fails strict viability, including the first pass.',
    firstPass: null, profiles: [], settling: [],
  };
  const save = async () => { await writeFile(path.join(directory, 'probe.partial.json'), JSON.stringify(result, null, 2)); await rename(path.join(directory, 'probe.partial.json'), path.join(directory, 'probe.json')); };
  await save();
  console.log('OVERLAP_DIVERSITY_ARTIFACT ' + path.join(directory, 'probe.json'));
  const settle = async phase => {
    const observation = await settleSearchQueue(); result.settling.push({ phase, ...observation }); await save();
    if (!observation.settled) throw Error('Search activity did not settle before the diversity profile.');
  };
  const execute = async (item, phase, concurrency, ordinal) => {
    const started = performance.now();
    try {
      const body = buildOverlapQuery({ method: METHOD, query: item.query, limit: config.limit }); body.timeout = '950ms';
      const response = await searchIndex(config.index, body, { timeoutMs: 5000 });
      if (response.hits.length !== config.limit) throw Error(`Expected${config.limit}globally ranked hits; received${response.hits.length}.`);
      for (let i = 1; i < response.hits.length; i++) if (response.hits[i].score > response.hits[i - 1].score) throw Error('Service scores are not descending.');
      const elapsedMs = performance.now() - started;
      return { queryId: item.id, regionIndex: item.regionIndex, phase, concurrency, ordinal, elapsedMs, overOneSecond: elapsedMs >= 1000,
        serviceTookMs: response.evidence.serviceTookMs, hits: response.hits, evidence: response.evidence };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      return { queryId: item.id, regionIndex: item.regionIndex, phase, concurrency, ordinal, elapsedMs, overOneSecond: elapsedMs >= 1000, error: error.message };
    }
  };
  const measure = async ({ phase, concurrency, repetitions, firstPass = [] }) => {
    const before = await resources(), samples = [before]; let sampling = false, stopped = false, pending = Promise.resolve();
    const timer = setInterval(() => {
      if (sampling || stopped) return; sampling = true;
      pending = resources().then(sample => samples.push(sample)).catch(error => samples.push({ at: new Date().toISOString(), error: error.message })).finally(() => { sampling = false; });
    }, 1000);
    let measurement;
    try { measurement = await runWorkload({ items: workload, concurrency, repetitions, trial: (item, ordinal) => execute(item, phase, concurrency, ordinal) }); }
    finally { stopped = true; clearInterval(timer); await pending; }
    const after = await resources(); samples.push(after);
    const { trials, elapsedMs } = measurement;
    return { phase, concurrency, repetitions, elapsedMs, ...summarizeDiversityTrials(trials, firstPass), throughputPerSecond: trials.length / (elapsedMs / 1000),
      cpuMs: cpuMs(after) - cpuMs(before), clientCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000,
      peakObservedHeapBytes: Math.max(...samples.map(heapBytes)), peakObservedClientRssBytes: Math.max(...samples.map(sample => sample.clientMemory?.rss ?? 0)),
      attemptedRegionCount: new Set(trials.map(trial => trial.regionIndex)).size, successfulRegionCount: new Set(trials.filter(trial => !trial.error).map(trial => trial.regionIndex)).size,
      attemptedColorFieldCount: new Set(trials.flatMap(trial => Object.values(queriesById.get(trial.queryId).fields))).size,
      requestCountsByQuery: Object.fromEntries(workload.map(item => [item.id, trials.filter(trial => trial.queryId === item.id).length])), before, after, samples, trials };
  };
  try {
    await settle('before-first-pass');
    result.firstPass = await measure({ phase: 'first-pass-not-guaranteed-cold', concurrency: 1, repetitions: 1 }); await save();
    console.log(JSON.stringify({ ...result.firstPass, before: undefined, after: undefined, samples: undefined, trials: undefined, requestCountsByQuery: undefined }));
    for (const concurrency of config.concurrencies) {
      await settle('before-repeated-c' + concurrency);
      const profile = await measure({ phase: 'repeated', concurrency, repetitions: config.repetitions, firstPass: result.firstPass.trials });
      result.profiles.push(profile); await save();
      console.log(JSON.stringify({ ...profile, before: undefined, after: undefined, samples: undefined, trials: undefined, requestCountsByQuery: undefined }));
      if (!profile.timedRequestsViable) { result.skippedConcurrencies = config.concurrencies.filter(value => value > concurrency); break; }
    }
    await settle('after-profiles');
    const finalCount = (await api(`${config.index}/_count`)).body.count, finalMapping = (await api(`${config.index}/_mapping`)).body[config.index]?.mappings;
    if (finalCount !== count || hash(canonicalJson(finalMapping)) !== result.indexIdentity.canonicalMappingHash) throw Error('Index count or mapping changed during the diversity probe.');
    const trials = [result.firstPass, ...result.profiles].flatMap(profile => profile.trials);
    result.allRequests = summarizeDiversityTrials(trials); result.totalRequests = trials.length;
    result.attemptedRegionCount = new Set(trials.map(trial => trial.regionIndex)).size;
    result.successfulRegionCount = new Set(trials.filter(trial => !trial.error).map(trial => trial.regionIndex)).size;
    result.attemptedColorFieldCount = new Set(trials.flatMap(trial => Object.values(queriesById.get(trial.queryId).fields))).size;
    result.indexStatsAfter = (await api(`${config.index}/_stats/store,docs,segments`)).body._all;
    result.finishedAt = new Date().toISOString(); await save();
    return { directory, result };
  } catch (error) { result.interruption = { at: new Date().toISOString(), error: error.stack ?? String(error) }; await save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runOverlapDiversity(diversityConfiguration(process.argv.slice(2)));
