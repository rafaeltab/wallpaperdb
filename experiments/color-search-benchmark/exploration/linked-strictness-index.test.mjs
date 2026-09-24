import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { linkedStrictnessIndexConfiguration, linkedStrictnessMapping, verifyLinkedStrictnessSource, runLinkedStrictnessIndex } from './linked-strictness-index.mjs';
import { createLinkedStrictnessPlan } from './linked-strictness.mjs';
import { hash } from './service.mjs';
import { createFavoriteUtilityPlan } from './favorite-utilities.mjs';
import { compileFavoriteUtilityEncoder } from './favorite-compiled-encoder.mjs';

test('compact real index CLI fixes corpus, points, source and bank while requiring new external artifacts', () => {
  const options = ['--bank', 'linked-3', '--directory', '/tmp/new-linked-real'];
  const config = linkedStrictnessIndexConfiguration(options);
  assert.equal(config.index, 'color-exploration-favorite-linked-3-real-v1'); assert.equal(config.count, 545);
  assert.equal(config.base, 'http://127.0.0.1:19216'); assert.equal(config.source, false); assert.equal(config.numericPoints, true);
  assert.equal(linkedStrictnessIndexConfiguration([...options, '--dry-run']).dryRun, true);
  for (const suffix of [['--bank', 'linked-9'], ['--count', '1000000'], ['--source', 'true'], ['--base', 'http://127.0.0.1:19217'], ['--directory', process.cwd()]]) {
    assert.throws(() => linkedStrictnessIndexConfiguration([...options, ...suffix]));
  }
  assert.throws(() => linkedStrictnessIndexConfiguration(['--bank', 'linked-5']));
});

test('compact numeric mappings retain source-off float points and column values for every selected utility', () => {
  const plan = createLinkedStrictnessPlan('linked-3'), mapping = linkedStrictnessMapping(plan);
  assert.equal(mapping.mappings._source.enabled, false);
  const fields = Object.values(mapping.mappings.properties.utilities.properties);
  assert.equal(fields.length, 10044);
  assert.ok(fields.every(field => field.type === 'float' && field.index === true && field.doc_values === true));
  assert.equal(mapping.settings.number_of_replicas, 0);
});

test('source verification requires all545 exact measured values including fixtures before encoding', () => {
  const documents = Array.from({ length: 545 }, (_, i) => ({ id: 'image-' + i, value: i }));
  const verified = { source: { receipts: [{ bucketCount: 256, valuesHash: hash(documents.map(document => ({ id: document.id, hash: hash(document) }))) }] } };
  assert.doesNotThrow(() => verifyLinkedStrictnessSource(documents, verified));
  assert.throws(() => verifyLinkedStrictnessSource(documents.slice(0, 523), verified));
  assert.throws(() => verifyLinkedStrictnessSource([...documents.slice(0, 544), documents[0]], verified));
  assert.throws(() => verifyLinkedStrictnessSource(documents.map((document, i) => i ? document : { ...document, value: 99 }), verified));
});

function fakePreparedIndex() {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }] } }] });
  const documents = [0, 1, 2].map(i => ({ id: 'sample-' + i, tags: ['city'], ...Object.fromEntries(plan.measurementFields.map(field =>
    [field, field.startsWith('cov_') ? 2000 + i * 1000 : .5 + i * .125])) }));
  return { documents, plan, mapping: linkedStrictnessMapping(plan), source: {}, sourceSnapshot: { fixture: 'fixed-test-source' },
    identity: { experiment: 'strict-hue-favorite-linked-utilities' }, identityHash: 'fixture', encode: compileFavoriteUtilityEncoder(plan, { encodings: ['numeric'] }) };
}
function fakeIndexService(config, { corruptValue = false, wrongBulkId = false } = {}) {
  const calls = [], documents = new Map(); let mapping;
  const request = async (route, options = {}) => {
    calls.push({ route, ...options });
    const response = body => ({ body, wallMs: 1 });
    if (route === config.index && options.method === 'PUT') { mapping = options.body; return response({ acknowledged: true }); }
    if (route.endsWith('/_bulk')) {
      const lines = options.body.trim().split('\n'), items = [];
      for (let i = 0; i < lines.length; i += 2) {
        const action = JSON.parse(lines[i]); assert.deepEqual(Object.keys(action), ['create']);
        const document = JSON.parse(lines[i + 1]); assert.equal(action.create._id, document.id);
        documents.set(document.id, document); items.push({ create: { _id: wrongBulkId ? 'different' : document.id, status: 201 } });
      }
      return response({ errors: false, items });
    }
    if (route.includes('/_flush') || route.endsWith('/_refresh')) return response({ _shards: { failed: 0 } });
    if (route.endsWith('/_count')) return response({ count: documents.size, _shards: { failed: 0 } });
    if (route.includes('/_mget')) return response({ docs: options.body.ids.map(_id => ({ _id, found: documents.has(_id) })) });
    if (route.endsWith('/_mapping')) return response({ [config.index]: { mappings: mapping.mappings } });
    if (route.endsWith('/_settings')) return response({ [config.index]: { settings: { index: { uuid: 'test-index-uuid' } } } });
    if (route.includes('/_stats/')) return response({ indices: { [config.index]: { uuid: 'test-index-uuid', primaries: {
      docs: { count: documents.size, deleted: 0 }, indexing: { index_total: documents.size, delete_total: 0 }, store: { size_in_bytes: 1234 },
    } } } });
    if (route.includes('/_search')) {
      assert.equal(options.body.stored_fields, '_none_'); assert.equal(options.body._source, false);
      const hits = options.body.query.ids.values.map(id => {
        const doc = documents.get(id), fields = Object.fromEntries(options.body.docvalue_fields.map(field => [field,
          field.startsWith('utilities.') ? [corruptValue ? .123 : doc.utilities[field.slice(10)]] : field === 'tags' ? doc.tags : [doc[field]] ]));
        return { _id: id, _index: config.index, fields };
      });
      return response({ timed_out: false, _shards: { failed: 0 }, hits: { total: { relation: 'eq', value: hits.length }, hits } });
    }
    throw Error('Unexpected fake request: ' + route);
  };
  return { request, calls, documents };
}

test('compact builder creates and audits complete values, records evidence and refuses evidence overwrite', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'linked-index-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const config = { ...linkedStrictnessIndexConfiguration(['--bank', 'linked-3', '--directory', path.join(parent, 'new')]), count: 3 };
  const prepared = fakePreparedIndex(), service = fakeIndexService(config), dependencies = { prepareIndex: async () => prepared,
    request: service.request, snapshot: async () => prepared.sourceSnapshot, settle: async () => ({ settled: true }) };
  const receipt = await runLinkedStrictnessIndex(config, dependencies);
  assert.equal(receipt.count, 3); assert.equal(receipt.generated, 3); assert.equal(receipt.indexed, 3);
  assert.equal(receipt.encodingValueCounts.numeric, 3); assert.equal(receipt.sampleAudit.valuesCompared, 3);
  assert.equal(receipt.sampleAudit.verified, true); assert.ok(receipt.finishedAt); assert.equal(receipt.uuid, 'test-index-uuid');
  const stored = JSON.parse(await readFile(path.join(config.directory, 'index.json'), 'utf8'));
  assert.deepEqual(stored, receipt);
  const calls = service.calls.length;
  await assert.rejects(runLinkedStrictnessIndex(config, dependencies), { code: 'EEXIST' });
  assert.equal(service.calls.length, calls); assert.equal(service.calls.some(call => call.method === 'DELETE'), false);
});

test('builder rejects incorrect bulk acknowledgements or stored values and retains interrupted artifacts', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'linked-index-failure-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  for (const failure of ['wrongBulkId', 'corruptValue']) {
    const config = { ...linkedStrictnessIndexConfiguration(['--bank', 'linked-3', '--directory', path.join(parent, failure)]), count: 3 };
    const prepared = fakePreparedIndex(), service = fakeIndexService(config, { [failure]: true });
    await assert.rejects(runLinkedStrictnessIndex(config, { prepareIndex: async () => prepared, request: service.request,
      snapshot: async () => prepared.sourceSnapshot, settle: async () => ({ settled: true }) }), failure === 'wrongBulkId' ? /acknowledgement/ : /utility differs/);
    const receipt = JSON.parse(await readFile(path.join(config.directory, 'index.json'), 'utf8'));
    assert.ok(receipt.interruptedAt); assert.ok(receipt.error); assert.equal(receipt.finishedAt, undefined);
    if (failure === 'wrongBulkId') assert.equal(service.calls.some(call => call.route.endsWith('/_refresh')), false);
    else { assert.equal(receipt.indexed, 3); assert.equal(receipt.sampleAudit.verified, false); }
    assert.equal(service.calls.some(call => call.method === 'DELETE'), false);
  }
});
