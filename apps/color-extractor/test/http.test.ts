import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Availability, AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
const services = availabilityLayer.pipe(
  Layer.provide(
    Layer.succeed(AvailabilityProbe, {
      inspect: () => Effect.succeed({ s3: true, nats: true, otel: true, consumer: true }),
    })
  )
);
it('documents successful and unavailable health/readiness response bodies', async () => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 3007 }, services);
  try {
    const document = (await app.inject('/documentation/json')).json();
    for (const [path, success, extension] of [
      ['/health', 'HealthResponse', 'healthStatus'],
      ['/ready', 'ReadyResponse', 'ready'],
    ]) {
      const responses = document.paths[path].get.responses;
      expect(responses['200'].content['application/json'].schema).toEqual({
        $ref: `#/components/schemas/${success}`,
      });
      const unavailable = responses['503'].content['application/problem+json'].schema;
      expect(unavailable.allOf).toContainEqual({ $ref: '#/components/schemas/ProblemDetails' });
      expect(unavailable.allOf).toContainEqual(
        expect.objectContaining({
          required: expect.arrayContaining(['type', 'title', 'status', 'timestamp', extension]),
          properties: expect.objectContaining({
            status: { type: 'integer', enum: [503] },
            timestamp: { type: 'string' },
            [extension]: expect.any(Object),
          }),
        })
      );
    }
  } finally {
    await app.close();
  }
});
it('serves health, readiness, OpenAPI, CORS and safe errors', async () => {
  const app = await createHttpApp({ nodeEnv: 'development', port: 3007 }, services);
  try {
    expect((await app.inject('/health')).json()).toMatchObject({
      status: 'healthy',
      checks: { s3: true, nats: true, otel: true, consumer: true },
    });
    expect((await app.inject('/ready')).json()).toMatchObject({ ready: true });
    expect((await app.inject('/documentation/json')).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/health', headers: { origin: 'http://localhost:3000' } })).headers[
        'access-control-allow-origin'
      ]
    ).toBe('http://localhost:3000');
    expect(
      (await app.inject({ url: '/health', headers: { origin: 'http://evil-localhost:3000' } }))
        .headers['access-control-allow-origin']
    ).toBeUndefined();
    expect((await app.inject('/missing')).json()).toMatchObject({
      status: 404,
      type: expect.stringContaining('/not-found.md'),
    });
    app.connectionsState.isShuttingDown = true;
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 503, healthStatus: 'shutting_down' });
    expect((await app.inject('/ready')).json()).toMatchObject({
      status: 503,
      ready: false,
      reason: 'Service is shutting down',
    });
    app.connectionsState.isShuttingDown = false;
    app.connectionsState.connectionsInitialized = false;
    expect((await app.inject('/ready')).json()).toMatchObject({
      ready: false,
      reason: 'Service is not yet initialized',
    });
  } finally {
    await app.close();
  }
});
it('hides defects and releases scoped services on close', async () => {
  let closed = false;
  const layer = Layer.effect(
    Availability,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
        })
      );
      return Availability.of({
        health: () => Effect.die(new Error('secret')),
        ready: () => Effect.die(new Error('secret')),
      });
    })
  );
  const app = await createHttpApp({ nodeEnv: 'test', port: 3007 }, layer);
  const result = await app.inject('/health');
  expect(result.statusCode).toBe(500);
  expect(result.body).not.toContain('secret');
  await app.close();
  expect(closed).toBe(true);
});
it('releases acquired services when graph startup fails', async () => {
  let closed = false;
  const layer = Layer.effect(
    Availability,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
        })
      );
      return yield* Effect.fail('startup-failed');
    })
  );
  await expect(createHttpApp({ nodeEnv: 'test', port: 3007 }, layer)).rejects.toBeDefined();
  expect(closed).toBe(true);
});
