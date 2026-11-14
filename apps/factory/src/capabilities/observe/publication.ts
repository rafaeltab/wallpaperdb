import { Effect, Layer, Semaphore } from 'effect';
import { Reporting, ReportingStore, type ItemObservation } from './contract.js';
import { jobObservationIsOlder } from './ordering.js';

/** Fixed one-second cadence, bounded to 100 distinct pending items. */
export const ReportingLive = Layer.effect(
  Reporting,
  Effect.gen(function* () {
    const store = yield* ReportingStore;
    const lock = yield* Semaphore.make(1);
    const pending = new Map<string, { generation: number; item: ItemObservation }>();
    const flush = () =>
      Effect.gen(function* () {
        const batch = [...pending.values()];
        if (!batch.length) return;
        yield* store.publish(
          Math.max(...batch.map((entry) => entry.generation)),
          batch
            .sort((a, b) => a.generation - b.generation || a.item.sequence - b.item.sequence)
            .map(({ generation, item }) => ({ ...item, generation }))
        );
        for (const { item } of batch) pending.delete(key(item));
      });
    const flushLocked = () => flush().pipe(lock.withPermits(1));
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.sleep('1 second').pipe(Effect.andThen(flushLocked()), Effect.catch(Effect.logError))
      )
    );
    yield* Effect.addFinalizer(() => flushLocked().pipe(Effect.catch(Effect.logError)));
    return {
      begin: store.begin,
      flush: flushLocked,
      immediate: store.publish,
      enqueue: (generation, items) =>
        Effect.gen(function* () {
          for (const item of items) {
            const id = key(item);
            if (!pending.has(id) && pending.size >= 100) yield* flush();
            const previous = pending.get(id);
            if (
              previous?.item.kind === 'job' &&
              item.kind === 'job' &&
              jobObservationIsOlder(previous.item.value, item.value)
            )
              continue;
            if (
              !previous ||
              previous.generation < generation ||
              (previous.generation === generation && previous.item.sequence < item.sequence)
            ) {
              pending.set(id, { generation, item });
            }
            if (pending.size >= 100) yield* flush();
          }
        }).pipe(lock.withPermits(1)),
    } satisfies Reporting;
  })
);
function key(item: ItemObservation) {
  return item.kind === 'failure'
    ? `failure:${item.key}`
    : item.kind === 'job'
      ? `job:${item.value.intent.id}`
      : `${item.kind}:${item.value.number}`;
}
