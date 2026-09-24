import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteCompiledIndexConfiguration, favoriteCompiledMapping, assertFavoriteCompiledMapping, compiledExperiment, compiledEncodingValueCount, compiledDocumentForOrdinal, sendFavoriteCompiledBulk, runFavoriteCompiledIndex } from './favorite-compiled-index.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFavoriteIndexGuard } from './favorite-index-guard.mjs';
import { compileFavoriteUtilityEncoder, originalFavoriteEncodedDocument } from './favorite-compiled-encoder.mjs';
import { createFavoriteUtilityPlan, favoriteUtilityMapping } from './favorite-utilities.mjs';
import { favoritePrecisionMapping } from './favorite-precision-utilities.mjs';
import { favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';

const args = ['--index', 'color-exploration-compiled-test', '--directory', '/tmp/compiled-test'];
const all = ['numeric', 'rank8', 'rank16', 'rankfloat', 'rank18', 'rank27'];
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const plan = createFavoriteUtilityPlan({ requests: [{ query }] });
const retryBatch = { ids: ['one', 'two'], body: '{"create":{"_id":"one"}}\n{"id":"one"}\n{"create":{"_id":"two"}}\n{"id":"two"}\n', bytes: 84 };
const admitted = () => ({ body: { errors: false, items: retryBatch.ids.map(_id => ({ create: { _id, status: 201 } })), took: 1 }, wallMs: 2 });
const admissionError = (type = 'circuit_breaking_exception', reason = '[parent] Data too large, data for [<http_request>] would be [100/100b], which is larger than the limit of [90/90b]') =>
  Error('OpenSearch 429: ' + JSON.stringify({ type, reason, root_cause: [{ type, reason }] }));

test('compiled bulk retries only rejected HTTP admission and preserves every create byte and ID', async () => {
  const calls = [], delays = [], events = [];
  const result = await sendFavoriteCompiledBulk({ index: 'color-exploration-retry-test', batch: retryBatch,
    request: async (route, options) => { calls.push({ route, ...options }); if (calls.length < 3) throw admissionError(); return admitted(); },
    sleep: async ms => { delays.push(ms); }, onEvent: async row => { events.push(row); } });
  assert.deepEqual(delays, [1000, 2000]); assert.equal(calls.length, 3); assert.equal(result.body.items.length, 2);
  for (const call of calls) {
    assert.equal(call.route, 'color-exploration-retry-test/_bulk'); assert.equal(call.body, retryBatch.body);
    assert.equal(call.method, 'POST'); assert.equal(call.timeoutMs, 300000);
  }
  assert.deepEqual(events.map(row => row.phase), ['started', 'failed', 'started', 'failed', 'started', 'accepted']);
  for (const event of events) { assert.deepEqual(event.ids, retryBatch.ids); assert.match(event.bodyHash, /^[0-9a-f]{64}$/); }
  assert.equal(events[1].admissionRejected, true); assert.equal(events.at(-1).acknowledged, 2);
});

test('compiled bulk admission retries stop after six attempts and preserve the final failure', async () => {
  const delays = [], events = [], error = admissionError(); let calls = 0;
  await assert.rejects(sendFavoriteCompiledBulk({ index: 'color-exploration-retry-test', batch: retryBatch,
    request: async () => { calls++; throw error; }, sleep: async ms => { delays.push(ms); }, onEvent: async row => { events.push(row); } }), observed => observed === error);
  assert.equal(calls, 6); assert.deepEqual(delays, [1000, 2000, 4000, 8000, 10000]);
  assert.equal(events.filter(row => row.phase === 'failed').length, 6);
  assert.equal(events.at(-1).retryScheduled, false); assert.equal(events.at(-1).admissionRejected, true);
});

test('compiled bulk never retries uncertain transport errors, different breakers,409 or truncated messages', async () => {
  const errors = [Error('fetch failed'), new DOMException('Timeout', 'TimeoutError'), Error('OpenSearch 409: {"type":"version_conflict_engine_exception"}'),
    admissionError('es_rejected_execution_exception'), admissionError('circuit_breaking_exception', '[parent] Data too large, data for [indices:data/write/bulk]'),
    Error('OpenSearch 429: {"type":"circuit_breaking_exception","reason":"[parent] Data too large, data for [<http_request>]'),
    Error('OpenSearch 503: ' + admissionError().message.slice('OpenSearch 429: '.length))];
  for (const error of errors) {
    let calls = 0, sleeps = 0;
    await assert.rejects(sendFavoriteCompiledBulk({ index: 'color-exploration-retry-test', batch: retryBatch,
      request: async () => { calls++; throw error; }, sleep: async () => { sleeps++; } }), observed => observed === error);
    assert.equal(calls, 1); assert.equal(sleeps, 0);
  }
});

test('compiled bulk validates every201 acknowledgement and fails partial or conflicting retried creates', async () => {
  const invalid = [
    { errors: true, items: [{ create: { _id: 'one', status: 201 } }, { create: { _id: 'two', status: 429, error: { type: 'circuit_breaking_exception' } } }] },
    { errors: false, items: [{ create: { _id: 'one', status: 201 } }] },
    { errors: false, items: [{ create: { _id: 'one', status: 201 } }, { create: { _id: 'wrong', status: 201 } }] },
    { errors: true, items: [{ create: { _id: 'one', status: 409, error: { type: 'version_conflict_engine_exception' } } }, { create: { _id: 'two', status: 201 } }] },
  ];
  for (const body of invalid) {
    let calls = 0; const delays = [], events = [];
    await assert.rejects(sendFavoriteCompiledBulk({ index: 'color-exploration-retry-test', batch: retryBatch,
      request: async () => { calls++; if (calls === 1) throw admissionError(); return { body, wallMs: 1 }; },
      sleep: async ms => { delays.push(ms); }, onEvent: async row => { events.push(row); } }), /Utility bulk/);
    assert.equal(calls, 2); assert.deepEqual(delays, [1000]);
    assert.equal(events.at(-1).stage, 'acknowledgements'); assert.equal(events.at(-1).retryScheduled, false);
  }
});

test('compiled index CLI defaults source off and accepts mixed encodings with optional numeric points', () => {
  const real = favoriteCompiledIndexConfiguration(args);
  assert.equal(real.source, false); assert.equal(real.numericPoints, false);
  assert.equal(real.mode, 'real'); assert.equal(real.scope, 'full'); assert.equal(real.count, 545);
  assert.deepEqual(real.encodings, ['numeric', 'rank18']);
  const scale = favoriteCompiledIndexConfiguration([...args, '--mode', 'scale', '--count', '1000000', '--encodings', all.join(','), '--numeric-points', 'true']);
  assert.equal(scale.base, 'http://127.0.0.1:19217'); assert.equal(scale.numericPoints, true);
  assert.equal(scale.seed, 99539473); assert.deepEqual(scale.encodings, all);
  for (const suffix of [['--numeric-points', 'yes'], ['--numeric-points', 'true', '--encodings', 'rank18'],
    ['--encodings', 'unknown'], ['--encodings', 'rank18,rank18'], ['--count', '100'], ['--source', 'yes'],
    ['--directory', process.cwd() + '/output'], ['--base', 'http://127.0.0.1:9200']]) assert.throws(() => favoriteCompiledIndexConfiguration([...args, ...suffix]));
});

test('mapping retains existing family definitions and adds numeric points only when requested', () => {
  for (const encodings of [['numeric', 'rank16'], ['rank8', 'rankfloat']]) {
    assert.deepEqual(favoriteCompiledMapping(plan, { encodings }), favoriteUtilityMapping(plan, { encodings, source: false }));
  }
  assert.deepEqual(favoriteCompiledMapping(plan, { encodings: ['rank18', 'rank27'] }), favoritePrecisionMapping(plan));
  const mixed = favoriteCompiledMapping(plan, { encodings: all, numericPoints: true });
  assert.equal(mixed.mappings._source.enabled, false);
  assert.equal(mixed.mappings.properties.utilities.properties[plan.descriptors[0].key].index, true);
  assert.equal(mixed.mappings.properties.utilities.properties[plan.descriptors[0].key].doc_values, true);
  assert.equal(mixed.mappings.properties.utility_rank18_q050_w1.type, 'rank_features');
  assert.equal(mixed.mappings.properties.utility_rank27_q050_w1.type, 'rank_features');
  assert.equal(mixed.mappings.properties.utility_rank16_q050_w1.type, 'rank_features');
  assert.equal(favoriteCompiledMapping(plan).mappings.properties.utilities.properties[plan.descriptors[0].key].index, false);
  for (const options of [{ encodings: [] }, { encodings: ['bad'] }, { encodings: ['rank18'], numericPoints: true }, { numericPoints: 'true' }]) {
    assert.throws(() => favoriteCompiledMapping(plan, options));
  }
});

test('experiment identities distinguish original, precision and mixed representations', () => {
  assert.equal(compiledExperiment(['numeric', 'rank16']), 'strict-hue-favorite-utilities');
  assert.equal(compiledExperiment(['rank18', 'rank27']), 'strict-hue-favorite-precision-utilities');
  assert.equal(compiledExperiment(['numeric', 'rank18']), 'strict-hue-favorite-compiled-utilities');
  assert.throws(() => compiledExperiment([]));
});

test('mapping checks allow omitted numeric index:true defaults but reject disabled points or changed metadata', () => {
  const expected = favoriteCompiledMapping(plan, { numericPoints: true }).mappings;
  expected._meta = { numericPoints: true, identity: 'original' };
  const returned = structuredClone(expected);
  const key = plan.descriptors[0].key;
  delete returned.properties.utilities.properties[key].index;
  delete returned.properties.utilities.properties[key].doc_values;
  assert.doesNotThrow(() => assertFavoriteCompiledMapping(returned, expected));
  returned.properties.utilities.properties[key].index = false;
  assert.throws(() => assertFavoriteCompiledMapping(returned, expected));
  delete returned.properties.utilities.properties[key].index;
  returned._meta.numericPoints = false;
  assert.throws(() => assertFavoriteCompiledMapping(returned, expected));
});

test('compiled scale documents preserve original deterministic measurement synthesis and every encoding', () => {
  const config = favoriteCompiledIndexConfiguration([...args, '--mode', 'scale', '--encodings', all.join(',')]);
  const inputs = { documents: [0, 1].map((area, i) => ({ id: 'source-' + i,
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? area * 10000 : area])) })),
    coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) };
  const encode = compileFavoriteUtilityEncoder(plan, { encodings: config.encodings });
  const expectedMeasurement = favoriteSyntheticDocument(inputs.documents, 10, { seed: config.seed, coverageFields: inputs.coverageFields });
  const expected = originalFavoriteEncodedDocument(expectedMeasurement, plan, { encodings: config.encodings });
  const actual = compiledDocumentForOrdinal({ ordinal: 10, config, inputs, plan, encode });
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  for (const encoding of all) {
    const count = encoding === 'numeric' ? Object.keys(actual.utilities).length
      : Object.entries(actual).filter(([name]) => name.startsWith('utility_' + encoding + '_')).reduce((sum, [, group]) => sum + Object.keys(group).length, 0);
    assert.equal(compiledEncodingValueCount(actual, encoding), count);
  }
  assert.throws(() => compiledDocumentForOrdinal({ ordinal: 10, config, inputs, plan }), /Compile/);
});


test('compiled bulk concurrency is opt-in, bounded and recorded in configuration', () => {
  assert.equal(favoriteCompiledIndexConfiguration(args).bulkConcurrency, 1);
  assert.equal(favoriteCompiledIndexConfiguration([...args, '--bulk-concurrency', '4']).bulkConcurrency, 4);
  for (const value of ['0', '5', '1.5', 'NaN']) assert.throws(() => favoriteCompiledIndexConfiguration([...args, '--bulk-concurrency', value]), /concurrency/i);
});

test('disk reserve and STOP controls are opt-in and reject incomplete or unsafe CLI values', () => {
  const legacy = favoriteCompiledIndexConfiguration(args);
  for (const key of ['diskPath', 'minimumFreeBytes', 'stopFile']) assert.equal(Object.hasOwn(legacy, key), false);
  const guarded = favoriteCompiledIndexConfiguration([...args, '--disk-path', '/tmp', '--minimum-free-bytes', '120000000000', '--stop-file', '/tmp/compiled-test.STOP']);
  assert.equal(guarded.diskPath, '/tmp'); assert.equal(guarded.minimumFreeBytes, 120000000000);
  assert.equal(guarded.stopFile, '/tmp/compiled-test.STOP');
  assert.equal(favoriteCompiledIndexConfiguration([...args, '--stop-file', '/tmp/STOP']).stopFile, '/tmp/STOP');
  for (const suffix of [
    ['--disk-path', '/tmp'], ['--minimum-free-bytes', '10'],
    ['--disk-path', 'relative', '--minimum-free-bytes', '10'],
    ...['0', '-1', '1.5', 'NaN', '9007199254740992'].map(value => ['--disk-path', '/tmp', '--minimum-free-bytes', value]),
    ['--stop-file', 'relative'], ['--stop-file', '/'], ['--stop-file', process.cwd() + '/STOP'],
  ]) assert.throws(() => favoriteCompiledIndexConfiguration([...args, ...suffix]));
});

test('guard uses available blocks, caches for two seconds, and supports forced checks', async () => {
  let now = 0, calls = 0;
  const guard = createFavoriteIndexGuard({ diskPath: '/tmp', minimumFreeBytes: 800 }, {
    now: () => now, statfs: async (location, options) => { calls++; assert.equal(location, '/tmp'); assert.deepEqual(options, { bigint: true }); return { bavail: 200n, bfree: 5000n, bsize: 4n }; },
  });
  await guard.check(); assert.equal(calls, 1); assert.equal(guard.snapshot().lastCheck.availableBytes, '800');
  now = 1999; await guard.check(); assert.equal(calls, 1);
  now = 2000; await guard.check(); assert.equal(calls, 2);
  await guard.check({ force: true }); assert.equal(calls, 3);
});

test('reserve failure latches and records exact available space without later admission', async () => {
  let calls = 0;
  const guard = createFavoriteIndexGuard({ diskPath: '/tmp', minimumFreeBytes: 801 }, {
    statfs: async () => { calls++; return { bavail: 200n, bfree: 5000n, bsize: 4n }; },
  });
  await assert.rejects(guard.check(), /disk reserve/i);
  await assert.rejects(guard.check({ force: true }), /disk reserve/i);
  assert.equal(calls, 1); assert.equal(guard.snapshot().failure.reason, 'disk-reserve');
  assert.equal(guard.snapshot().failure.availableBytes, '800');
});

test('STOP presence and failed filesystem inspection stop safely; disabled guard does no I/O', async () => {
  const disabled = createFavoriteIndexGuard({}, { statfs: async () => { throw Error('unexpected statfs'); }, lstat: async () => { throw Error('unexpected lstat'); } });
  await disabled.check({ force: true }); assert.equal(disabled.enabled, false);
  const stop = createFavoriteIndexGuard({ stopFile: '/tmp/STOP' }, { lstat: async () => ({}) });
  await assert.rejects(stop.check(), /STOP file/i); assert.equal(stop.snapshot().failure.reason, 'stop-file');
  const absent = createFavoriteIndexGuard({ stopFile: '/tmp/STOP' }, { lstat: async () => { throw Object.assign(Error('absent'), { code: 'ENOENT' }); } });
  await absent.check(); assert.equal(absent.snapshot().failure, null);
  const denied = createFavoriteIndexGuard({ stopFile: '/tmp/STOP' }, { lstat: async () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); } });
  await assert.rejects(denied.check(), /denied/); assert.equal(denied.snapshot().failure.reason, 'inspection-failed');
  const missingDisk = createFavoriteIndexGuard({ diskPath: '/missing', minimumFreeBytes: 1 }, { statfs: async () => { throw Object.assign(Error('disk path missing'), { code: 'ENOENT' }); } });
  await assert.rejects(missingDisk.check(), /disk path missing/);
});

function guardedPreparation() {
  const encode = measurement => ({ id: measurement.id, utilities: { test: .5 } });
  encode.definition = { version: 1 };
  return { inputs: { documents: Array.from({ length: 5 }, (_, i) => ({ id: 'guard-doc-' + i })) },
    plan: { utilityCount: 1, measurementFields: [] }, mapping: { mappings: {} }, sourceSnapshot: {}, source: {},
    identity: { experiment: 'guard-test', planHash: 'test' }, identityHash: 'test', encode, compileMs: 0 };
}

test('forced reserve failure prevents index creation and preserves an interrupted receipt', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'favorite-guard-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const config = { ...favoriteCompiledIndexConfiguration(args), directory: path.join(parent, 'result'), diskPath: '/tmp', minimumFreeBytes: 2 };
  const calls = [], guard = createFavoriteIndexGuard(config, { statfs: async () => ({ bavail: 1n, bsize: 1n }) });
  await assert.rejects(runFavoriteCompiledIndex(config, { prepareIndex: async () => guardedPreparation(),
    request: async (route, options) => { calls.push({ route, options }); return { body: {} }; }, createGuard: () => guard }), /disk reserve/i);
  assert.equal(calls.some(call => call.options?.method === 'PUT'), false);
  const receipt = JSON.parse(await readFile(path.join(config.directory, 'index.json'), 'utf8'));
  assert.equal(receipt.indexed, 0); assert.ok(receipt.interruptedAt); assert.equal(receipt.indexGuard.failure.reason, 'disk-reserve');
});

test('guard interruption drains accepted in-flight creates and keeps their final evidence', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'favorite-guard-drain-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const config = { ...favoriteCompiledIndexConfiguration(args), directory: path.join(parent, 'result'), count: 5,
    encodings: ['numeric'], bulkBytes: 1, bulkConcurrency: 4, diskPath: '/tmp', minimumFreeBytes: 100 };
  let now = 0, bulkStarted = false, release, responsesCompleted = 0, responsesAtFailure, requestOrdinal = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const guard = createFavoriteIndexGuard(config, { now: () => now, statfs: async () => {
    if (bulkStarted) { responsesAtFailure = responsesCompleted; release(); return { bavail: 50n, bsize: 1n }; }
    return { bavail: 1000n, bsize: 1n };
  } });
  const calls = [];
  await assert.rejects(runFavoriteCompiledIndex(config, { prepareIndex: async () => guardedPreparation(), createGuard: () => guard,
    request: async (route, options) => {
      calls.push({ route, options });
      if (!route.endsWith('/_bulk')) return { body: {}, wallMs: 1 };
      if (++requestOrdinal === 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
        bulkStarted = true; now = 2000;
      } else await pending;
      const lines = options.body.trim().split('\n'), ids = lines.filter((_, i) => i % 2 === 0).map(line => JSON.parse(line).create._id);
      responsesCompleted++;
      return { body: { errors: false, items: ids.map(_id => ({ create: { _id, status: 201 } })), took: 1 }, wallMs: 1 };
    } }), /disk reserve/i);
  const receipt = JSON.parse(await readFile(path.join(config.directory, 'index.json'), 'utf8'));
  assert.ok(receipt.indexed > 0); assert.ok(receipt.indexed < 5);
  assert.ok(responsesCompleted > responsesAtFailure, 'At least one service acknowledgement finishes after the guard interrupts admission.');
  assert.equal(receipt.bulkScheduler.inFlight, 0); assert.equal(receipt.bulkScheduler.closed, true);
  assert.equal(receipt.bulkAcknowledgementFailures, 0); assert.ok(receipt.interruptedAt); assert.equal(receipt.indexGuard.failure.reason, 'disk-reserve');
  assert.equal(calls.some(call => call.route.endsWith('/_refresh')), false);
  const accepted = (await readFile(path.join(config.directory, 'batches.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(accepted.reduce((sum, row) => sum + row.documents, 0), receipt.indexed);
});
