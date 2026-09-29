import { Deferred, Effect, Layer } from 'effect';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Catalogue, type Profile } from '../src/capabilities/catalogue/index.js';
import { type HttpConfig, createHttpApp } from '../src/http/index.js';
import { EmptyCatalogue, httpConfig, httpTestLayer } from './unit/http-fixture.js';

const profile: Profile = {
  id: 'profile-lifecycle',
  handle: 'lifecycle',
  displayName: 'Lifecycle',
  biographyMarkdown: '',
  pictureAssetId: null,
  claimGeneration: 1,
  version: 1,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
};
const applications: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

function controlledCatalogue(read: Effect.Effect<Profile | null>, onSearch = () => {}) {
  const empty = new EmptyCatalogue();
  return Catalogue.of({
    wallpaper: () => empty.wallpaper(),
    profile: () => read,
    profileByHandle: () => empty.profileByHandle(),
    profiles: (ids) => empty.profiles(ids),
    search: () => Effect.sync(onSearch).pipe(Effect.andThen(empty.search())),
    searchProfiles: () => empty.searchProfiles(),
  });
}
async function serve(
  catalogue: Catalogue,
  shutdownTimeoutMs = 1000,
  overrides: Partial<HttpConfig> = {}
) {
  const config = { ...httpConfig, ...overrides };
  const app = await createHttpApp(config, httpTestLayer(config, { catalogue }), {
    shutdownTimeoutMs,
  });
  applications.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, address };
}
function query(address: string, signal?: AbortSignal) {
  return fetch(`${address}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:
        '{ profile(id: "profile-lifecycle") { id wallpapers { edges { node { wallpaperId } } } } }',
    }),
    signal,
  });
}

describe('HTTP request lifecycle', () => {
  it('rejects excess GraphQL work before inspection or charging and recovers capacity after completion', async () => {
    const release = Deferred.makeUnsafe<void>();
    let entered = false;
    const read = Effect.sync(() => {
      entered = true;
    }).pipe(Effect.andThen(Deferred.await(release)), Effect.as(profile));
    const { address } = await serve(controlledCatalogue(read), 1000, { graphqlMaxActive: 1 });
    const pending = query(address);
    await expect.poll(() => entered).toBe(true);
    const rejected = await fetch(`${address}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'invalid GraphQL' }),
    });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({
      errors: [{ extensions: { code: 'GATEWAY_OVERLOADED' } }],
    });
    expect(rejected.headers.get('x-ratelimit-cost-remaining')).toBeNull();
    expect((await fetch(`${address}/ready`)).status).not.toBe(429);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const first = await pending;
    expect(first.status).toBe(200);
    await first.json();
    const next = await query(address);
    expect(next.status).toBe(200);
    expect(
      Number(first.headers.get('x-ratelimit-cost-remaining')) -
        Number(next.headers.get('x-ratelimit-cost-remaining'))
    ).toBeLessThan(100);
  });

  it('times out underlying work, keeps its charge and recovers after cancellation cleanup', async () => {
    let interrupted = false;
    let reads = 0;
    let searched = false;
    const read = Effect.suspend(() => {
      reads++;
      return reads === 1
        ? Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              })
            )
          )
        : Effect.succeed(profile);
    });
    const { address } = await serve(
      controlledCatalogue(read, () => {
        searched = true;
      }),
      1000,
      { graphqlMaxActive: 1, graphqlDeadlineMs: 50, quotaCapacity: 2000 }
    );
    const timedOut = await query(address);
    expect(timedOut.status).toBe(503);
    expect(await timedOut.json()).toMatchObject({
      errors: [{ extensions: { code: 'GATEWAY_OVERLOADED', reason: 'timeout' } }],
    });
    await expect.poll(() => interrupted).toBe(true);
    expect(searched).toBe(false);
    const next = await query(address);
    expect(next.status).toBe(200);
    expect(Number(next.headers.get('x-ratelimit-cost-remaining'))).toBeLessThan(
      Number(timedOut.headers.get('x-ratelimit-cost-remaining'))
    );
  });

  it('holds a disconnected request slot until its cancellation finalizer settles', async () => {
    const cleanup = Deferred.makeUnsafe<void>();
    let entered = false;
    let cancelling = false;
    let calls = 0;
    const read = Effect.suspend(() => {
      calls++;
      if (calls > 1) return Effect.succeed(profile);
      entered = true;
      return Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cancelling = true;
          }).pipe(Effect.andThen(Deferred.await(cleanup)))
        )
      );
    });
    const { address } = await serve(controlledCatalogue(read), 1000, { graphqlMaxActive: 1 });
    const abort = new AbortController();
    const pending = query(address, abort.signal).catch((error: unknown) => error);
    try {
      await expect.poll(() => entered).toBe(true);
      abort.abort();
      expect(await pending).toBeInstanceOf(Error);
      await expect.poll(() => cancelling).toBe(true);
      expect((await query(address)).status).toBe(503);
      expect(calls).toBe(1);
    } finally {
      await Effect.runPromise(Deferred.succeed(cleanup, undefined));
    }
    await expect.poll(async () => (await query(address)).status).toBe(200);
  });

  it('finishes a whole GraphQL response during shutdown grace, including later nested resolvers', async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let entered = false;
    let searched = false;
    const read = Effect.sync(() => {
      entered = true;
    }).pipe(Effect.andThen(Deferred.await(release)), Effect.as(profile));
    const { app, address } = await serve(
      controlledCatalogue(read, () => {
        searched = true;
      })
    );
    const response = query(address).then((response) => response.json());
    await expect.poll(() => entered).toBe(true);
    const stopped = app.close();
    await expect.poll(() => app.connectionsState.isShuttingDown).toBe(true);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    expect(await response).toEqual({
      data: { profile: { id: profile.id, wallpapers: { edges: [] } } },
    });
    expect(searched).toBe(true);
    await stopped;
  });

  it('interrupts a blocked request and closes its socket after shutdown grace expires', async () => {
    let entered = false;
    let interrupted = false;
    const read = Effect.sync(() => {
      entered = true;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        })
      )
    );
    const { app, address } = await serve(controlledCatalogue(read), 30);
    const response = query(address)
      .then((response) => response.json())
      .catch((error: unknown) => error);
    await expect.poll(() => entered).toBe(true);
    let stopped = false;
    const shutdown = app.close().then(() => {
      stopped = true;
    });
    await expect.poll(() => stopped, { timeout: 1000 }).toBe(true);
    await shutdown;
    expect(interrupted).toBe(true);
    expect(await response).toBeInstanceOf(Error);
  });

  it('interrupts abandoned work without refunding admitted cost', async () => {
    let entered = false;
    let interrupted = false;
    const read = Effect.sync(() => {
      entered = true;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        })
      )
    );
    const { app, address } = await serve(controlledCatalogue(read), 1000, {
      ...httpConfig,
      quotaCapacity: 123,
    });
    const abort = new AbortController();
    const response = query(address, abort.signal).catch((error: unknown) => error);
    await expect.poll(() => entered).toBe(true);
    abort.abort();
    expect(await response).toBeInstanceOf(Error);
    await expect.poll(() => interrupted).toBe(true);
    expect((await query(address)).status).toBe(429);
    await app.close();
  });

  it('releases resources acquired before startup fails and preserves the original failure', async () => {
    let released = false;
    const failure = new Error('controlled startup failure');
    const catalogue = Layer.effect(
      Catalogue,
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            released = true;
          })
        );
        return yield* Effect.fail(failure);
      })
    );
    await expect(
      createHttpApp(httpConfig, httpTestLayer().pipe(Layer.provideMerge(catalogue)))
    ).rejects.toBe(failure);
    expect(released).toBe(true);
  });

  it('waits for acquired resources to close when dependency startup is cancelled', async () => {
    const release = Effect.runSync(Deferred.make<void>());
    const finishCleanup = Effect.runSync(Deferred.make<void>());
    const abort = new AbortController();
    let entered = false;
    let closing = false;
    let closed = false;
    let settled = false;
    const catalogue = Layer.effect(
      Catalogue,
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.gen(function* () {
            closing = true;
            yield* Deferred.await(finishCleanup);
            closed = true;
          })
        );
        entered = true;
        yield* Deferred.await(release);
        return new EmptyCatalogue();
      })
    );
    const startup = createHttpApp(httpConfig, httpTestLayer().pipe(Layer.provideMerge(catalogue)), {
      signal: abort.signal,
    });
    const result = startup
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    try {
      await expect.poll(() => entered).toBe(true);
      abort.abort();
      await expect.poll(() => closing, { timeout: 1000 }).toBe(true);
      expect(settled).toBe(false);
      await Effect.runPromise(Deferred.succeed(finishCleanup, undefined));
      expect(await result).toBeInstanceOf(Error);
      expect(closed).toBe(true);
    } finally {
      await Effect.runPromise(Deferred.succeed(finishCleanup, undefined));
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await startup.then(
        (app) => app.close(),
        () => undefined
      );
    }
  });
});
