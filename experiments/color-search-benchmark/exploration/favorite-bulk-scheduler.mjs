// Optional indexing throughput helper. It performs no HTTP calls and changes
// no documents: one producer still generates/serializes/hashes in order.
// execute MUST resolve only after validating every create acknowledgement201.
// The compiled runner's existing sendFavoriteCompiledBulk supplies that check.
// If execute writes evidence after validation, call context.acknowledge FIRST:
// a failed disk write must never erase a definite service acknowledgement.

export function createFavoriteBulkScheduler({ concurrency = 1, execute, onEvent = async () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || typeof execute !== 'function' || typeof onEvent !== 'function') {
    throw Error('Bulk scheduler requires concurrency1..4, execute and optional onEvent callbacks.');
  }
  const pending = new Map(), acknowledgements = new Map(), failures = [], observedErrors = new WeakMap();
  const evidenceFailed = new Set(), serviceFailed = new Set(), executorFailed = new Set(), acceptedFailed = new Set();
  let serial = Promise.resolve(), firstError, nextOrdinal = 1, closed = false, submitting = false;
  let acknowledgedBatches = 0, acknowledgedDocuments = 0, acknowledgedBytes = 0, failedBatches = 0;
  let inFlightBytes = 0, peakInFlight = 0, peakInFlightBytes = 0;

  const snapshot = () => ({ concurrency, submittedBatches: nextOrdinal - 1, acknowledgedBatches, acknowledgedDocuments,
    acknowledgedBytes, failedBatches, failedEvidenceBatches: evidenceFailed.size, failedServiceBatches: serviceFailed.size,
    failedExecutorBatches: executorFailed.size, failedAcknowledgedBatches: acceptedFailed.size,
    inFlight: pending.size, inFlightBytes, peakInFlight, peakInFlightBytes,
    closed, failureCount: failures.length, failures: failures.map(value => ({ ...value,
      acknowledgement: value.acknowledgement && { ...value.acknowledgement } })) });
  function noteFailure(thrown, { ordinal, stage }) {
    const error = thrown instanceof Error ? thrown : Error(String(thrown));
    firstError ??= error;
    const ordinals = observedErrors.get(error) ?? new Map();
    if (!ordinals.has(ordinal)) {
      const acknowledgement = acknowledgements.get(ordinal);
      const category = stage.endsWith('-evidence') ? 'evidence' : acknowledgement ? 'executor-after-acknowledgement' : 'service-or-executor';
      const failure = { ordinal, stage, category, acknowledged: Boolean(acknowledgement),
        acknowledgement: acknowledgement && { ...acknowledgement }, error: error.stack ?? error.message };
      ordinals.set(ordinal, failure); observedErrors.set(error, ordinals); failures.push(failure);
      (category === 'evidence' ? evidenceFailed : category === 'service-or-executor' ? serviceFailed : executorFailed).add(ordinal);
      if (acknowledgement) acceptedFailed.add(ordinal);
    }
    return error;
  }
  function throwIfFailed() {
    if (firstError) { firstError.bulkSchedulerEvidence = snapshot(); throw firstError; }
  }
  function assertOpen() { throwIfFailed(); if (closed) throw Error('Bulk scheduler is closed.'); }
  // A rejected write never poisons the chain: later in-flight acknowledgements
  // still attempt their evidence writes, while admissions stop on firstError.
  function record(operation, context) {
    const work = serial.then(operation);
    serial = work.catch(error => { noteFailure(error, context); });
    return work;
  }
  async function waitForCapacity() {
    assertOpen();
    while (pending.size >= concurrency) {
      await Promise.race(pending.values()); assertOpen();
    }
    assertOpen();
  }
  async function submit(batch) {
    // Keeping one awaited producer avoids an unbounded queue of serialized
    // bodies and preserves deterministic generation/hash/ordinal order.
    if (submitting) throw Error('Use one producer and await each bulk submit.');
    submitting = true;
    try {
      assertOpen();
      if (!batch || !Array.isArray(batch.ids) || !batch.ids.length || batch.ids.some(id => typeof id !== 'string' || !id)
        || typeof batch.body !== 'string' || !batch.body.length || !Number.isSafeInteger(batch.bytes) || batch.bytes < 1) throw Error('Invalid serialized create batch.');
      await waitForCapacity();
      const ordinal = nextOrdinal++;
      const description = { ordinal, documents: batch.ids.length, bytes: batch.bytes, firstId: batch.ids[0], lastId: batch.ids.at(-1) };
      // Synchronous, bounded to active batches and idempotent. Only the caller
      // that validated all201 may supply proof. Missing proof is the legacy
      // execute-resolved contract; it never overwrites a stronger marker.
      const acknowledge = proof => {
        if (proof !== undefined && (!proof || proof.documents !== batch.ids.length
          || Object.keys(proof).some(key => !['documents', 'responseHash', 'bodyHash'].includes(key))
          || ['responseHash', 'bodyHash'].some(key => proof[key] !== undefined && !/^[a-f0-9]{64}$/.test(proof[key])))) throw Error('Invalid bulk acknowledgement proof.');
        const previous = acknowledgements.get(ordinal);
        if (previous) {
          if (proof && Object.keys(proof).some(key => previous[key] !== proof[key])) throw Error('Contradictory bulk acknowledgement proof.');
          return { ...previous };
        }
        const accepted = { ...description, ...(proof ?? {}) };
        acknowledgements.set(ordinal, accepted);
        acknowledgedBatches++; acknowledgedDocuments += batch.ids.length; acknowledgedBytes += batch.bytes;
        return { ...accepted };
      };
      const publish = (phase, extra = {}) => record(() => onEvent({ ...description, phase, ...extra }), { ordinal, stage: phase + '-evidence' });
      inFlightBytes += batch.bytes;
      // First await yields before the task can delete its pending entry.
      const work = (async () => {
        let stage = 'submitted-evidence';
        try {
          await publish('submitted'); stage = 'execute';
          const result = await execute(batch, { ordinal, acknowledge,
            record: operation => record(operation, { ordinal, stage: 'execution-evidence' }) });
          acknowledge();
          stage = 'accepted-evidence'; await publish('accepted', { result, acknowledgement: { ...acknowledgements.get(ordinal) } });
        } catch (thrown) {
          const error = noteFailure(thrown, { ordinal, stage }); failedBatches++;
          const failure = observedErrors.get(error).get(ordinal);
          try { await publish('failed', { ...failure }); }
          catch (writeError) { noteFailure(writeError, { ordinal, stage: 'failure-evidence' }); }
        } finally { pending.delete(ordinal); acknowledgements.delete(ordinal); inFlightBytes -= batch.bytes; }
      })();
      pending.set(ordinal, work);
      peakInFlight = Math.max(peakInFlight, pending.size); peakInFlightBytes = Math.max(peakInFlightBytes, inFlightBytes);
      return ordinal;
    } finally { submitting = false; }
  }
  async function drain() {
    closed = true;
    while (pending.size) await Promise.all(pending.values());
    await serial;
    return snapshot();
  }
  async function finish() {
    const evidence = await drain(); throwIfFailed(); return evidence;
  }
  return { waitForCapacity, submit, drain, finish, snapshot };
}
