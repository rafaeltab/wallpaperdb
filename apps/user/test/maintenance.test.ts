import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Maintenance, MaintenanceFailure, MaintenanceStore, ProfileEvents, maintenanceLayer } from '../src/maintenance/index.js';
import { Profiles, ProfileUnavailable } from '../src/profile/index.js';

const unused = () => Effect.die('Unexpected Profile command');
const profiles: Profiles = { ensure: unused, changeHandle: unused, reactivateAlias: unused, scheduleAliasExpiry: unused, expireAliasImmediately: unused, updateDetails: unused, expireDueAlias: () => Effect.succeed(false) };

it('records publication only after broker acceptance and retries the original durable event', async () => {
  const pending = new Set(['event-1', 'event-2']);
  const attempted: string[] = [];
  let unavailable = true;
  const runtime = ManagedRuntime.make(maintenanceLayer({ retentionDays: 30 }).pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(MaintenanceStore, {
      dueAliases: () => Effect.succeed([]),
      recordWallpaperOwnership: () => Effect.void,
      expiredEvents: () => Effect.succeed([]),
      deleteExpiredEvent: () => Effect.succeed(false),
      pendingEvents: () => Effect.succeed([...pending].map((id) => ({ id, createdAt: new Date(0) }))),
      markPublished: (id) => Effect.sync(() => { pending.delete(id); }),
    }),
    Layer.succeed(ProfileEvents, {
      publish: (id) => Effect.suspend(() => {
        attempted.push(id);
        return id === 'event-1' && unavailable
          ? Effect.fail(new MaintenanceFailure({ operation: 'publish', cause: 'offline' }))
          : Effect.void;
      }),
    }),
    Layer.succeed(Profiles, profiles),
  ))));
  try {
    expect(await runtime.runPromise(Effect.flatMap(Maintenance, (service) => service.publishPending()))).toEqual({ completed: 1, failed: 1 });
    expect([...pending]).toEqual(['event-1']);
    unavailable = false;
    expect(await runtime.runPromise(Effect.flatMap(Maintenance, (service) => service.publishPending()))).toEqual({ completed: 1, failed: 0 });
    expect(attempted).toEqual(['event-1', 'event-2', 'event-1']);
    expect([...pending]).toEqual([]);
  } finally { await runtime.dispose(); }
});

it('advances evidence cleanup beyond failures, wraps for retry, and uses the configured rolling cutoff', async () => {
  const pending = new Set(Array.from({ length: 102 }, (_, index) => `event-${String(index).padStart(3, '0')}`));
  const cutoffs: string[] = [];
  let failing = true;
  const runtime = ManagedRuntime.make(maintenanceLayer({ retentionDays: 30 }).pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(MaintenanceStore, {
      dueAliases: () => Effect.succeed([]),
      recordWallpaperOwnership: () => Effect.void,
      pendingEvents: () => Effect.succeed([]), markPublished: () => Effect.void,
      expiredEvents: (cutoff, after) => Effect.sync(() => {
        cutoffs.push(cutoff.toISOString());
        return [...pending].filter((id) => !after || id > after.id).slice(0, 100).map((id) => ({ id, createdAt: new Date(0) }));
      }),
      deleteExpiredEvent: (id) => Effect.suspend(() => id === 'event-000' && failing
        ? Effect.fail(new MaintenanceFailure({ operation: 'delete', cause: 'unavailable' }))
        : Effect.sync(() => pending.delete(id))),
    }),
    Layer.succeed(ProfileEvents, { publish: () => Effect.void }),
    Layer.succeed(Profiles, profiles),
  ))));
  try {
    const cleanup = Effect.flatMap(Maintenance, (service) => service.cleanupEvents(new Date('2030-01-31T00:00:00.000Z')));
    expect(await runtime.runPromise(cleanup)).toEqual({ deleted: 99, failed: 1 });
    expect(await runtime.runPromise(cleanup)).toEqual({ deleted: 2, failed: 0 });
    expect([...pending]).toEqual(['event-000']);
    failing = false;
    expect(await runtime.runPromise(cleanup)).toEqual({ deleted: 1, failed: 0 });
    expect(cutoffs).toEqual(['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']);
  } finally { await runtime.dispose(); }
});

it('expires due claims independently and drains only the current claim when stopping', async () => {
  const attempted: string[] = [];
  let stopping = false;
  const runtime = ManagedRuntime.make(maintenanceLayer({ retentionDays: 30 }).pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(MaintenanceStore, {
      pendingEvents: () => Effect.succeed([]), markPublished: () => Effect.void,
      expiredEvents: () => Effect.succeed([]), deleteExpiredEvent: () => Effect.succeed(false), recordWallpaperOwnership: () => Effect.void,
      dueAliases: () => Effect.succeed(['broken', 'completed', 'skipped'].map((handle) => ({ handle, profileId: handle, claimGeneration: 7, expiresAt: new Date(0) }))),
    }),
    Layer.succeed(ProfileEvents, { publish: () => Effect.void }),
    Layer.succeed(Profiles, { ...profiles, expireDueAlias: (claim) => Effect.suspend(() => {
      attempted.push(claim.handle);
      if (claim.handle === 'broken') return Effect.fail(new ProfileUnavailable({ operation: 'expire', cause: 'offline' }));
      stopping = true;
      return Effect.succeed(true);
    }) }),
  ))));
  try {
    expect(await runtime.runPromise(Effect.flatMap(Maintenance, (service) => service.expireAliases(new Date(), () => stopping)))).toEqual({ completed: 1, failed: 1 });
    expect(attempted).toEqual(['broken', 'completed']);
  } finally { await runtime.dispose(); }
});
