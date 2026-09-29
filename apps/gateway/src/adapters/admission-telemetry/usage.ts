import { getMeter } from '@wallpaperdb/core/telemetry';
import type { BatchObservableResult } from '@opentelemetry/api';
import { Effect, Layer } from 'effect';
import { QuotaUsage } from '../../capabilities/admission/index.js';

/** Collection is the driving boundary for usage observation, including during idle traffic. */
export const quotaUsageTelemetryLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const usage = yield* QuotaUsage;
    yield* Effect.acquireRelease(
      Effect.try(() => {
        const meter = getMeter();
        const available = meter.createObservableGauge('admission.usage.available');
        const points = meter.createObservableGauge('admission.usage.points');
        const activeIps = meter.createObservableGauge('admission.usage.active_ips');
        const minute = meter.createObservableGauge('admission.usage.minute');
        const sampledAt = meter.createObservableGauge('admission.usage.sampled_at');
        let closed = false;
        const pending = new Set<Promise<void>>();
        const collect = async (result: BatchObservableResult) => {
          const snapshot = await Effect.runPromise(usage.read());
          if (closed) return;
          result.observe(available, snapshot._tag === 'Available' ? 1 : 0);
          if (snapshot._tag === 'Unavailable') {
            result.observe(points, Number.NaN);
            result.observe(activeIps, Number.NaN);
            result.observe(minute, 0);
            result.observe(sampledAt, 0);
            return;
          }
          result.observe(points, snapshot.points);
          result.observe(activeIps, snapshot.activeIps);
          result.observe(minute, snapshot.minute);
          result.observe(sampledAt, snapshot.sampledAt);
        };
        const callback = (result: BatchObservableResult) => {
          if (closed) return Promise.resolve();
          const work = collect(result);
          pending.add(work);
          return work.finally(() => pending.delete(work));
        };
        meter.addBatchObservableCallback(callback, [
          available,
          points,
          activeIps,
          minute,
          sampledAt,
        ]);
        return async () => {
          closed = true;
          meter.removeBatchObservableCallback(callback, [
            available,
            points,
            activeIps,
            minute,
            sampledAt,
          ]);
          // Storage commands have a deadline and stay owned until they settle.
          await Promise.allSettled(pending);
        };
      }),
      (close) => Effect.tryPromise(close).pipe(Effect.ignore)
    ).pipe(Effect.catch(() => Effect.logWarning('Shared quota usage telemetry unavailable')));
  })
);
