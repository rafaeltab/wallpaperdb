import { Effect, Layer } from 'effect';
import { afterEach, expect, it } from 'vitest';
import { Availability, type Health } from '../src/availability/index.js';
import { createHttpApp } from '../src/http/index.js';

const apps: Awaited<ReturnType<typeof createHttpApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const timestamp = '2026-09-26T12:00:00.000Z';
const health: Health = {
  status: 'healthy',
  checks: { database: true, nats: true, otel: true },
  timestamp,
  totalDurationMs: 7,
};
const services = Layer.succeed(Availability, {
  health: () => Effect.succeed(health),
  ready: () => Effect.succeed({ ready: true, timestamp }),
});
it('serves the operational contracts and leaves tagging unimplemented', async () => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 3008 }, services);
  apps.push(app);
  const response = await app.inject('/health');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    status: 'healthy',
    checks: { database: true, nats: true, otel: true },
    timestamp,
    totalDurationMs: 7,
  });
  expect((await app.inject('/ready')).json()).toEqual({ ready: true, timestamp });
  expect((await app.inject('/tags')).statusCode).toBe(404);
  const document = (await app.inject('/documentation/json')).json();
  expect(document.info.title).toBe('WallpaperDB Tags API');
  expect(Object.keys(document.paths).sort()).toEqual(['/health', '/ready']);
});

it.each([
  ['degraded', 200, { database: false, nats: true, otel: true }],
  ['unhealthy', 503, { database: false, nats: false, otel: false }],
  ['shutting_down', 503, {}],
] as const)('translates %s health with the declared HTTP status', async (status, statusCode, checks) => {
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3008 },
    Layer.succeed(Availability, {
      health: () => Effect.succeed({ status, checks, timestamp }),
      ready: () => Effect.succeed({ ready: false, reason: 'Service is shutting down', timestamp }),
    })
  );
  apps.push(app);
  const response = await app.inject('/health');
  expect(response.statusCode).toBe(statusCode);
  if (statusCode === 200) expect(response.json()).toEqual({ status, checks, timestamp });
  else {
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
      title: 'Service unavailable',
      status: 503,
      healthStatus: status,
      checks,
      timestamp,
    });
  }
});

it('translates unavailable readiness into Problem Details with its safe reason', async () => {
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3008 },
    Layer.succeed(Availability, {
      health: () => Effect.succeed(health),
      ready: () =>
        Effect.succeed({ ready: false, reason: 'Service is not yet initialized', timestamp }),
    })
  );
  apps.push(app);
  const response = await app.inject('/ready');
  expect(response.statusCode).toBe(503);
  expect(response.headers['content-type']).toContain('application/problem+json');
  expect(response.json()).toEqual({
    type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
    title: 'Service unavailable',
    status: 503,
    ready: false,
    reason: 'Service is not yet initialized',
    timestamp,
  });
});

it('returns safe Problem Details for absent routes and unexpected defects', async () => {
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3008 },
    Layer.succeed(Availability, {
      health: () => Effect.die(new Error('database-password=private-marker')),
      ready: () => Effect.succeed({ ready: true, timestamp }),
    })
  );
  apps.push(app);
  for (const [path, status, type, title] of [
    ['/tags', 404, 'not-found', 'Not found'],
    ['/health', 500, 'generic-server', 'Internal server error'],
  ] as const) {
    const response = await app.inject(path);
    expect(response.statusCode).toBe(status);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
      status,
      title,
    });
    expect(response.body).not.toContain('private-marker');
  }
});

it.each([
  ['application/json', '{private-marker', 400, 'Bad Request'],
  ['application/unknown', 'private-marker', 415, 'Unsupported Media Type'],
  ['text/plain', 'private-marker'.repeat(100_000), 413, 'Payload Too Large'],
] as const)('preserves client error statuses for %s request bodies', async (contentType, payload, status, title) => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 3008 }, services);
  apps.push(app);
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { 'content-type': contentType },
    payload,
  });
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  expect(response.json()).toEqual({
    type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-request.md',
    title,
    status,
  });
  expect(response.body).not.toContain('private-marker');
});

it('returns safe Problem Details for malformed URL components', async () => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 3008 }, services);
  apps.push(app);
  const response = await app.inject('/%zz');
  expect(response.statusCode).toBe(400);
  expect(response.headers['content-type']).toContain('application/problem+json');
  expect(response.json()).toEqual({
    type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-request.md',
    title: 'Bad Request',
    status: 400,
  });
});

it.each([
  {},
  { origin: 'http://localhost:3000' },
  { 'access-control-request-method': 'GET' },
])('returns Problem Details for incomplete development preflight headers %j', async (headers) => {
  const app = await createHttpApp({ nodeEnv: 'development', port: 3008 }, services);
  apps.push(app);
  const response = await app.inject({ method: 'OPTIONS', url: '/health', headers });
  expect(response.statusCode).toBe(400);
  expect(response.headers['content-type']).toContain('application/problem+json');
  expect(response.json()).toEqual({
    type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-request.md',
    title: 'Bad Request',
    status: 400,
  });
});

it('continues to accept valid development preflight requests', async () => {
  const app = await createHttpApp({ nodeEnv: 'development', port: 3008 }, services);
  apps.push(app);
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
  });
  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  expect(response.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
});

it.each([
  ['development', 'http://localhost:3000', true],
  ['development', 'https://127.0.0.1:8080', true],
  ['development', 'http://evil-localhost:3000', false],
  ['development', 'http://localhost:3000.evil.example', false],
  ['production', 'http://localhost:3000', false],
] as const)('limits credentialed CORS in %s for %s', async (nodeEnv, origin, allowed) => {
  const app = await createHttpApp({ nodeEnv, port: 3008 }, services);
  apps.push(app);
  const response = await app.inject({ url: '/health', headers: { origin } });
  expect(response.headers['access-control-allow-origin']).toBe(allowed ? origin : undefined);
  if (allowed) expect(response.headers['access-control-allow-credentials']).toBe('true');
});

it('documents Problem Details and the health/readiness extensions for 503 responses', async () => {
  const app = await createHttpApp({ nodeEnv: 'test', port: 3008 }, services);
  apps.push(app);
  const document = (await app.inject('/documentation/json')).json();
  for (const [path, extension] of [
    ['/health', 'healthStatus'],
    ['/ready', 'ready'],
  ]) {
    const schema =
      document.paths[path].get.responses['503'].content['application/problem+json'].schema;
    expect(schema.allOf).toContainEqual({ $ref: '#/components/schemas/ProblemDetails' });
    expect(schema.allOf).toContainEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['type', 'title', 'status', 'timestamp', extension]),
        properties: expect.objectContaining({
          status: { type: 'integer', enum: [503] },
          [extension]: expect.any(Object),
        }),
      })
    );
  }
});

it('releases acquired resources when startup fails', async () => {
  let released = false;
  const failing = Layer.effect(
    Availability,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          released = true;
        })
      );
      return yield* Effect.fail(new Error('startup failed'));
    })
  );
  await expect(createHttpApp({ nodeEnv: 'test', port: 3008 }, failing)).rejects.toThrow(
    'startup failed'
  );
  expect(released).toBe(true);
});

it('passes the current lifecycle state through the driving port', async () => {
  const states: unknown[] = [];
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3008 },
    Layer.succeed(Availability, {
      health: (shuttingDown) =>
        Effect.sync(() => {
          states.push(shuttingDown);
          return health;
        }),
      ready: (shuttingDown, initialized) =>
        Effect.sync(() => {
          states.push({ shuttingDown, initialized });
          return { ready: true, timestamp };
        }),
    })
  );
  apps.push(app);
  await app.inject('/ready');
  app.connectionsState.isShuttingDown = true;
  app.connectionsState.connectionsInitialized = false;
  await app.inject('/health');
  await app.inject('/ready');
  expect(states).toEqual([
    { shuttingDown: false, initialized: true },
    true,
    { shuttingDown: true, initialized: false },
  ]);
});

it('interrupts an unfinished request at the shutdown deadline and releases its scope', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let interrupted = false;
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
        health: () =>
          Effect.sync(entered).pipe(
            Effect.andThen(Effect.promise(() => gate)),
            Effect.andThen(Effect.succeed(health)),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              })
            )
          ),
        ready: () => Effect.succeed({ ready: true, timestamp }),
      });
    })
  );
  const app = await createHttpApp({ nodeEnv: 'test', port: 3008 }, layer, {
    shutdownTimeoutMs: 30,
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const request = fetch(`${address}/health`).then(
    (response) => response.text(),
    () => 'connection closed'
  );
  await started;
  try {
    const closing = app.close();
    await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
    await closing;
    expect(interrupted).toBe(true);
    expect(app.connectionsState.isShuttingDown).toBe(true);
    await request;
  } finally {
    release();
    await request;
    await app.close();
  }
});

it('lets an in-flight network request finish before releasing dependencies', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closed = false;
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3008 },
    Layer.effect(
      Availability,
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed = true;
          })
        );
        return Availability.of({
          health: () =>
            Effect.sync(entered).pipe(
              Effect.andThen(Effect.promise(() => gate)),
              Effect.as(health)
            ),
          ready: () => Effect.succeed({ ready: true, timestamp }),
        });
      })
    ),
    { shutdownTimeoutMs: 1000 }
  );
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const request = fetch(`${address}/health`).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
  await started;
  try {
    const closing = app.close();
    await expect.poll(() => app.connectionsState.isShuttingDown).toBe(true);
    expect(closed).toBe(false);
    release();
    expect(await request).toEqual({ status: 200, body: health });
    await closing;
    expect(closed).toBe(true);
  } finally {
    release();
    await app.close();
  }
}, 5000);
