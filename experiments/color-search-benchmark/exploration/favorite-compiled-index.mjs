// Isolated compiled-encoder indexing experiment. Source defaults off; the
// output is byte-identical to the original encoder families at the same plan.
// Never overwrite an existing index or output
// directory. Synthetic measurements are mixed BEFORE utility precomputation.
import { writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { api, hash, safeIndexName } from './service.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { loadFavoriteScaleInputs, favoriteSyntheticDocument, FAVORITE_WORKLOAD } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot, settleFavoriteActivity } from './favorite-scale.mjs';
import { FAVORITE_UTILITY_DEFINITION, FAVORITE_UTILITY_PRESETS, createFavoriteUtilityPlan, favoriteUtilityMapping, favoriteUtilityEncodingValueCount } from './favorite-utilities.mjs';
import { FAVORITE_PRECISION_DEFINITION, favoritePrecisionMapping, favoritePrecisionEncodingValueCount } from './favorite-precision-utilities.mjs';
import { compileFavoriteUtilityEncoder } from './favorite-compiled-encoder.mjs';
import { favoriteUtilityBatcher, validateUtilityBulk } from './favorite-utility-index.mjs';
import { normalizeFavoriteUtilityMapping, sameUtilityValue } from './favorite-utility-mapping.mjs';
import { createFavoriteBulkScheduler } from './favorite-bulk-scheduler.mjs';
import { createFavoriteIndexGuard } from './favorite-index-guard.mjs';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const encodings = ['numeric', 'rank8', 'rank16', 'rankfloat', 'rank18', 'rank27'];
const legacyEncodings = ['numeric', 'rank8', 'rank16', 'rankfloat'];
const precisionEncodings = ['rank18', 'rank27'];
const atomicJson = async (filename, data) => { await writeFile(filename + '.tmp', JSON.stringify(data, null, 2)); await rename(filename + '.tmp', filename); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => hash(canonical(left)) === hash(canonical(right));
export const FAVORITE_COMPILED_BULK_RETRY = Object.freeze({ maximumAttempts: 6, backoffMs: Object.freeze([1000, 2000, 4000, 8000, 10000]),
  condition: 'Whole HTTP429 parent circuit breaker while reserving <http_request>; never partial, conflict, timeout or unknown outcomes.' });

function rejectedHttpAdmission(error) {
  // service.api exposes an exact status prefix and JSON error object. Parse the
  // complete object; its truncated error messages intentionally fail closed.
  const prefix = 'OpenSearch 429: ';
  if (typeof error?.message !== 'string' || !error.message.startsWith(prefix)) return false;
  let body;
  try { body = JSON.parse(error.message.slice(prefix.length)); } catch { return false; }
  const admission = value => value?.type === 'circuit_breaking_exception'
    && typeof value.reason === 'string' && /^\[parent\] Data too large, data for \[<http_request>\] would be /.test(value.reason);
  return admission(body) && !body.items && !body.caused_by
    && (body.root_cause === undefined || (Array.isArray(body.root_cause) && body.root_cause.every(admission)));
}

export async function sendFavoriteCompiledBulk({ index, batch, request, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onEvent = async () => {} }) {
  safeIndexName(index);
  const started = performance.now(), identity = { ids: [...batch.ids], bytes: batch.bytes, bodyHash: hash(batch.body) };
  let scheduledWaitMs = 0;
  for (let attempt = 1; attempt <= FAVORITE_COMPILED_BULK_RETRY.maximumAttempts; attempt++) {
    const record = fields => onEvent({ at: new Date().toISOString(), attempt, ...identity, ...fields });
    await record({ phase: 'started', stage: 'request' });
    const attemptStarted = performance.now(); let result;
    try { result = await request(index + '/_bulk', { method: 'POST', body: batch.body, timeoutMs: 300000 }); }
    catch (error) {
      const admissionRejected = rejectedHttpAdmission(error), retryScheduled = admissionRejected && attempt < FAVORITE_COMPILED_BULK_RETRY.maximumAttempts;
      const delayMs = retryScheduled ? FAVORITE_COMPILED_BULK_RETRY.backoffMs[attempt - 1] : 0;
      await record({ phase: 'failed', stage: 'request', elapsedMs: performance.now() - attemptStarted,
        error: String(error?.stack ?? error), admissionRejected, retryScheduled, delayMs });
      if (!retryScheduled) throw error;
      scheduledWaitMs += delayMs; await sleep(delayMs); continue;
    }
    // An HTTP200 bulk can contain accepted creates and failed items. Never
    // retry it: every item must acknowledge the same ID with status201.
    try { validateUtilityBulk(result.body, batch); }
    catch (error) {
      await record({ phase: 'failed', stage: 'acknowledgements', elapsedMs: performance.now() - attemptStarted,
        error: String(error?.stack ?? error), admissionRejected: false, retryScheduled: false, delayMs: 0,
        responseHash: hash(result.body), response: result.body });
      throw error;
    }
    await record({ phase: 'accepted', stage: 'acknowledgements', elapsedMs: performance.now() - attemptStarted,
      acknowledged: batch.ids.length, responseHash: hash(result.body) });
    return { ...result, retryEvidence: { attempts: attempt, scheduledWaitMs, totalElapsedMs: performance.now() - started } };
  }
}

function validateEncodings(selected) {
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(value => !encodings.includes(value))) throw Error('Unknown or repeated compiled utility encoding.');
  return selected;
}
export function compiledExperiment(selected) {
  validateEncodings(selected);
  const legacy = selected.some(encoding => legacyEncodings.includes(encoding));
  const precision = selected.some(encoding => precisionEncodings.includes(encoding));
  return legacy && precision ? 'strict-hue-favorite-compiled-utilities'
    : precision ? 'strict-hue-favorite-precision-utilities' : 'strict-hue-favorite-utilities';
}
export function compiledEncodingValueCount(document, encoding) {
  return precisionEncodings.includes(encoding) ? favoritePrecisionEncodingValueCount(document, encoding) : favoriteUtilityEncodingValueCount(document, encoding);
}
export function favoriteCompiledMapping(plan, { source = false, shards = 1, encodings: selected = ['numeric', 'rank18'], numericPoints = false } = {}) {
  validateEncodings(selected);
  if (typeof numericPoints !== 'boolean' || (numericPoints && !selected.includes('numeric'))) throw Error('Numeric points require a boolean flag and the numeric encoding.');
  const legacy = selected.filter(encoding => legacyEncodings.includes(encoding)), precision = selected.filter(encoding => precisionEncodings.includes(encoding));
  const mapping = legacy.length ? favoriteUtilityMapping(plan, { source, shards, encodings: legacy }) : favoritePrecisionMapping(plan, { source, shards, encodings: precision });
  if (legacy.length && precision.length) Object.assign(mapping.mappings.properties, favoritePrecisionMapping(plan, { source, shards, encodings: precision }).mappings.properties);
  if (numericPoints) for (const field of Object.values(mapping.mappings.properties.utilities.properties)) field.index = true;
  mapping.settings['index.mapping.total_fields.limit'] = Object.keys(mapping.mappings.properties).length + (selected.includes('numeric') ? plan.descriptors.length : 0) + 20;
  return mapping;
}
export function assertFavoriteCompiledMapping(actual, expected) {
  const normalize = value => {
    const mapping = normalizeFavoriteUtilityMapping(value);
    const visit = field => {
      if (field.type === 'float' && !Object.hasOwn(field, 'index')) field.index = true;
      for (const child of Object.values(field.properties ?? {})) visit(child);
      for (const child of Object.values(field.fields ?? {})) visit(child);
    };
    for (const field of Object.values(mapping.properties ?? {})) visit(field);
    return mapping;
  };
  if (!sameUtilityValue(normalize(actual), normalize(expected))) throw Error('Compiled utility mapping differs beyond allowed OpenSearch serialization defaults.');
}

export function favoriteCompiledIndexConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') { values.dryRun = true; continue; }
    const key = args[i];
    if (!['--mode', '--scope', '--count', '--index', '--directory', '--encodings', '--presets', '--base', '--source', '--samples', '--numeric-points', '--bulk-concurrency', '--disk-path', '--minimum-free-bytes', '--stop-file'].includes(key)) throw Error('Unknown utility indexing option: ' + key);
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
  const chosen = (values.encodings ?? 'numeric,rank18').split(',');
  if (!chosen.length || new Set(chosen).size !== chosen.length || chosen.some(value => !encodings.includes(value))) throw Error('Unknown or repeated utility encoding.');
  const presets = values.presets ?? 'favorite';
  if (!['favorite', 'all'].includes(presets)) throw Error('Presets must be favorite or all.');
  const base = values.base ?? process.env.COLOR_EXPLORATION_OPENSEARCH ?? `http://127.0.0.1:${mode === 'real' ? 19216 : 19217}`;
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== (mode === 'real' ? '19216' : '19217') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Use the isolated loopback OpenSearch service: real19216 or scale19217.');
  if (values.source !== undefined && !['true', 'false'].includes(values.source)) throw Error('Source must be true or false.');
  if (values['numeric-points'] !== undefined && !['true', 'false'].includes(values['numeric-points'])) throw Error('Numeric points must be true or false.');
  const numericPoints = values['numeric-points'] === 'true';
  if (numericPoints && !chosen.includes('numeric')) throw Error('Numeric points require the numeric encoding.');
  const bulkConcurrency = Number(values['bulk-concurrency'] ?? 1);
  if (!Number.isInteger(bulkConcurrency) || bulkConcurrency < 1 || bulkConcurrency > 4) throw Error('Bulk concurrency must be1..4.');
  const samples = Number(values.samples ?? 3);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1000) throw Error('Dry-run samples must be1..1000.');
  const guard = {};
  if (values['disk-path'] !== undefined || values['minimum-free-bytes'] !== undefined) {
    const minimum = Number(values['minimum-free-bytes']);
    if (!values['disk-path'] || !path.isAbsolute(values['disk-path']) || !Number.isSafeInteger(minimum) || minimum <= 0) {
      throw Error('Disk guard requires an absolute --disk-path and a positive safe-integer --minimum-free-bytes.');
    }
    guard.diskPath = path.resolve(values['disk-path']); guard.minimumFreeBytes = minimum;
  }
  if (values['stop-file'] !== undefined) {
    const stopFile = path.resolve(values['stop-file']);
    if (!path.isAbsolute(values['stop-file']) || stopFile === path.parse(stopFile).root || stopFile === path.resolve(REPOSITORY) || stopFile.startsWith(path.resolve(REPOSITORY) + path.sep)) {
      throw Error('Use an absolute --stop-file path outside the worktree.');
    }
    guard.stopFile = stopFile;
  }
  return { mode, scope, count, index, directory, base: url.origin, encodings: chosen, presets,
    source: values.source === 'true', numericPoints, seed: 99539473,
    dryRun: values.dryRun ?? false, samples, bulkConcurrency, bulkBytes: 5 * 1024 * 1024, ...guard };
}

export function compiledDocumentForOrdinal({ ordinal, config, inputs, plan, encode }) {
  const measurement = config.mode === 'real' ? inputs.documents[ordinal]
    : favoriteSyntheticDocument(inputs.documents, ordinal, { seed: config.seed, coverageFields: inputs.coverageFields ?? plan.measurementFields.filter(field => field.startsWith('cov_')) });
  if (!measurement) throw Error('Missing measured document for ordinal ' + ordinal);
  if (config.mode === 'scale' && measurement.id !== 'favorite-synthetic-' + String(ordinal).padStart(9, '0')) throw Error('Synthetic ordinal ID differs.');
  if (typeof encode !== 'function') throw Error('Compile an encoder once before generating documents.');
  return encode(measurement);
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
  const mapping = favoriteCompiledMapping(plan, { source: config.source, encodings: config.encodings, numericPoints: config.numericPoints });
  const compileStarted = performance.now(), encode = compileFavoriteUtilityEncoder(plan, { encodings: config.encodings }), compileMs = performance.now() - compileStarted;
  const identity = { bulkConcurrency: config.bulkConcurrency, compiledEncoder: encode.definition, refinementDefinition: FAVORITE_PRECISION_DEFINITION, experiment: compiledExperiment(config.encodings), version: 1, numericPoints: config.numericPoints, mode: config.mode, scope: config.scope, count: config.count,
    encodings: config.encodings, presets: config.presets, planHash: hash(plan), source, sourceHashes,
    seed: config.seed, mappingHash: hash(mapping), synthesis: 'Mix basis-point coverage and quality mass coherently before computing nonlinear favorite utility.' };
  const identityHash = hash(identity);
  mapping.mappings._meta = { bulkConcurrency: config.bulkConcurrency, experiment: identity.experiment, identityHash, planHash: identity.planHash, sourceIdentityHash: verified.identityHash,
    compiledEncoderVersion: encode.definition.version, numericPoints: config.numericPoints, utilityDefinitionVersion: FAVORITE_UTILITY_DEFINITION.version,
    precisionDefinitionVersion: FAVORITE_PRECISION_DEFINITION.version, parentUtilityDefinitionVersion: FAVORITE_PRECISION_DEFINITION.parentUtilityDefinitionVersion,
    sourceDocumentsHash: source.selectedDocumentsHash, seed: config.seed, count: config.count, mode: config.mode, scope: config.scope, encodings: config.encodings, presets: config.presets };
  return { inputs: { documents, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) }, plan, mapping, sourceSnapshot, source, identity, identityHash, encode, compileMs };
}

export async function dryRunFavoriteCompiledIndex(config) {
  const prepared = await prepare(config), { inputs, plan, encode } = prepared;
  const samples = [], totals = Object.fromEntries(config.encodings.map(encoding => [encoding, 0]));
  const started = performance.now();
  for (let ordinal = 0; ordinal < Math.min(config.samples, config.count); ordinal++) {
    const document = compiledDocumentForOrdinal({ ordinal, config, inputs, plan, encode });
    const bytes = Buffer.byteLength(JSON.stringify(document));
    for (const encoding of config.encodings) totals[encoding] += compiledEncodingValueCount(document, encoding);
    samples.push({ ordinal, id: document.id, bytes, hash: hash(document) });
  }
  return { dryRun: true, noServiceRequests: true, configuration: config, identityHash: prepared.identityHash, planHash: prepared.identity.planHash,
    source: prepared.source, utilities: plan.utilityCount, requiredMeasurements: plan.measurementFields.length, samples, encodingValueCounts: totals,
    meanDocumentBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0) / samples.length,
    documentGenerationMs: performance.now() - started, compileMs: prepared.compileMs, compiledEncoder: prepared.encode.definition, fullCapacityMeasured: false };
}

export async function runFavoriteCompiledIndex(config, { prepareIndex = prepare, request: suppliedRequest, createGuard = createFavoriteIndexGuard } = {}) {
  const prepared = await prepareIndex(config), { inputs, plan, mapping, sourceSnapshot, source, identity, identityHash, encode, compileMs } = prepared;
  await mkdir(path.dirname(config.directory), { recursive: true });
  await mkdir(config.directory); // EEXIST is intentional: never overwrite evidence.
  const request = suppliedRequest ?? ((route, options = {}) => api(route, { ...options, base: config.base }));
  const receipt = { schemaVersion: 1, experiment: identity.experiment, startedAt: new Date().toISOString(), configuration: config,
    index: config.index, base: config.base, source, identity, identityHash, compileMs, compiledEncoder: encode.definition, planHash: identity.planHash,
    utilities: plan.utilityCount, requiredMeasurements: plan.measurementFields.length,
    sourceSnapshotHash: hash(sourceSnapshot), generated: 0, indexed: 0, bulkCount: 0, bulkBytes: 0, serializedDocumentBytes: 0,
    largestDocumentBytes: 0, encodingValueCounts: Object.fromEntries(config.encodings.map(encoding => [encoding, 0])),
    bulkRetryPolicy: FAVORITE_COMPILED_BULK_RETRY, bulkAttempts: 0, bulkRetries: 0, bulkAttemptBytes: 0,
    bulkAdmissionRejections: 0, bulkRequestErrors: 0, bulkAcknowledgementFailures: 0, bulkScheduledRetryWaitMs: 0 };
  const guard = createGuard(config);
  const checkGuard = async options => {
    try { await guard.check(options); }
    finally { if (guard.enabled) receipt.indexGuard = guard.snapshot(); }
  };
  const filename = path.join(config.directory, 'index.json'), save = () => atomicJson(filename, receipt);
  await writeFile(path.join(config.directory, 'plan.json'), JSON.stringify(plan));
  await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot));
  await writeFile(path.join(config.directory, 'mapping-request.json'), JSON.stringify(mapping, null, 2));
  await writeFile(path.join(config.directory, 'retries.jsonl'), '');
  await writeFile(path.join(config.directory, 'scheduler.jsonl'), '');
  await save();
  const started = performance.now(), digest = createHash('sha256'), idDigest = createHash('sha256');
  let bulkScheduler;
  const reconcileBulkReceipt = (evidence = bulkScheduler?.snapshot()) => {
    if (!evidence) return;
    receipt.bulkScheduler = evidence;
    receipt.indexed = evidence.acknowledgedDocuments;
    receipt.bulkCount = evidence.acknowledgedBatches;
    receipt.bulkBytes = evidence.acknowledgedBytes;
  };
  try {
    receipt.before = { at: new Date().toISOString(), version: (await request('')).body,
      nodes: (await request('_nodes/stats/process,jvm,indices,thread_pool')).body };
    await checkGuard({ force: true });
    // PUT is atomic fail-if-present. Bulk actions use create, never index/update.
    receipt.creation = (await request(config.index, { method: 'PUT', body: mapping })).body;
    receipt.createdAt = new Date().toISOString();
    receipt.indexingStartedAt = receipt.createdAt;
    await save();
    const batcher = favoriteUtilityBatcher({ maximumBytes: config.bulkBytes });
    let reportAt = config.mode === 'real' ? 25 : 1000;
    bulkScheduler = createFavoriteBulkScheduler({ concurrency: config.bulkConcurrency,
      execute: async (batch, { ordinal, record, acknowledge }) => {
        const response = await sendFavoriteCompiledBulk({ index: config.index, batch, request,
          onEvent: event => {
            // This event follows every-create201 validation. Preserve definite
            // acceptance synchronously BEFORE any evidence write can reject.
            if (event.phase === 'accepted') acknowledge({ documents: event.acknowledged,
              responseHash: event.responseHash, bodyHash: event.bodyHash });
            return record(async () => {
            reconcileBulkReceipt();
            await appendFile(path.join(config.directory, 'retries.jsonl'), JSON.stringify({ index: config.index, batchOrdinal: ordinal, ...event }) + '\n');
            if (event.phase === 'started') {
              receipt.bulkAttempts++; receipt.bulkAttemptBytes += batch.bytes;
              if (event.attempt > 1) receipt.bulkRetries++;
            } else if (event.phase === 'failed') {
              if (event.stage === 'request') receipt.bulkRequestErrors++;
              else receipt.bulkAcknowledgementFailures++;
              if (event.admissionRejected) receipt.bulkAdmissionRejections++;
              receipt.bulkScheduledRetryWaitMs += event.delayMs;
            }
            await save();
            });
          } });
        return { ...response, submittedBodyHash: hash(batch.body) };
      },
      onEvent: async event => {
        // This callback and every retry event share the scheduler's one writer.
        // Ordinal means submission order, even when acknowledgements arrive out of order.
        const { result, ...evidence } = event;
        reconcileBulkReceipt();
        await appendFile(path.join(config.directory, 'scheduler.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...evidence }) + '\n');
        if (event.phase === 'accepted') {
          await appendFile(path.join(config.directory, 'batches.jsonl'), JSON.stringify({ at: new Date().toISOString(), ordinal: event.ordinal,
            documents: event.documents, firstId: event.firstId, lastId: event.lastId, bytes: event.bytes,
            bodyHash: result.submittedBodyHash, responseHash: hash(result.body), elapsedMs: result.wallMs, tookMs: result.body.took,
            retryEvidence: result.retryEvidence, oversizedSingleDocument: event.bytes > config.bulkBytes }) + '\n');
          if (receipt.indexed >= reportAt) {
            console.log(JSON.stringify({ phase: 'indexing', index: config.index, indexed: receipt.indexed, total: config.count, elapsedMs: performance.now() - started }));
            reportAt = receipt.indexed + (config.mode === 'real' ? 25 : 1000);
          }
        }
        await save();
      },
    });
    for (let ordinal = 0; ordinal < config.count; ordinal++) {
      await checkGuard();
      await bulkScheduler.waitForCapacity();
      await checkGuard();
      const document = compiledDocumentForOrdinal({ ordinal, config, inputs, plan, encode });
      const serialized = JSON.stringify(document), bytes = Buffer.byteLength(serialized);
      digest.update(serialized + '\n'); idDigest.update(document.id + '\n');
      receipt.generated++;
      receipt.serializedDocumentBytes += bytes; receipt.largestDocumentBytes = Math.max(receipt.largestDocumentBytes, bytes);
      for (const encoding of config.encodings) receipt.encodingValueCounts[encoding] += compiledEncodingValueCount(document, encoding);
      for (const batch of batcher.add(document)) { await checkGuard(); await bulkScheduler.submit(batch); }
    }
    for (const batch of batcher.finish()) { await bulkScheduler.waitForCapacity(); await checkGuard(); await bulkScheduler.submit(batch); }
    reconcileBulkReceipt(await bulkScheduler.finish());
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
    assertFavoriteCompiledMapping(observedMapping, mapping.mappings);
    receipt.indexSettings = settings.body[config.index]?.settings?.index;
    receipt.uuid = receipt.indexSettings?.uuid;
    if (!receipt.uuid) throw Error('Utility index UUID missing.');
    receipt.count = count;
    receipt.after = { at: new Date().toISOString(), mapping: actualMapping.body, settings: settings.body, stats: stats.body, segments: segments.body, nodes: nodes.body };
    if (config.source) {
      const ordinals = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
      const expected = ordinals.map(ordinal => compiledDocumentForOrdinal({ ordinal, config, inputs, plan, encode }));
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
    // Drain all submitted requests before the final receipt, even if generation failed.
    // Known201 remains counted even when its inner accepted-evidence write failed.
    if (bulkScheduler) reconcileBulkReceipt(await bulkScheduler.drain());
    receipt.error = String(error.stack ?? error); receipt.interruptedAt = new Date().toISOString(); receipt.elapsedMs = performance.now() - started;
    // Permanent filesystem failure can prevent any final external receipt.
    // Retain drained evidence on the original error and attempt the save once.
    error.bulkSchedulerEvidence = receipt.bulkScheduler;
    try { await save(); }
    catch (writeError) {
      error.finalReceiptWriteError = String(writeError.stack ?? writeError);
      console.error(JSON.stringify({ phase: 'final-receipt-write-failed', index: config.index,
        indexed: receipt.indexed, bulkScheduler: receipt.bulkScheduler, error: error.finalReceiptWriteError }));
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = favoriteCompiledIndexConfiguration(process.argv.slice(2));
  const result = config.dryRun ? await dryRunFavoriteCompiledIndex(config) : await runFavoriteCompiledIndex(config);
  console.log(JSON.stringify(config.dryRun ? result : { index: result.index, count: result.count, directory: config.directory, elapsedMs: result.elapsedMs, identityHash: result.identityHash }, null, 2));
}
