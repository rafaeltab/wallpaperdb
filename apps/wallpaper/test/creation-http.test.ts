import Fastify from 'fastify';
import { get } from 'node:http';
import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import {
  Creation,
  WorkflowHealth,
  CreatorAuthentication,
  WorkflowFailure,
} from '../src/capabilities/creation/index.js';
import { registerCreationHttp } from '../src/http/index.js';

it.each(['authentication', 'listing'] as const)(
  'releases pending list %s work when the HTTP client disconnects',
  async (pending) => {
    let started = false;
    let released = false;
    let finish = () => {};
    const operation = Effect.callback<never>((resume) => {
      finish = () => resume(Effect.die('test cleanup'));
      started = true;
      return Effect.sync(() => {
        released = true;
      });
    });
    const app = Fastify();
    await registerCreationHttp(
      app,
      Layer.merge(
        Layer.succeed(CreatorAuthentication, {
          verify: () =>
            pending === 'authentication'
              ? operation
              : Effect.succeed({ namespace: 'authors', subject: 'creator' }),
        }),
        Layer.succeed(Creation, {
          list: () => operation,
          begin: () => Effect.succeed({ kind: 'unavailable' }),
          get: () => Effect.succeed({ kind: 'unavailable' }),
          expectSource: () => Effect.succeed({ kind: 'unavailable' }),
          assetResult: () => Effect.succeed('ignored'),
          sourceAccepted: () => Effect.succeed('ignored'),
        })
      ).pipe(Layer.merge(Layer.succeed(WorkflowHealth, { check: () => Effect.succeed(true) })))
    );
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const request = get(`${address}/wallpapers`);
    request.on('error', () => {});
    try {
      await expect.poll(() => started).toBe(true);
      request.destroy();
      await expect.poll(() => released, { timeout: 1000 }).toBe(true);
    } finally {
      request.destroy();
      finish();
      app.server.closeAllConnections();
      await app.close();
    }
  }
);

it('bounds list shutdown and releases pending work and service resources', async () => {
  let started = false;
  let released = false;
  let disposed = false;
  let finish = () => {};
  const app = Fastify();
  const creation = Layer.effect(
    Creation,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          disposed = true;
        })
      );
      return Creation.of({
        list: () =>
          Effect.callback<never>((resume) => {
            finish = () => resume(Effect.die('test cleanup'));
            started = true;
            return Effect.sync(() => {
              released = true;
            });
          }),
        begin: () => Effect.succeed({ kind: 'unavailable' }),
        get: () => Effect.succeed({ kind: 'unavailable' }),
        expectSource: () => Effect.succeed({ kind: 'unavailable' }),
        assetResult: () => Effect.succeed('ignored'),
        sourceAccepted: () => Effect.succeed('ignored'),
      });
    })
  );
  await registerCreationHttp(
    app,
    creation.pipe(
      Layer.merge(
        Layer.succeed(CreatorAuthentication, {
          verify: () => Effect.succeed({ namespace: 'authors', subject: 'creator' }),
        })
      ),
      Layer.merge(Layer.succeed(WorkflowHealth, { check: () => Effect.succeed(true) }))
    )
  );
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const response = fetch(`${address}/wallpapers`, { headers: { Connection: 'close' } }).then(
    (r) => r.text(),
    () => 'closed'
  );
  try {
    await expect.poll(() => started).toBe(true);
    const closing = app.close();
    await expect.poll(() => disposed, { timeout: 7000 }).toBe(true);
    await closing;
    expect(released).toBe(true);
    await response;
  } finally {
    finish();
    app.server.closeAllConnections();
    await app.close();
    await response;
  }
});
it('uses verified Creator identity, returns durable progress and hides private workflow fields', async () => {
  const calls: unknown[] = [];
  const services = Layer.merge(
    Layer.succeed(CreatorAuthentication, {
      verify: (authorization) =>
        Effect.succeed(
          authorization === 'Bearer valid' ? { namespace: 'authors', subject: 'creator' } : null
        ),
    }),
    Layer.succeed(Creation, {
      list: () => Effect.succeed([]),
      begin: (owner, key) => {
        calls.push({ owner, key });
        return Effect.succeed({
          kind: 'wallpaper',
          wallpaper: {
            id: 'wallpaper-1',
            owner,
            key,
            commandId: 'private-command',
            creationEventId: 'private-event',
            createdAt: '2026-10-22T00:00:00.000Z',
            state: 'creating-asset',
            assetId: null,
            intent: null,
            sourceId: null,
            initialAnalysisSourceId: null,
          },
        });
      },
      get: () => Effect.succeed({ kind: 'unavailable' }),
      expectSource: () => Effect.succeed({ kind: 'conflict' }),
      assetResult: () => Effect.succeed('ignored'),
      sourceAccepted: () => Effect.succeed('ignored'),
    })
  );
  const app = Fastify();
  await registerCreationHttp(
    app,
    services.pipe(Layer.merge(Layer.succeed(WorkflowHealth, { check: () => Effect.succeed(true) })))
  );
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/wallpapers',
          headers: { 'idempotency-key': 'request-1' },
          payload: {},
        })
      ).statusCode
    ).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/wallpapers',
      headers: { authorization: 'Bearer valid', 'idempotency-key': 'request-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      wallpaperId: 'wallpaper-1',
      state: 'creating-asset',
      assetId: null,
      sourceId: null,
      createdAt: '2026-10-22T00:00:00.000Z',
    });
    expect(
      (await app.inject({ url: '/wallpapers', headers: { authorization: 'Bearer valid' } })).json()
    ).toEqual({ wallpapers: [] });
    expect(calls).toEqual([
      { owner: { namespace: 'authors', subject: 'creator' }, key: 'request-1' },
    ]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/wallpapers',
          headers: { authorization: 'Bearer valid', 'idempotency-key': 'key' },
          payload: { userId: 'attacker' },
        })
      ).statusCode
    ).toBe(400);
    const missing = await app.inject({
      url: '/wallpapers/missing',
      headers: { authorization: 'Bearer valid' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/wallpapers/wallpaper-1/first-source',
          headers: { authorization: 'Bearer valid' },
          payload: { candidateId: 'candidate', intentId: 'intent' },
        })
      ).statusCode
    ).toBe(409);
  } finally {
    await app.close();
  }
});
it('reports infrastructure failure safely as retryable unavailability', async () => {
  const app = Fastify();
  await registerCreationHttp(
    app,
    Layer.merge(
      Layer.succeed(CreatorAuthentication, {
        verify: () => Effect.succeed({ namespace: 'authors', subject: 'creator' }),
      }),
      Layer.succeed(Creation, {
        list: () => Effect.succeed([]),
        begin: () =>
          Effect.fail(
            new WorkflowFailure({ operation: 'private-secret', cause: new Error('password') })
          ),
        get: () => Effect.succeed({ kind: 'unavailable' }),
        expectSource: () => Effect.succeed({ kind: 'unavailable' }),
        assetResult: () => Effect.succeed('ignored'),
        sourceAccepted: () => Effect.succeed('ignored'),
      })
    ).pipe(Layer.merge(Layer.succeed(WorkflowHealth, { check: () => Effect.succeed(true) })))
  );
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/wallpapers',
      headers: { 'idempotency-key': 'key' },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toMatch(/private-secret|password/);
  } finally {
    await app.close();
  }
});
