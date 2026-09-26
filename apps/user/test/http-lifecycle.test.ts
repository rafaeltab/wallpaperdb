import { Context, Deferred, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Availability } from '../src/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
import { profile, auth, services } from './http-fixture.js';

describe('HTTP composition lifetime', () => {
  it('releases already acquired resources when a later layer fails to start', async () => {
    const Resource = Context.Service<{ readonly acquired: true }>('test.startup.Resource');
    const events: string[] = [];
    const resource = Layer.effect(
      Resource,
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push('acquired');
          return { acquired: true as const };
        }),
        () =>
          Effect.sync(() => {
            events.push('released');
          })
      )
    );
    const failed = Layer.effect(
      Availability,
      Effect.gen(function* () {
        yield* Resource;
        return yield* Effect.fail('late startup failure');
      })
    ).pipe(Layer.provide(resource));
    await expect(
      createHttpApp(
        { nodeEnv: 'test', port: 0 },
        Layer.merge(
          services(() => Effect.die('unreachable')),
          failed
        )
      )
    ).rejects.toBeDefined();
    expect(events).toEqual(['acquired', 'released']);
  });
  it('lets a request finish normally during the shutdown grace period', async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const finish = await Effect.runPromise(Deferred.make<void>());
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 0 },
      services(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ _tag: 'Success', profile } as const)
        )
      ),
      { shutdownTimeoutMs: 1000 }
    );
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const pending = fetch(`${address}/profile/me/ensure`, { method: 'POST', headers: auth });
    try {
      await Effect.runPromise(Deferred.await(started));
      const closing = app.close();
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 'user_owner' });
      await closing;
    } finally {
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      await app.close();
    }
  });
  it('cancels request work when its client disconnects', async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let cancelled = false;
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 0 },
      services(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            })
          )
        )
      )
    );
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const pending = fetch(`${address}/profile/me/ensure`, {
      method: 'POST',
      headers: auth,
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      await Effect.runPromise(Deferred.await(started));
      controller.abort();
      await pending;
      await expect.poll(() => cancelled).toBe(true);
    } finally {
      controller.abort();
      await pending;
      await app.close();
    }
  });
  it('interrupts a blocked request at the shutdown deadline', async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let cancelled = false;
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 0 },
      services(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            })
          )
        )
      ),
      { shutdownTimeoutMs: 10 }
    );
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const pending = fetch(`${address}/profile/me/ensure`, { method: 'POST', headers: auth }).catch(
      () => undefined
    );
    await Effect.runPromise(Deferred.await(started));
    await app.close();
    await pending;
    expect(cancelled).toBe(true);
  });
});
