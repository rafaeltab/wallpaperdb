import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash } from './service.mjs';
import { FAVORITE_WORKLOAD, favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';
import { createFavoriteUtilityPlan, FAVORITE_UTILITY_PRESETS, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { favoriteCompiledMapping } from './favorite-compiled-index.mjs';
import { favoriteNumericIndexAuditConfiguration, validateFavoriteNumericAuditArtifacts,
  favoriteNumericAuditBatches, validateFavoriteNumericAuditBatch, runFavoriteNumericIndexAudit } from './favorite-numeric-index-audit.mjs';

const index = 'color-exploration-numeric-audit-test';
const presets = FAVORITE_UTILITY_PRESETS.qualityInfluence.flatMap(qualityInfluence =>
  FAVORITE_UTILITY_PRESETS.cutoffBlendExponent.map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
const plan = createFavoriteUtilityPlan({ requests: presets.flatMap(parameters => FAVORITE_WORKLOAD.map(item => ({ query: item.query, parameters }))) });
const snapshot = { 'exploration/favorite-compiled-index.mjs': 'frozen indexing source' };

function fixtures({ numericPoints = false, count = 100000 } = {}) {
  const documents = Array.from({ length: 523 }, (_, i) => ({ id: 'source-' + i,
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? (i * 43) % 10001 : Math.fround((i % 20) / 20)])) }));
  const verified = { documents, source: { sourceCount: 523, originalCount: 545 }, identityHash: hash('verified-measurements') };
  const source = { ...verified.source, selectedCount: 523, selectedDocumentsHash: hash(documents), selectedIdsHash: hash(documents.map(doc => doc.id)),
    selection: '523 real source images; fixtures excluded from synthetic mixtures' };
  const configuration = { mode: 'scale', scope: 'projection', count, index, base: 'http://127.0.0.1:19217',
    encodings: ['numeric'], presets: 'all', source: false, numericPoints, seed: 99539473 };
  const mapping = favoriteCompiledMapping(plan, configuration);
  const identity = { experiment: 'strict-hue-favorite-utilities', compiledEncoder: { version: 1 }, version: 1,
    ...Object.fromEntries(['numericPoints', 'mode', 'scope', 'count', 'encodings', 'presets', 'seed'].map(key => [key, configuration[key]])),
    planHash: hash(plan), mappingHash: hash(mapping), source, sourceHashes: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, hash(value)])) };
  const identityHash = hash(identity);
  mapping.mappings._meta = { experiment: identity.experiment, identityHash, planHash: hash(plan), sourceIdentityHash: verified.identityHash,
    compiledEncoderVersion: 1, numericPoints, utilityDefinitionVersion: 2, precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2,
    sourceDocumentsHash: source.selectedDocumentsHash, seed: configuration.seed, count, mode: 'scale', scope: 'projection', encodings: ['numeric'], presets: 'all' };
  const receipt = { schemaVersion: 1, experiment: identity.experiment, configuration, index, base: configuration.base, source, identity, identityHash,
    compiledEncoder: { version: 1 }, planHash: hash(plan), utilities: plan.utilityCount, sourceSnapshotHash: hash(snapshot), indexed: count, count,
    uuid: 'original-uuid', finishedAt: '2026-09-23T00:00:00.000Z',
    after: { mapping: { [index]: { mappings: mapping.mappings } }, settings: { [index]: { settings: { index: { uuid: 'original-uuid' } } } } } };
  return { receipt, plan, mapping, snapshot, verified };
}

test('audit CLI requires an explicit scratch index, receipt and new external directory', () => {
  const args = ['--index', index, '--receipt', '/tmp/index.json', '--directory', '/tmp/new-audit'];
  const config = favoriteNumericIndexAuditConfiguration(args);
  assert.equal(config.index, index);
  assert.equal(config.receipt, '/tmp/index.json');
  for (const suffix of [['--base', 'http://localhost:9200'], ['--index', index], ['--directory', process.cwd() + '/audit']]) {
    assert.throws(() => favoriteNumericIndexAuditConfiguration([...args, ...suffix]));
  }
  assert.throws(() => favoriteNumericIndexAuditConfiguration(args.slice(0, 4)));
  assert.throws(() => favoriteNumericIndexAuditConfiguration(['--index', 'production', '--receipt', '/tmp/index.json', '--directory', '/tmp/audit']));
});

test('completed-receipt validation pins scope, source, preset plan, mapping and indexing sources', () => {
  const valid = fixtures();
  assert.doesNotThrow(() => validateFavoriteNumericAuditArtifacts(valid, { index }));
  for (const mutate of [
    data => { data.receipt.error = 'Indexing failed'; },
    data => { delete data.receipt.finishedAt; },
    data => { data.receipt.indexed--; },
    data => { data.receipt.count = 1000; },
    data => { data.receipt.configuration.source = true; },
    data => { data.receipt.base = 'http://127.0.0.1:19216'; },
    data => { data.receipt.identity.source = {}; },
    data => { data.plan.utilityCount--; },
    data => { data.snapshot['exploration/favorite-compiled-index.mjs'] += 'changed'; },
    data => { data.mapping.mappings.properties.utilities.properties[data.plan.descriptors[0].key].doc_values = false; },
    data => { data.mapping.mappings._meta.presets = 'favorite'; },
  ]) {
    const changed = structuredClone(valid); mutate(changed);
    assert.throws(() => validateFavoriteNumericAuditArtifacts(changed, { index }));
  }
  assert.throws(() => validateFavoriteNumericAuditArtifacts(valid, { index: index + '-other' }), /index/i);
  assert.doesNotThrow(() => validateFavoriteNumericAuditArtifacts(fixtures({ count: 1000000, numericPoints: true }), { index }));
});

function responseFor(body, samples) {
  return { took: 1, timed_out: false, _shards: { total: 1, successful: 1, failed: 0 }, hits: {
    total: { value: samples.length, relation: 'eq' }, hits: [...samples].reverse().map(doc => ({
      fields: Object.fromEntries(body.docvalue_fields.map(field => [field, field.startsWith('utilities.')
        ? [doc.utilities[field.slice('utilities.'.length)]] : Array.isArray(doc[field]) ? [...doc[field]].sort() : [doc[field]]])),
    })),
  } };
}

test('bounded field batches audit zero values, exact float32 values and every metadata field without depending on hit order', () => {
  const { verified } = fixtures();
  const samples = [0, 49999, 99999].map(ordinal => toFavoriteUtilityDocument(favoriteSyntheticDocument(verified.documents, ordinal,
    { coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) }), plan, { encodings: ['numeric'] }));
  const batches = favoriteNumericAuditBatches(samples);
  assert.ok(batches.length > 1);
  assert.equal(new Set(batches.flatMap(batch => batch.utilityFields)).size, plan.utilityCount);
  for (const batch of batches) {
    assert.ok(batch.body.docvalue_fields.length <= 80);
    assert.equal(batch.body._source, false);
    assert.equal(batch.body.stored_fields, '_none_');
    assert.deepEqual(batch.body.query.ids.values, samples.map(doc => doc.id));
    assert.doesNotThrow(() => validateFavoriteNumericAuditBatch(responseFor(batch.body, samples), batch, samples, index));
  }
  const batch = batches[0], good = responseFor(batch.body, samples), field = batch.utilityFields[0];
  for (const mutate of [
    response => { response.timed_out = true; },
    response => { response._shards.failed = 1; },
    response => { response.hits.hits.pop(); },
    response => { response.hits.total.relation = 'gte'; },
    response => { delete response.hits.hits[0].fields[field]; },
    response => { response.hits.hits[0].fields[field] = [NaN]; },
    response => { response.hits.hits[0].fields[field] = [1 - response.hits.hits[0].fields[field][0]]; },
    response => { response.hits.hits[0].fields[field].push(0); },
    response => { response.hits.hits[0].fields.id = ['unknown']; },
    response => { response.hits.hits[0].fields.partition = [500]; },
    response => { response.hits.hits[0].fields.tags = ['wrong-tag']; },
    response => { response.hits.hits[0] = response.hits.hits[1]; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.throws(() => validateFavoriteNumericAuditBatch(bad, batch, samples, index)); }
  const zeroSample = [{ id: 'zero', reference_id: 'zero', cohort: 'test', partition: 0, tags: [], utilities: { zero: 0, decimal: Math.fround(.1) } }];
  const zeroBatch = favoriteNumericAuditBatches(zeroSample)[0], rounded = responseFor(zeroBatch.body, zeroSample);
  rounded.hits.hits[0].fields['utilities.decimal'] = [.1]; // A shortest decimal can still represent the exact indexed float.
  assert.doesNotThrow(() => validateFavoriteNumericAuditBatch(rounded, zeroBatch, zeroSample, index));
  delete rounded.hits.hits[0].fields['utilities.zero'];
  assert.throws(() => validateFavoriteNumericAuditBatch(rounded, zeroBatch, zeroSample, index));
});

test('run records raw read-only batches, rejects concurrent writes and never replaces an evidence directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'favorite-numeric-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = fixtures({ numericPoints: true }), parent = path.join(root, 'parent');
  await mkdir(parent);
  for (const [name, value] of Object.entries({ 'index.json': fixture.receipt, 'plan.json': fixture.plan,
    'mapping-request.json': fixture.mapping, 'source-snapshot.json': fixture.snapshot })) {
    await writeFile(path.join(parent, name), JSON.stringify(value));
  }
  const samples = [0, 49999, 99999].map(ordinal => toFavoriteUtilityDocument(favoriteSyntheticDocument(fixture.verified.documents, ordinal,
    { seed: fixture.receipt.configuration.seed, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) }), plan, { encodings: ['numeric'] }));
  let statsReads = 0, mutate = false, sourceChanged = false;
  const calls = [];
  const request = async (route, options = {}) => {
    calls.push({ route, options });
    if (route.endsWith('/_mapping')) return { body: fixture.receipt.after.mapping };
    if (route.endsWith('/_settings')) return { body: fixture.receipt.after.settings };
    if (route.endsWith('/_count')) return { body: { count: 100000, _shards: { total: 1, successful: 1, failed: 0 } } };
    if (route.includes('/_stats/')) {
      statsReads++;
      return { body: { indices: { [index]: { uuid: 'original-uuid', primaries: { docs: { count: 100000, deleted: 0 },
        indexing: { index_total: 100000 + Number(mutate && statsReads % 2 === 0), delete_total: 0 } } } } } };
    }
    assert.equal(options.method, 'POST');
    assert.ok(route.startsWith(index + '/_search'));
    return { wallMs: 1, body: responseFor(options.body, samples) };
  };
  const config = { index, receipt: path.join(parent, 'index.json'), directory: path.join(root, 'success') };
  const dependencies = { request, loadInputs: async () => fixture.verified,
    sourceSnapshot: async () => sourceChanged && statsReads % 2 === 0 ? { ...fixture.snapshot, added: 'changed source' } : fixture.snapshot };
  const result = await runFavoriteNumericIndexAudit(config, dependencies);
  assert.equal(result.verified, true);
  assert.equal(result.sampleAudit.valuesCompared, samples.length * plan.utilityCount);
  assert.deepEqual(result.sampleAudit.ordinals, [0, 49999, 99999]);
  assert.equal(result.sampleAudit.encoder, 'original toFavoriteUtilityDocument; numeric only');
  assert.equal(result.beforeFingerprintHash, result.afterFingerprintHash);
  assert.equal(await readFile(path.join(config.directory, 'parent-receipt.json'), 'utf8'), JSON.stringify(fixture.receipt));
  const batches = (await readFile(path.join(config.directory, 'batches.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(batches.length, favoriteNumericAuditBatches(samples).length);
  assert.ok(batches.every(batch => batch.requestHash === hash(batch.request) && batch.responseHash === hash(batch.response)));
  const previousCalls = calls.length;
  await assert.rejects(runFavoriteNumericIndexAudit(config, dependencies), /EEXIST/);
  assert.equal(calls.length, previousCalls);
  mutate = true;
  const failedDirectory = path.join(root, 'mutated');
  await assert.rejects(runFavoriteNumericIndexAudit({ ...config, directory: failedDirectory }, dependencies), /changed|mutation/i);
  assert.equal(JSON.parse(await readFile(path.join(failedDirectory, 'audit.json'))).verified, false);
  mutate = false;
  const sourceRequest = async (route, options) => {
    const result = await request(route, options);
    if (route.startsWith(index + '/_search')) sourceChanged = true;
    return result;
  };
  await assert.rejects(runFavoriteNumericIndexAudit({ ...config, directory: path.join(root, 'changed-source') },
    { ...dependencies, request: sourceRequest }), /Source graph changed/);
  assert.equal(await readFile(config.receipt, 'utf8'), JSON.stringify(fixture.receipt));
});
