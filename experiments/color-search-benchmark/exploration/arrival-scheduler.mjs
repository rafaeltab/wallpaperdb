// Arrival-rate load: scheduled arrivals continue when earlier requests are slow.
// A bounded client rejects excess work explicitly instead of hiding its queue delay.
import { performance } from 'node:perf_hooks';

export const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

export function summarizeArrivals(records) {
  const latencies = records.map(record => record.elapsedMs);
  const errors = records.filter(record => record.error).length;
  const overOneSecond = records.filter(record => record.elapsedMs >= 1000).length;
  return {
    requests: records.length,
    errors,
    clientRejected: records.filter(record => record.clientRejected).length,
    overOneSecond,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: percentile(latencies, 1),
    maximumSchedulerDelayMs: percentile(records.map(record => record.schedulerDelayMs), 1),
    viableAtTestedLoad: records.length > 0 && errors === 0 && overOneSecond === 0,
  };
}

export async function runArrivals({ rate, durationMs, maxInFlight = 256, run,
  now = () => performance.now(), sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!(rate > 0) || !Number.isFinite(rate) || !(durationMs > 0) || !Number.isFinite(durationMs)
    || !Number.isInteger(maxInFlight) || maxInFlight < 1 || typeof run !== 'function') {
    throw new Error('Positive rate/duration, positive integer client limit and a request function are required');
  }
  const total = Math.floor(rate * durationMs / 1000);
  if (!total || total > 1_000_000) throw new Error('Arrival count must be 1..1000000');
  const started = now(), records = [], pending = new Set();
  let peakInFlight = 0;
  for (let ordinal = 0; ordinal < total; ordinal++) {
    const scheduled = started + ordinal * 1000 / rate;
    let remaining = scheduled - now();
    while (remaining > 0) { await sleep(remaining); remaining = scheduled - now(); }
    const dispatched = now();
    const schedulerDelayMs = Math.max(0, dispatched - scheduled);
    if (pending.size >= maxInFlight) {
      records[ordinal] = { ordinal, schedulerDelayMs, elapsedMs: schedulerDelayMs,
        error: 'Client in-flight limit reached', clientRejected: true };
      continue;
    }
    const request = Promise.resolve().then(() => run(ordinal)).then(
      result => ({ ...result }),
      error => ({ error: error.message ?? String(error) }),
    ).then(result => {
      records[ordinal] = { ...result, ordinal, schedulerDelayMs,
        requestMs: now() - dispatched, elapsedMs: now() - scheduled };
    }).finally(() => pending.delete(request));
    pending.add(request);
    peakInFlight = Math.max(peakInFlight, pending.size);
  }
  await Promise.all(pending);
  return { ...summarizeArrivals(records), rate, durationMs, elapsedMs: now() - started,
    maxInFlight, peakInFlight, trials: records };
}
