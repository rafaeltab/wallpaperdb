import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Cause, ConfigProvider, Effect, Exit, Fiber, Scope } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { loadConfig } from '../src/config.js';
import { startGateway } from '../src/server.js';
import { gatewayProgram } from '../src/bootstrap.js';
import { createGatewayTester } from './setup.js';

const execute = promisify(execFile);

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

describe('Gateway bootstrap and deployed artifact', () => {
  const tester = createGatewayTester({ app: false });
  beforeAll(async () => {
    await tester.setup();
    await execute('make', ['gateway-build'], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    });
  });
  afterAll(async () => {
    await tester.destroy();
  });

  function environment(): Record<string, string> {
    return {
      NODE_ENV: 'test',
      OPENSEARCH_URL: tester.search.options.url,
      OPENSEARCH_USERNAME: tester.search.options.username,
      OPENSEARCH_PASSWORD: tester.search.options.password,
      OPENSEARCH_INDEX: tester.search.index('bootstrap_wallpapers'),
      OPENSEARCH_PROFILE_INDEX: tester.search.options.profileIndex,
      NATS_URL: tester.nats.config.endpoints.fromHost,
      NATS_STREAM: 'WALLPAPER',
      REDIS_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'false',
      MEDIA_SERVICE_URL: 'http://media.example.test',
      CURSOR_SECRET: 'gateway-bootstrap-test-secret-over-32-characters',
    };
  }

  it.live('keeps a real listener running until its owner closes the scope', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const running = yield* startGateway({ ...loadConfig(environment()), port: 0 }).pipe(
        Scope.provide(scope)
      );
      const address = running.address.replace('0.0.0.0', '127.0.0.1');
      const response = yield* Effect.promise((signal) => fetch(`${address}/ready`, { signal }));
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ ready: true });
      yield* Scope.close(scope, Exit.void);
      yield* Scope.close(scope, Exit.void);
      yield* Effect.promise((signal) =>
        expect(fetch(`${address}/ready`, { signal })).rejects.toThrow()
      );
    })
  );

  it.live('does not change embedding process signal handlers or exit policy', () =>
    Effect.gen(function* () {
      const sigterm = process.listeners('SIGTERM');
      const sigint = process.listeners('SIGINT');
      const exitCode = process.exitCode;
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* startGateway({ ...loadConfig(environment()), port: 0 });
          expect(process.listeners('SIGTERM')).toEqual(sigterm);
          expect(process.listeners('SIGINT')).toEqual(sigint);
          expect(process.exitCode).toBe(exitCode);
        })
      );
      expect(process.listeners('SIGTERM')).toEqual(sigterm);
      expect(process.listeners('SIGINT')).toEqual(sigint);
      expect(process.exitCode).toBe(exitCode);
    })
  );

  it.live('returns a typed startup failure and releases partially acquired resources', () =>
    Effect.gen(function* () {
      const exitCode = process.exitCode;
      const result = yield* gatewayProgram.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ ...environment(), NATS_URL: 'nats://127.0.0.1:1' })
        ),
        Effect.flip
      );
      expect(result).toMatchObject({ _tag: 'GatewayStartupError', stage: 'application' });
      expect(process.exitCode).toBe(exitCode);
      yield* startGateway({ ...loadConfig(environment()), port: 0 });
    })
  );

  it('cancels blocked dependency initialization and closes its transport before startup exits', async () => {
    let requests = 0;
    let activeConnections = 0;
    const dependency = createHttpServer(() => {
      requests++;
    });
    dependency.on('connection', (socket) => {
      activeConnections++;
      socket.once('close', () => {
        activeConnections--;
      });
    });
    dependency.listen(0, '127.0.0.1');
    await once(dependency, 'listening');
    const address = dependency.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const pending = Effect.runFork(
      startGateway({
        ...loadConfig(environment()),
        opensearchUrl: `http://127.0.0.1:${address.port}`,
        port: 0,
      }).pipe(Effect.scoped)
    );
    try {
      await expect.poll(() => requests).toBe(1);
      pending.interruptUnsafe();
      await expect.poll(() => activeConnections).toBe(0);
      await expect.poll(() => pending.pollUnsafe(), { timeout: 2000 }).toBeDefined();
      const result = await Effect.runPromise(Fiber.await(pending));
      if (!Exit.isFailure(result)) throw new Error('Cancelled startup should be interrupted');
      expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);
      expect(requests).toBe(1);
    } finally {
      dependency.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        dependency.close((error) => (error ? reject(error) : resolve()))
      );
      await Effect.runPromise(Fiber.interrupt(pending));
    }
  });

  it.live(
    'releases a failed listener startup without disturbing the process that owns the port',
    () =>
      Effect.gen(function* () {
        const config = yield* Effect.scoped(
          Effect.gen(function* () {
            const reservation = yield* Effect.acquireRelease(
              Effect.sync(() => createHttpServer((_request, response) => response.end('reserved'))),
              (server) =>
                Effect.promise(
                  () =>
                    new Promise<void>((resolve, reject) => {
                      if (!server.listening) return resolve();
                      server.close((error) => (error ? reject(error) : resolve()));
                    })
                )
            );
            yield* Effect.promise(
              () =>
                new Promise<void>((resolve, reject) => {
                  reservation.once('error', reject);
                  reservation.listen(0, '127.0.0.1', resolve);
                })
            );
            const address = reservation.address();
            if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
            const config = { ...loadConfig(environment()), port: address.port };
            const failure = yield* startGateway(config).pipe(Effect.scoped, Effect.flip);
            expect(failure).toMatchObject({ _tag: 'GatewayStartupError', stage: 'listener' });
            const response = yield* Effect.promise((signal) =>
              fetch(`http://127.0.0.1:${address.port}`, { signal })
            );
            expect(yield* Effect.promise(() => response.text())).toBe('reserved');
            return config;
          })
        );
        const url = `http://127.0.0.1:${config.port}`;
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* startGateway(config);
            const response = yield* Effect.promise((signal) => fetch(`${url}/ready`, { signal }));
            expect(response.status).toBe(200);
          })
        );
        yield* Effect.promise((signal) =>
          expect(fetch(`${url}/ready`, { signal })).rejects.toThrow()
        );
      })
  );

  it.live('runs the source bootstrap until interruption and releases its real listener', () =>
    Effect.gen(function* () {
      const port = yield* Effect.promise(availablePort);
      const pending = yield* Effect.forkScoped(
        gatewayProgram.pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ ...environment(), PORT: String(port) })
          )
        )
      );
      const address = `http://127.0.0.1:${port}`;
      yield* Effect.promise((signal) =>
        expect
          .poll(
            async () => {
              try {
                return (await fetch(`${address}/ready`, { signal })).status;
              } catch {
                return 0;
              }
            },
            { timeout: 15000, interval: 50 }
          )
          .toBe(200)
      );
      const response = yield* Effect.promise((signal) => fetch(`${address}/health`, { signal }));
      expect(response.status).toBe(200);
      yield* Fiber.interrupt(pending);
      const result = yield* Fiber.await(pending);
      if (!Exit.isFailure(result))
        throw new Error('Interrupted bootstrap should return interruption');
      expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);
      yield* Effect.promise((signal) =>
        expect(fetch(`${address}/ready`, { signal })).rejects.toThrow()
      );
    })
  );

  it.live('fails source bootstrap with safe typed configuration diagnostics', () =>
    Effect.gen(function* () {
      const suppliedSecret = 'private-short-secret';
      const result = yield* gatewayProgram.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ ...environment(), CURSOR_SECRET: suppliedSecret })
        ),
        Effect.flip
      );
      expect(result).toMatchObject({
        _tag: 'GatewayConfigurationError',
        fields: ['CURSOR_SECRET'],
      });
      expect(JSON.stringify(result)).not.toContain(suppliedSecret);
    })
  );

  it.each([
    'environment',
    'dotenv',
  ])('starts the built service with %s configuration, serves GraphQL, and exits cleanly on SIGINT', async (source) => {
    const port = await availablePort();
    const directory = await mkdtemp(join(tmpdir(), 'gateway-bootstrap-'));
    const config = { ...environment(), PORT: String(port) };
    if (source === 'dotenv') {
      await writeFile(
        join(directory, '.env'),
        Object.entries(config)
          .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
          .join('\n')
      );
    }
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.mjs', import.meta.url))],
      {
        cwd: directory,
        env: source === 'dotenv' ? {} : config,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = once(child, 'exit');
    try {
      await expect
        .poll(
          async () => {
            if (child.exitCode !== null)
              throw new Error(`Built gateway exited prematurely: ${output}`);
            try {
              return (await fetch(`http://127.0.0.1:${port}/ready`)).status;
            } catch {
              return 0;
            }
          },
          { timeout: 15000, interval: 50 }
        )
        .toBe(200);
      const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ searchWallpapers { edges { node { wallpaperId } } } }' }),
      });
      expect(await response.json()).toEqual({ data: { searchWallpapers: { edges: [] } } });
      child.kill('SIGINT');
      await expect.poll(() => child.exitCode, { timeout: 10000, interval: 25 }).toBe(0);
      expect(await exited).toEqual([0, null]);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
