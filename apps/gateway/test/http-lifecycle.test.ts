import { Deferred, Effect, Layer } from 'effect';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Catalogue, type Profile, type ReadOutcome } from '../src/catalogue/index.js';
import { createHttpApp } from '../src/http/index.js';
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

function controlledCatalogue(
  read: Effect.Effect<ReadOutcome<Profile | null>>,
  onSearch = () => {}
) {
  const empty = new EmptyCatalogue();
  return Catalogue.of({
    wallpaper: () => empty.wallpaper(),
    profile: () => read,
    profileByHandle: () => read,
    profiles: (ids) => empty.profiles(ids),
    search: () => Effect.sync(onSearch).pipe(Effect.andThen(empty.search())),
  });
}
async function serve(catalogue: Catalogue, shutdownTimeoutMs = 1000) {
  const app = await createHttpApp(httpConfig, httpTestLayer(httpConfig, { catalogue }), {
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
  it('finishes a whole GraphQL response during shutdown grace, including later nested resolvers', async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let entered = false;
    let searched = false;
    const read = Effect.sync(() => {
      entered = true;
    }).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as({ _tag: 'Found', value: profile } satisfies ReadOutcome<Profile>)
    );
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

  it('interrupts the capability effect when the client abandons the response', async () => {
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
    const { app, address } = await serve(controlledCatalogue(read));
    const abort = new AbortController();
    const response = query(address, abort.signal).catch((error: unknown) => error);
    await expect.poll(() => entered).toBe(true);
    abort.abort();
    expect(await response).toBeInstanceOf(Error);
    await expect.poll(() => interrupted).toBe(true);
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
});
