import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoriteBulkScheduler } from './favorite-bulk-scheduler.mjs';
import { sendFavoriteCompiledBulk } from './favorite-compiled-index.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const batch = id => ({ ids: ['doc-' + id], body: 'body-' + id, bytes: 10 });

test('scheduler assigns immutable submission ordinals, caps active batches and preserves out-of-order acknowledgements', async () => {
  const pending = new Map(), events = [];
  const scheduler = createFavoriteBulkScheduler({ concurrency: 4,
    execute: async (item, context) => { const done = deferred(); pending.set(context.ordinal, done); return done.promise; },
    onEvent: async event => { events.push(event); } });
  for (let i = 1; i <= 4; i++) assert.equal(await scheduler.submit(batch(i)), i);
  await turn(); assert.equal(pending.size, 4);
  let admitted = false; const fifth = scheduler.submit(batch(5)).then(ordinal => { admitted = true; return ordinal; });
  await turn(); assert.equal(admitted, false);
  pending.get(3).resolve({ acknowledged: true }); assert.equal(await fifth, 5); await turn();
  pending.get(1).resolve({ acknowledged: true }); pending.get(4).resolve({ acknowledged: true }); pending.get(2).resolve({ acknowledged: true }); pending.get(5).resolve({ acknowledged: true });
  const report = await scheduler.finish();
  assert.equal(report.submittedBatches, 5); assert.equal(report.acknowledgedBatches, 5); assert.equal(report.acknowledgedDocuments, 5);
  assert.equal(report.peakInFlight, 4); assert.equal(report.peakInFlightBytes, 40); assert.equal(report.inFlight, 0);
  assert.deepEqual(events.filter(event => event.phase === 'accepted').map(event => event.ordinal), [3, 1, 4, 2, 5]);
  assert.deepEqual(events.filter(event => event.phase === 'submitted').map(event => event.ordinal), [1, 2, 3, 4, 5]);
});

test('one failed batch stops further generation, drains other requests and keeps their acknowledgements', async () => {
  const pending = new Map(), events = [], generated = [];
  const scheduler = createFavoriteBulkScheduler({ concurrency: 3,
    execute: async (item, context) => { const done = deferred(); pending.set(context.ordinal, done); return done.promise; },
    onEvent: async event => { events.push(event); } });
  const producer = (async () => { for (let i = 1; i <= 20; i++) { await scheduler.waitForCapacity(); generated.push(i); await scheduler.submit(batch(i)); } })();
  const observed = producer.catch(error => error);
  await turn(); assert.deepEqual(generated, [1, 2, 3]);
  pending.get(2).reject(Error('Partial bulk acknowledgement; never retry'));
  const error = await observed; assert.match(error.message, /Partial/); assert.deepEqual(generated, [1, 2, 3]);
  let drained = false; const finish = scheduler.finish().catch(error => { drained = true; return error; });
  await turn(); assert.equal(drained, false);
  pending.get(3).resolve({ status: 201 }); pending.get(1).resolve({ status: 201 });
  const finalError = await finish;
  assert.equal(finalError.bulkSchedulerEvidence.submittedBatches, 3);
  assert.equal(finalError.bulkSchedulerEvidence.acknowledgedBatches, 2);
  assert.equal(finalError.bulkSchedulerEvidence.failedBatches, 1);
  assert.equal(finalError.bulkSchedulerEvidence.inFlight, 0);
  assert.equal(events.filter(event => event.phase === 'failed').length, 1);
  assert.deepEqual(events.filter(event => event.phase === 'accepted').map(event => event.ordinal), [3, 1]);
  await assert.rejects(scheduler.submit(batch(4)), /Partial|closed/);
});

test('retry/evidence operations share one serialized writer across concurrent batches', async () => {
  let active = 0, maximum = 0; const writes = [];
  const write = async label => { active++; maximum = Math.max(maximum, active); await turn(); writes.push(label); active--; };
  const scheduler = createFavoriteBulkScheduler({ concurrency: 4,
    execute: async (_item, { ordinal, record }) => { await record(() => write('attempt-' + ordinal)); await turn(); await record(() => write('retry-' + ordinal)); return { status: 201 }; },
    onEvent: async event => write(event.phase + '-' + event.ordinal) });
  for (let i = 0; i < 8; i++) await scheduler.submit(batch(i));
  const report = await scheduler.finish();
  assert.equal(maximum, 1); assert.equal(writes.length, 32); assert.equal(report.acknowledgedDocuments, 8);
});

test('receipt-write failure stops admission and still reports an already acknowledged batch', async () => {
  const scheduler = createFavoriteBulkScheduler({ concurrency: 1, execute: async () => ({ status: 201 }),
    onEvent: async event => { if (event.phase === 'accepted') throw Error('Receipt disk full'); } });
  await scheduler.submit(batch(1));
  await assert.rejects(scheduler.finish(), error => {
    assert.match(error.message, /disk full/);
    assert.equal(error.bulkSchedulerEvidence.acknowledgedBatches, 1);
    assert.equal(error.bulkSchedulerEvidence.failedBatches, 1);
    assert.equal(error.bulkSchedulerEvidence.failures[0].stage, 'accepted-evidence');
    return true;
  });
});

test('bounded scheduler rejects unsupported concurrency, duplicate producer calls and invalid batches', async () => {
  for (const concurrency of [0, 5, 1.5]) assert.throws(() => createFavoriteBulkScheduler({ concurrency, execute: async () => {} }));
  const first = deferred();
  const scheduler = createFavoriteBulkScheduler({ concurrency: 1, execute: async () => first.promise });
  await assert.rejects(scheduler.submit({ ids: [], body: '', bytes: 0 }), /batch/i);
  await scheduler.submit(batch(1));
  const second = scheduler.submit(batch(2));
  await assert.rejects(scheduler.submit(batch(3)), /producer|submit/i);
  first.resolve({ status: 201 }); await second; await scheduler.finish();
});

test('drain remains available after a producer-side failure and never starts new batches', async () => {
  const first = deferred(), scheduler = createFavoriteBulkScheduler({ concurrency: 2, execute: async () => first.promise });
  await scheduler.submit(batch(1));
  const drain = scheduler.drain();
  await assert.rejects(scheduler.submit(batch(2)), /closed/i);
  first.resolve({ status: 201 });
  const report = await drain; assert.equal(report.acknowledgedDocuments, 1); assert.equal(report.inFlight, 0);
});

test('integration callback retains real create201 validation and never retries partial bulk acceptance', async () => {
  const attempts = [], events = [];
  const scheduler = createFavoriteBulkScheduler({ concurrency: 2,
    execute: (item, { ordinal, record }) => sendFavoriteCompiledBulk({ index: 'color-exploration-scheduler-test', batch: item,
      request: async (_route, options) => {
        attempts.push(options.body);
        return { body: { errors: ordinal === 2, items: item.ids.map(_id => ({ create: { _id, status: ordinal === 2 ? 429 : 201 } })) }, wallMs: 1 };
      }, onEvent: event => record(async () => { events.push({ ordinal, ...event }); }) }),
  });
  await scheduler.submit(batch(1)); await scheduler.submit(batch(2));
  await assert.rejects(scheduler.finish(), error => {
    assert.match(error.message, /Utility bulk/); assert.equal(error.bulkSchedulerEvidence.acknowledgedDocuments, 1); return true;
  });
  assert.equal(attempts.length, 2);
  assert.equal(events.filter(event => event.ordinal === 2 && event.retryScheduled).length, 0);
  assert.equal(events.find(event => event.ordinal === 2 && event.phase === 'failed').stage, 'acknowledgements');
});

test('a reused error object still records each failed batch ordinal', async () => {
  const signal = deferred(), shared = Error('shared transport failure');
  const scheduler = createFavoriteBulkScheduler({ concurrency: 2, execute: async () => { await signal.promise; throw shared; } });
  await scheduler.submit(batch(1)); await scheduler.submit(batch(2)); signal.resolve();
  await assert.rejects(scheduler.finish(), error => {
    assert.equal(error.bulkSchedulerEvidence.failedBatches, 2);
    assert.deepEqual(error.bulkSchedulerEvidence.failures.map(row => row.ordinal), [1, 2]); return true;
  });
});

test('validated create201 remains acknowledged when the inner accepted evidence write fails', async () => {
  let requests = 0; const events = [], diskError = Error('accepted receipt disk full');
  const scheduler = createFavoriteBulkScheduler({ concurrency: 1,
    execute: (item, { record, acknowledge }) => sendFavoriteCompiledBulk({ index: 'color-exploration-scheduler-test', batch: item,
      request: async () => { requests++; return { body: { errors: false, items: item.ids.map(_id => ({ create: { _id, status: 201 } })) }, wallMs: 1 }; },
      onEvent: event => {
        if (event.phase === 'accepted') acknowledge({ documents: event.acknowledged, responseHash: event.responseHash, bodyHash: event.bodyHash });
        return record(async () => { if (event.phase === 'accepted') throw diskError; });
      } }),
    onEvent: async event => { events.push(event); } });
  await scheduler.submit(batch(1));
  await assert.rejects(scheduler.finish(), error => {
    assert.equal(error, diskError);
    const evidence = error.bulkSchedulerEvidence;
    assert.equal(evidence.acknowledgedBatches, 1); assert.equal(evidence.acknowledgedDocuments, 1); assert.equal(evidence.acknowledgedBytes, 10);
    assert.equal(evidence.failedEvidenceBatches, 1); assert.equal(evidence.failedServiceBatches, 0); assert.equal(evidence.failedAcknowledgedBatches, 1);
    assert.equal(evidence.failures[0].stage, 'execution-evidence'); assert.equal(evidence.failures[0].category, 'evidence');
    assert.equal(evidence.failures[0].acknowledgement.ordinal, 1); assert.equal(evidence.failures[0].acknowledgement.firstId, 'doc-1');
    assert.match(evidence.failures[0].acknowledgement.responseHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.failures[0].acknowledgement.bodyHash, /^[a-f0-9]{64}$/);
    assert.equal(evidence.inFlight, 0); return true;
  });
  assert.equal(requests, 1); assert.equal(events.find(event => event.phase === 'failed').acknowledgement.documents, 1);
});

test('explicit acknowledgement is idempotent and contradictory proof fails without losing accepted counts', async () => {
  const proof = { documents: 1, responseHash: 'a'.repeat(64), bodyHash: 'b'.repeat(64) };
  const good = createFavoriteBulkScheduler({ execute: async (_item, { acknowledge }) => { acknowledge(proof); acknowledge(proof); return { status: 201 }; } });
  await good.submit(batch(1)); assert.equal((await good.finish()).acknowledgedDocuments, 1);
  const bad = createFavoriteBulkScheduler({ execute: async (_item, { acknowledge }) => { acknowledge(proof); acknowledge({ ...proof, responseHash: 'c'.repeat(64) }); } });
  await bad.submit(batch(1));
  await assert.rejects(bad.finish(), error => { assert.match(error.message, /Contradictory/); assert.equal(error.bulkSchedulerEvidence.acknowledgedDocuments, 1); return true; });
});
