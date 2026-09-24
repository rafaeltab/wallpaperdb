// Isolated experiment indexing only. Never overwrite an existing index or output
// directory. Synthetic measurements are mixed BEFORE utility precomputation.
import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { api, hash, safeIndexName } from './service.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { loadFavoriteScaleInputs, favoriteSyntheticDocument, FAVORITE_WORKLOAD } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot, settleFavoriteActivity } from './favorite-scale.mjs';
import { FAVORITE_UTILITY_DEFINITION, FAVORITE_UTILITY_PRESETS, createFavoriteUtilityPlan, favoriteUtilityMapping, toFavoriteUtilityDocument, favoriteUtilityEncodingValueCount } from './favorite-utilities.mjs';
import { assertFavoriteUtilityMapping } from './favorite-utility-mapping.mjs';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const encodings = ['numeric', 'rank8', 'rank16', 'rankfloat'];
const atomicJson = async (filename, data) => { await writeFile(filename + '.tmp', JSON.stringify(data, null, 2)); await rename(filename + '.tmp', filename); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));

export function favoriteUtilityIndexConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') { values.dryRun = true; continue; }
    const key = args[i];
    if (!['--mode', '--scope', '--count', '--index', '--directory', '--encodings', '--presets', '--base', '--source', '--samples'].includes(key)) throw Error('Unknown utility indexing option: ' + key);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Missing utility indexing option: ' + key);
    values[key.slice(2)] = value;
  }
  const mode = values.mode ?? 'real', scope = values.scope ?? (mode === 'real' ? 'full' : 'projection');
  if (!['real', 'scale'].includes(mode) || !['full', 'projection'].includes(scope)) throw Error('Use mode real|scale and scope full|projection.');
  const count = values.count === undefined ? (mode === 'real' ? 545 : 100000) : Number(values.count);
  if (mode === 'real' ? count !== 545 : ![100000, 1000000].includes(count)) throw Error('Real indexes retain all545 originals; scale count must be100000 or1000000.');
  if (!values.index || !values.directory) throw Error('Provide a new --index and external --directory.');
  const index = safeIndexName(values.index), directory = path.resolve(values.directory);
  if (directory === path.parse(directory).root || directory === path.resolve(REPOSITORY) || directory.startsWith(path.resolve(REPOSITORY) + path.sep)) throw Error('Keep utility artifacts outside the worktree in a new experiment directory.');
  const chosen = (values.encodings ?? encodings.join(',')).split(',');
  if (!chosen.length || new Set(chosen).size !== chosen.length || chosen.some(value => !encodings.includes(value))) throw Error('Unknown or repeated utility encoding.');
  const presets = values.presets ?? 'favorite';
  if (!['favorite', 'all'].includes(presets)) throw Error('Presets must be favorite or all.');
  const base = values.base ?? process.env.COLOR_EXPLORATION_OPENSEARCH ?? `http://127.0.0.1:${mode === 'real' ? 19216 : 19217}`;
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== (mode === 'real' ? '19216' : '19217') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Use the isolated loopback OpenSearch service: real19216 or scale19217.');
  if (values.source !== undefined && !['true', 'false'].includes(values.source)) throw Error('Source must be true or false.');
  const samples = Number(values.samples ?? 3);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1000) throw Error('Dry-run samples must be1..1000.');
  return { mode, scope, count, index, directory, base: url.origin, encodings: chosen, presets,
    source: values.source === undefined ? scope === 'full' : values.source === 'true', seed: 99539473,
    dryRun: values.dryRun ?? false, samples, bulkBytes: 5 * 1024 * 1024 };
}

export function favoriteUtilityBatcher({ maximumBytes = 5 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw Error('Bulk byte limit must be positive.');
  let rows = [], ids = [], bytes = 0;
  const take = () => { const batch = { body: rows.join(''), ids, bytes }; rows = []; ids = []; bytes = 0; return batch; };
  return {
    add(document) {
      const row = JSON.stringify({ create: { _id: document.id } }) + '\n' + JSON.stringify(document) + '\n';
      const size = Buffer.byteLength(row), ready = [];
      if (bytes && bytes + size > maximumBytes) ready.push(take());
      rows.push(row); ids.push(document.id); bytes += size;
      if (bytes >= maximumBytes) ready.push(take());
      return ready;
    },
    finish() { return bytes ? [take()] : []; },
  };
}

export function validateUtilityBulk(response, batch) {
  if (response.errors || response.items?.length !== batch.ids.length) throw Error('Utility bulk has errors or incomplete acknowledgements: ' + JSON.stringify(response.items?.filter(item => item.create?.error).slice(0, 3) ?? response).slice(0, 1500));
  for (let i = 0; i < batch.ids.length; i++) {
    const item = response.items[i].create;
    if (!item || item.error || item.status !== 201 || item._id !== batch.ids[i]) throw Error('Utility bulk create acknowledgement differs at offset ' + i + ': ' + JSON.stringify(item));
  }
  return batch.ids.length;
}

export function utilityDocumentForOrdinal({ ordinal, config, inputs, plan }) {
  const measurement = config.mode === 'real' ? inputs.documents[ordinal]
    : favoriteSyntheticDocument(inputs.documents, ordinal, { seed: config.seed, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) });
  if (!measurement) throw Error('Missing measured document for ordinal ' + ordinal);
  if (config.mode === 'scale' && measurement.id !== 'favorite-synthetic-' + String(ordinal).padStart(9, '0')) throw Error('Synthetic ordinal ID differs.');
  return toFavoriteUtilityDocument(measurement, plan, { encodings: config.encodings });
}

async function prepare(config) {
  const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 });
  let documents = verified.documents;
  if (config.mode === 'real') {
    documents = await loadHueDocuments(256);
    const receipt = verified.source.receipts.find(value => value.bucketCount === 256);
    if (documents.length !== 545 || new Set(documents.map(doc => doc.id)).size !== 545 || hash(documents.map(document => ({ id: document.id, hash: hash(document) }))) !== receipt.valuesHash) throw Error('Real utility sources differ from the verified all545 receipt.');
  }
  const presets = config.presets === 'favorite' ? [{}] : FAVORITE_UTILITY_PRESETS.qualityInfluence.flatMap(qualityInfluence => FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
  const plan = createFavoriteUtilityPlan(config.scope === 'full' ? { presets }
    : { requests: presets.flatMap(parameters => FAVORITE_WORKLOAD.map(item => ({ query: item.query, parameters }))) });
  const sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  const sourceHashes = Object.fromEntries(Object.entries(sourceSnapshot).map(([name, source]) => [name, hash(source)]));
  const source = { ...verified.source, selectedCount: documents.length, selectedDocumentsHash: hash(documents), selectedIdsHash: hash(documents.map(doc => doc.id)),
    selection: config.mode === 'real' ? 'all545 original images including22 controlled fixtures' : '523 real source images; fixtures excluded from synthetic mixtures' };
  const mapping = favoriteUtilityMapping(plan, { source: config.source, encodings: config.encodings });
  const identity = { experiment: 'strict-hue-favorite-utilities', version: 1, mode: config.mode, scope: config.scope, count: config.count,
    encodings: config.encodings, presets: config.presets, planHash: hash(plan), source, sourceHashes,
    seed: config.seed, mappingHash: hash(mapping), synthesis: 'Mix basis-point coverage and quality mass coherently before computing nonlinear favorite utility.' };
  const identityHash = hash(identity);
  mapping.mappings._meta = { experiment: identity.experiment, identityHash, planHash: identity.planHash, sourceIdentityHash: verified.identityHash,
    utilityDefinitionVersion: FAVORITE_UTILITY_DEFINITION.version,
    sourceDocumentsHash: source.selectedDocumentsHash, seed: config.seed, count: config.count, mode: config.mode, scope: config.scope, encodings: config.encodings, presets: config.presets };
  return { inputs: { documents }, plan, mapping, sourceSnapshot, source, identity, identityHash };
}

export async function dryRunFavoriteUtilityIndex(config) {
  const prepared = await prepare(config), { inputs, plan } = prepared;
  const samples = [], totals = Object.fromEntries(config.encodings.map(encoding => [encoding, 0]));
  const started = performance.now();
  for (let ordinal = 0; ordinal < Math.min(config.samples, config.count); ordinal++) {
    const document = utilityDocumentForOrdinal({ ordinal, config, inputs, plan });
    const bytes = Buffer.byteLength(JSON.stringify(document));
    for (const encoding of config.encodings) totals[encoding] += favoriteUtilityEncodingValueCount(document, encoding);
    samples.push({ ordinal, id: document.id, bytes, hash: hash(document) });
  }
  return { dryRun: true, noServiceRequests: true, configuration: config, identityHash: prepared.identityHash, planHash: prepared.identity.planHash,
    source: prepared.source, utilities: plan.utilityCount, requiredMeasurements: plan.measurementFields.length, samples, encodingValueCounts: totals,
    meanDocumentBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0) / samples.length,
    documentGenerationMs: performance.now() - started, fullCapacityMeasured: false };
}

export async function runFavoriteUtilityIndex(config) {
  const prepared = await prepare(config), { inputs, plan, mapping, sourceSnapshot, source, identity, identityHash } = prepared;
  await mkdir(path.dirname(config.directory), { recursive: true });
  await mkdir(config.directory); // EEXIST is intentional: never overwrite evidence.
  const request = (route, options = {}) => api(route, { ...options, base: config.base });
  const receipt = { schemaVersion: 1, experiment: identity.experiment, startedAt: new Date().toISOString(), configuration: config,
    index: config.index, base: config.base, source, identity, identityHash, planHash: identity.planHash,
    utilities: plan.utilityCount, requiredMeasurements: plan.measurementFields.length,
    sourceSnapshotHash: hash(sourceSnapshot), indexed: 0, bulkCount: 0, bulkBytes: 0, serializedDocumentBytes: 0,
    largestDocumentBytes: 0, encodingValueCounts: Object.fromEntries(config.encodings.map(encoding => [encoding, 0])) };
  const filename = path.join(config.directory, 'index.json'), save = () => atomicJson(filename, receipt);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan));
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot));
  await writeFile(path.join(config.directory, 'mapping-request.json'), JSON.stringify(mapping, null, 2));
  await save();
  const started = performance.now(), digest = createHash('sha256'), idDigest = createHash('sha256');
  try {
    receipt.before = { at: new Date().toISOString(), version: (await request('')).body,
      nodes: (await request('_nodes/stats/process,jvm,indices,thread_pool')).body };
    // PUT is atomic fail-if-present. Bulk actions use create, never index/update.
    receipt.creation = (await request(config.index, { method: 'PUT', body: mapping })).body;
    receipt.createdAt = new Date().toISOString();
    receipt.indexingStartedAt = receipt.createdAt;
    await save();
    const batcher = favoriteUtilityBatcher({ maximumBytes: config.bulkBytes });
    let reportAt = config.mode === 'real' ? 25 : 1000;
    const send = async batch => {
      const result = await request(config.index + '/_bulk', { method: 'POST', body: batch.body, timeoutMs: 300000 });
      validateUtilityBulk(result.body, batch);
      receipt.indexed += batch.ids.length; receipt.bulkCount++; receipt.bulkBytes += batch.bytes;
      await appendFile(path.join(config.directory, 'batches.jsonl'), JSON.stringify({ at: new Date().toISOString(), ordinal: receipt.bulkCount,
        documents: batch.ids.length, firstId: batch.ids[0], lastId: batch.ids.at(-1), bytes: batch.bytes, bodyHash: hash(batch.body),
        responseHash: hash(result.body), elapsedMs: result.wallMs, tookMs: result.body.took, oversizedSingleDocument: batch.bytes > config.bulkBytes }) + '\n');
      await save();
      if (receipt.indexed >= reportAt) {
        console.log(JSON.stringify({ phase: 'indexing', index: config.index, indexed: receipt.indexed, total: config.count, elapsedMs: performance.now() - started }));
        reportAt = receipt.indexed + (config.mode === 'real' ? 25 : 1000);
      }
    };
    for (let ordinal = 0; ordinal < config.count; ordinal++) {
      const document = utilityDocumentForOrdinal({ ordinal, config, inputs, plan });
      const serialized = JSON.stringify(document), bytes = Buffer.byteLength(serialized);
      digest.update(serialized + '\n'); idDigest.update(document.id + '\n');
      receipt.serializedDocumentBytes += bytes; receipt.largestDocumentBytes = Math.max(receipt.largestDocumentBytes, bytes);
      for (const encoding of config.encodings) receipt.encodingValueCounts[encoding] += favoriteUtilityEncodingValueCount(document, encoding);
      for (const batch of batcher.add(document)) await send(batch);
    }
    for (const batch of batcher.finish()) await send(batch);
    receipt.indexingFinishedAt = new Date().toISOString();
    receipt.indexingMs = performance.now() - started;
    receipt.documentsHash = digest.digest('hex'); receipt.orderedIdsHash = idDigest.digest('hex');
    receipt.duplicateIdCheck = config.mode === 'real' ? 'all545 measured source IDs verified unique; every create acknowledged201'
      : 'ID checked against unique zero-padded ordinal for every generated document; every create acknowledged201';
    await save();
    receipt.flush = (await request(config.index + '/_flush?wait_if_ongoing=true', { method: 'POST', timeoutMs: 300000 })).body;
    receipt.refresh = (await request(config.index + '/_refresh', { method: 'POST' })).body;
    const count = (await request(config.index + '/_count')).body.count;
    if (count !== config.count || receipt.indexed !== config.count) throw Error('Utility index count differs from requested complete corpus.');
    const sampleActivity = async () => (await request('_nodes/stats/thread_pool,indices?filter_path=nodes.*.thread_pool.search,nodes.*.thread_pool.search_throttled,nodes.*.indices.search.query_current,nodes.*.indices.search.fetch_current,nodes.*.indices.merges.current')).body;
    receipt.settling = await settleFavoriteActivity({ sample: sampleActivity, timeoutMs: 600000 });
    if (!receipt.settling.settled) throw Error('Utility indexing completed but merge/search activity did not settle within600s.');
    const [actualMapping, settings, stats, segments, nodes] = await Promise.all([
      request(config.index + '/_mapping'), request(config.index + '/_settings'), request(config.index + '/_stats/store,docs,segments,merge,translog'),
      request(config.index + '/_segments'), request('_nodes/stats/process,jvm,indices,thread_pool'),
    ]);
    const observedMapping = actualMapping.body[config.index]?.mappings;
    assertFavoriteUtilityMapping(observedMapping, mapping.mappings);
    receipt.indexSettings = settings.body[config.index]?.settings?.index;
    receipt.uuid = receipt.indexSettings?.uuid;
    if (!receipt.uuid) throw Error('Utility index UUID missing.');
    receipt.count = count;
    receipt.after = { at: new Date().toISOString(), mapping: actualMapping.body, settings: settings.body, stats: stats.body, segments: segments.body, nodes: nodes.body };
    if (config.source) {
      const ordinals = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
      const expected = ordinals.map(ordinal => utilityDocumentForOrdinal({ ordinal, config, inputs, plan }));
      const actual = (await request(config.index + '/_mget', { method: 'POST', body: { ids: expected.map(doc => doc.id) } })).body.docs;
      if (actual.length !== expected.length || actual.some((doc, i) => !doc.found || doc._id !== expected[i].id || !same(doc._source, expected[i]))) throw Error('Stored utility sample values differ.');
      receipt.sampleAudit = { ordinals, valuesHash: hash(expected), verified: true };
    }
    const currentSources = await favoriteSourceSnapshot(import.meta.url);
    if (hash(currentSources) !== receipt.sourceSnapshotHash) throw Error('Utility indexing sources changed during generation; receipt cannot be finalized.');
    receipt.finishedAt = new Date().toISOString(); receipt.elapsedMs = performance.now() - started;
    await save();
    return receipt;
  } catch (error) {
    receipt.error = String(error.stack ?? error); receipt.interruptedAt = new Date().toISOString(); receipt.elapsedMs = performance.now() - started;
    await save(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = favoriteUtilityIndexConfiguration(process.argv.slice(2));
  const result = config.dryRun ? await dryRunFavoriteUtilityIndex(config) : await runFavoriteUtilityIndex(config);
  console.log(JSON.stringify(config.dryRun ? result : { index: result.index, count: result.count, directory: config.directory, elapsedMs: result.elapsedMs, identityHash: result.identityHash }, null, 2));
}
