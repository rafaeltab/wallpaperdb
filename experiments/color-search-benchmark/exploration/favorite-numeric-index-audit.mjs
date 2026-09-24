// Read-only sample audit of source-disabled synthetic numeric utility indexes.
// The original encoder is the oracle; the compiled encoder is never executed.
// This verifies every numeric utility on three ordinals, not every indexed row.
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { api, hash, safeIndexName } from './service.mjs';
import { loadFavoriteScaleInputs, favoriteSyntheticDocument, FAVORITE_WORKLOAD } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan, FAVORITE_UTILITY_PRESETS, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { favoriteCompiledMapping, assertFavoriteCompiledMapping, compiledExperiment } from './favorite-compiled-index.mjs';
import { canonicalUtilityValue, sameUtilityValue } from './favorite-utility-mapping.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const base = 'http://127.0.0.1:19217';
const metadataFields = ['id', 'reference_id', 'cohort', 'partition', 'tags'];
const assert = (condition, message) => { if (!condition) throw Error(message); };
const externalDirectory = directory => {
  const resolved = path.resolve(directory);
  assert(resolved !== path.parse(resolved).root && resolved !== repository && !resolved.startsWith(repository + path.sep), 'Keep audit artifacts in a new directory outside the worktree.');
  return resolved;
};

export function favoriteNumericIndexAuditConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    assert(['--index', '--receipt', '--directory'].includes(key) && value && !value.startsWith('--'), 'Use --index scratch-index --receipt completed-index.json --directory new-external-directory.');
    assert(!Object.hasOwn(values, key.slice(2)), 'Repeated audit option: ' + key);
    values[key.slice(2)] = value;
  }
  assert(values.index && values.receipt && values.directory, 'Provide --index, --receipt and --directory.');
  return { index: safeIndexName(values.index), receipt: path.resolve(values.receipt), directory: externalDirectory(values.directory) };
}

function recreatePlan(config) {
  const presets = config.presets === 'favorite' ? [{}] : FAVORITE_UTILITY_PRESETS.qualityInfluence.flatMap(qualityInfluence =>
    FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
  return createFavoriteUtilityPlan(config.scope === 'full' ? { presets }
    : { requests: presets.flatMap(parameters => FAVORITE_WORKLOAD.map(item => ({ query: item.query, parameters }))) });
}

export function validateFavoriteNumericAuditArtifacts({ receipt, plan, mapping, snapshot }, { index }) {
  safeIndexName(index);
  const config = receipt?.configuration;
  assert(receipt?.schemaVersion === 1 && config?.mode === 'scale' && config.source === false
    && [100000, 1000000].includes(config.count) && receipt.indexed === config.count && receipt.count === config.count
    && typeof receipt.finishedAt === 'string' && Number.isFinite(Date.parse(receipt.finishedAt)) && !receipt.error && !receipt.interruptedAt,
  'Audit requires a completed source:false scale receipt with all100000 or1000000 documents.');
  assert(receipt.index === index && config.index === index && receipt.base === base && config.base === base,
    'Receipt index/base differs; audits only read the isolated scale service on19217.');
  assert(['full', 'projection'].includes(config.scope) && ['favorite', 'all'].includes(config.presets)
    && typeof config.numericPoints === 'boolean' && config.seed === 99539473
    && Array.isArray(config.encodings) && config.encodings.includes('numeric'), 'Receipt scope, presets, seed or numeric encoding is invalid.');
  const experiment = compiledExperiment(config.encodings);
  assert(receipt.experiment === experiment && receipt.identity?.experiment === experiment
    && receipt.compiledEncoder?.version === 1 && receipt.identity.compiledEncoder?.version === 1,
  'Receipt does not identify the compiled utility encoder version1.');
  assert(hash(receipt.identity) === receipt.identityHash && sameUtilityValue(receipt.source, receipt.identity.source), 'Receipt identity or source changed.');
  for (const key of ['mode', 'scope', 'count', 'presets', 'numericPoints', 'seed', 'encodings']) {
    assert(sameUtilityValue(receipt.identity[key], config[key]), 'Receipt configuration differs from identity: ' + key);
  }
  assert(plan?.scope === config.scope && plan.utilityCount === plan.descriptors?.length && plan.utilityCount === receipt.utilities
    && hash(plan) === receipt.planHash && receipt.identity.planHash === receipt.planHash, 'Saved utility plan changed.');
  assert(snapshot && Object.keys(snapshot).length > 0 && Object.values(snapshot).every(source => typeof source === 'string')
    && hash(snapshot) === receipt.sourceSnapshotHash
    && sameUtilityValue(Object.fromEntries(Object.entries(snapshot).map(([name, source]) => [name, hash(source)])), receipt.identity.sourceHashes), 'Saved indexing source snapshot changed.');
  const { _meta, ...plainMapping } = mapping?.mappings ?? {};
  assert(hash({ ...mapping, mappings: plainMapping }) === receipt.identity.mappingHash, 'Saved mapping request changed.');
  assert(_meta?.identityHash === receipt.identityHash && _meta.planHash === receipt.planHash && _meta.experiment === experiment
    && _meta.sourceDocumentsHash === receipt.source.selectedDocumentsHash && _meta.utilityDefinitionVersion === 2
    && _meta.compiledEncoderVersion === 1 && typeof _meta.sourceIdentityHash === 'string' && _meta.sourceIdentityHash,
  'Mapping metadata identity differs.');
  for (const key of ['mode', 'scope', 'count', 'presets', 'numericPoints', 'seed', 'encodings']) {
    assert(sameUtilityValue(_meta[key], config[key]), 'Mapping metadata differs from receipt: ' + key);
  }
  const recomputed = favoriteCompiledMapping(plan, { source: false, encodings: config.encodings, numericPoints: config.numericPoints });
  assert(sameUtilityValue(recomputed, { ...mapping, mappings: plainMapping }), 'Current mapping definition differs from the indexing request.');
  assert(receipt.uuid && receipt.after?.settings?.[index]?.settings?.index?.uuid === receipt.uuid, 'Completed receipt UUID is missing or inconsistent.');
  assertFavoriteCompiledMapping(receipt.after?.mapping?.[index]?.mappings, mapping.mappings);
}

export function favoriteNumericAuditBatches(samples) {
  assert(Array.isArray(samples) && samples.length && new Set(samples.map(doc => doc.id)).size === samples.length, 'Audit samples require unique IDs.');
  const keys = Object.keys(samples[0].utilities ?? {}).sort();
  assert(keys.length && samples.every(doc => sameUtilityValue(Object.keys(doc.utilities ?? {}).sort(), keys)), 'Audit samples must contain the same nonempty utility bank.');
  const batches = [];
  for (let start = 0; start < keys.length; start += 80 - metadataFields.length) {
    const utilityFields = keys.slice(start, start + 80 - metadataFields.length).map(key => 'utilities.' + key);
    batches.push({ ordinal: batches.length, utilityFields, body: { size: samples.length, _source: false, stored_fields: '_none_',
      docvalue_fields: [...metadataFields, ...utilityFields], track_total_hits: true, track_scores: false,
      query: { ids: { values: samples.map(doc => doc.id) } }, sort: [{ id: 'asc' }], timeout: '30s' } });
  }
  return batches;
}

export function validateFavoriteNumericAuditBatch(response, batch, samples, index) {
  assert(response?.timed_out === false && response._shards?.failed === 0, 'Audit search timed out or had shard failures.');
  assert(response.hits?.total?.relation === 'eq' && response.hits.total.value === samples.length
    && response.hits.hits?.length === samples.length, 'Audit search must return every requested sample exactly once.');
  const expected = new Map(samples.map(doc => [doc.id, doc])), seen = new Set();
  for (const hit of response.hits.hits) {
    const ids = hit.fields?.id, id = ids?.[0], document = expected.get(id);
    assert(Array.isArray(ids) && ids.length === 1 && document && !seen.has(id)
      && (hit._index === undefined || hit._index === index) && !Object.hasOwn(hit, '_source'), 'Unexpected, duplicate or source-bearing audit hit.');
    seen.add(id);
    for (const field of metadataFields) {
      const actual = hit.fields[field] ?? [], value = document[field];
      const wanted = field === 'tags' ? [...new Set(value)].sort() : [value];
      assert(Array.isArray(actual) && sameUtilityValue(actual, wanted), `Audit metadata differs for ${id}: ${field}`);
    }
    for (const field of batch.utilityFields) {
      const actual = hit.fields[field], wanted = document.utilities[field.slice('utilities.'.length)];
      assert(Array.isArray(actual) && actual.length === 1 && Number.isFinite(actual[0]) && actual[0] >= 0 && actual[0] <= 1
        && Number.isFinite(wanted) && Math.fround(actual[0]) === wanted, `Indexed numeric utility differs for ${id}: ${field}`);
    }
  }
  return { samples: seen.size, valuesCompared: seen.size * batch.utilityFields.length };
}

async function readArtifactFiles(receiptFilename) {
  const parent = path.dirname(receiptFilename), files = {};
  for (const [name, filename] of Object.entries({ receipt: receiptFilename, plan: path.join(parent, 'plan.json'),
    mapping: path.join(parent, 'mapping-request.json'), snapshot: path.join(parent, 'source-snapshot.json') })) {
    const bytes = await readFile(filename);
    files[name] = { filename, bytes, hash: hash(bytes), data: JSON.parse(bytes) };
  }
  return files;
}

async function captureState(index, request) {
  const routes = { mapping: '/_mapping', settings: '/_settings', count: '/_count', statistics: '/_stats/docs,indexing' };
  const state = {};
  // Keep the audit's service traffic small and sequential; preserve every raw response.
  for (const [name, suffix] of Object.entries(routes)) state[name] = (await request(index + suffix, { timeoutMs: 30000 })).body;
  return state;
}

function validateState(state, receipt, mapping) {
  const index = receipt.index, uuid = state.settings?.[index]?.settings?.index?.uuid;
  assert(uuid === receipt.uuid, 'Index UUID changed since the completed receipt.');
  assert(state.count?.count === receipt.count && state.count._shards?.failed === 0, 'Index count differs or count request had shard failures.');
  assertFavoriteCompiledMapping(state.mapping?.[index]?.mappings, mapping.mappings);
  const statistics = state.statistics?.indices?.[index], primaries = statistics?.primaries;
  const generation = [primaries?.docs?.count, primaries?.docs?.deleted, primaries?.indexing?.index_total, primaries?.indexing?.delete_total];
  assert(statistics?.uuid === uuid && generation.every(value => Number.isSafeInteger(value) && value >= 0)
    && generation[0] === receipt.count, 'Index mutation counters are missing or inconsistent.');
  return { uuid, count: receipt.count, generation, mapping: state.mapping, settings: state.settings };
}

export async function runFavoriteNumericIndexAudit(config, {
  request = (route, options) => api(route, { ...options, base }),
  loadInputs = loadFavoriteScaleInputs, sourceSnapshot = favoriteSourceSnapshot,
} = {}) {
  safeIndexName(config.index);
  const directory = externalDirectory(config.directory), files = await readArtifactFiles(path.resolve(config.receipt));
  const { receipt, plan, mapping, snapshot } = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, file.data]));
  validateFavoriteNumericAuditArtifacts({ receipt, plan, mapping, snapshot }, config);
  const indexingEntry = new URL('./favorite-compiled-index.mjs', import.meta.url);
  assert(hash(await sourceSnapshot(indexingEntry)) === receipt.sourceSnapshotHash, 'Indexing source graph changed since the receipt.');
  assert(hash(recreatePlan(receipt.configuration)) === receipt.planHash, 'Current complete preset plan differs from the indexed plan.');
  const inputs = await loadInputs({ scope: 'full', bucketCount: 256 });
  const source = { ...inputs.source, selectedCount: inputs.documents.length, selectedDocumentsHash: hash(inputs.documents),
    selectedIdsHash: hash(inputs.documents.map(doc => doc.id)), selection: '523 real source images; fixtures excluded from synthetic mixtures' };
  assert(inputs.documents.length === 523 && new Set(inputs.documents.map(doc => doc.id)).size === 523
    && sameUtilityValue(source, receipt.source) && inputs.identityHash === mapping.mappings._meta.sourceIdentityHash, 'Verified synthetic source measurements differ from the receipt.');
  const ordinals = [0, Math.floor((receipt.count - 1) / 2), receipt.count - 1];
  const samples = ordinals.map(ordinal => toFavoriteUtilityDocument(favoriteSyntheticDocument(inputs.documents, ordinal,
    { seed: receipt.configuration.seed, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) }), plan, { encodings: ['numeric'] }));
  const batches = favoriteNumericAuditBatches(samples), auditSources = await sourceSnapshot(import.meta.url);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory); // Never overwrite an earlier success or failure.
  const save = (name, data) => writeFile(path.join(directory, name), JSON.stringify(data, null, 2), { flag: 'wx' });
  await save('source-snapshot.json', auditSources);
  await save('expected-samples.json', samples);
  for (const [name, file] of Object.entries(files)) await writeFile(path.join(directory, 'parent-' + name + '.json'), file.bytes, { flag: 'wx' });
  await save('inputs.json', { configuration: config, parentFiles: Object.fromEntries(Object.entries(files).map(([name, file]) => [name,
    { filename: file.filename, hash: file.hash, archived: 'parent-' + name + '.json' }])),
    identityHash: receipt.identityHash, planHash: receipt.planHash, indexingSourceSnapshotHash: receipt.sourceSnapshotHash,
    auditSourceSnapshotHash: hash(auditSources), sourceIdentityHash: inputs.identityHash, sampleOrdinals: ordinals, numericPoints: receipt.configuration.numericPoints });
  await writeFile(path.join(directory, 'batches.jsonl'), '', { flag: 'wx' });
  const result = { schemaVersion: 1, experiment: 'favorite-numeric-index-audit', startedAt: new Date().toISOString(), verified: false, readOnly: true,
    index: config.index, base, uuid: receipt.uuid, count: receipt.count, scope: receipt.configuration.scope, presets: receipt.configuration.presets,
    numericPoints: receipt.configuration.numericPoints, receiptHash: files.receipt.hash, identityHash: receipt.identityHash, planHash: receipt.planHash,
    sourceSnapshotHash: hash(auditSources), parentSourceSnapshotHash: receipt.sourceSnapshotHash,
    limitation: 'Every numeric utility and metadata value is compared on three deterministic synthetic ordinals; this is not an all-document value audit.',
    sampleAudit: { ordinals, ids: samples.map(doc => doc.id), utilitiesPerSample: plan.utilityCount, valuesHash: hash(samples),
      valuesCompared: 0, completedBatches: 0, encoder: 'original toFavoriteUtilityDocument; numeric only', verified: false } };
  const started = performance.now();
  let failure, beforeFingerprint;
  try {
    const before = await captureState(config.index, request);
    await save('index-before.json', before);
    beforeFingerprint = validateState(before, receipt, mapping);
    result.beforeFingerprintHash = hash(canonicalUtilityValue(beforeFingerprint));
    for (const batch of batches) {
      const response = await request(config.index + '/_search?request_cache=false', { method: 'POST', body: batch.body, timeoutMs: 35000 });
      const record = { ordinal: batch.ordinal, at: new Date().toISOString(), utilityFields: batch.utilityFields,
        request: batch.body, requestHash: hash(batch.body), response: response.body, responseHash: hash(response.body), httpMs: response.wallMs };
      await appendFile(path.join(directory, 'batches.jsonl'), JSON.stringify(record) + '\n');
      const checked = validateFavoriteNumericAuditBatch(response.body, batch, samples, config.index);
      result.sampleAudit.valuesCompared += checked.valuesCompared;
      result.sampleAudit.completedBatches++;
    }
    assert(result.sampleAudit.valuesCompared === samples.length * plan.utilityCount, 'Not every numeric utility was compared.');
    result.sampleAudit.verified = true;
  } catch (error) { failure = error; }
  try {
    const after = await captureState(config.index, request);
    await save('index-after.json', after);
    const fingerprint = validateState(after, receipt, mapping);
    result.afterFingerprintHash = hash(canonicalUtilityValue(fingerprint));
    assert(beforeFingerprint && sameUtilityValue(beforeFingerprint, fingerprint), 'Index changed during the audit; concurrent mutation invalidates the evidence.');
    for (const file of Object.values(files)) assert(hash(await readFile(file.filename)) === file.hash, 'Parent artifact changed during audit: ' + file.filename);
    assert(hash(await sourceSnapshot(indexingEntry)) === receipt.sourceSnapshotHash
      && hash(await sourceSnapshot(import.meta.url)) === hash(auditSources), 'Source graph changed during the audit.');
  } catch (error) { failure ??= error; }
  result.elapsedMs = performance.now() - started;
  result.finishedAt = new Date().toISOString();
  result.verified = !failure && result.sampleAudit.verified;
  if (failure) result.error = String(failure.stack ?? failure);
  await save('audit.json', result);
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoriteNumericIndexAudit(favoriteNumericIndexAuditConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ index: result.index, count: result.count, verified: result.verified, valuesCompared: result.sampleAudit.valuesCompared, elapsedMs: result.elapsedMs }));
}
