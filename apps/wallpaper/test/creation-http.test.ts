import Fastify from 'fastify';
import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import {
  Creation,
  WorkflowHealth,
  CreatorAuthentication,
  WorkflowFailure,
} from '../src/capabilities/creation/index.js';
import { registerCreationHttp } from '../src/http/creation.js';
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
