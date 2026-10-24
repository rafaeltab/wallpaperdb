import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dependencyProxy } from './fixtures/dependency-proxy.js';

describe('deployed Wallpaper service skeleton', () => {
  let postgres: StartedTestContainer;
  let nats: StartedNatsContainer;
  let directory: string;
  const proxies: Array<Awaited<ReturnType<typeof dependencyProxy>>> = [];
  const services: Array<ReturnType<typeof startArtifact>> = [];

  beforeAll(async () => {
    await import('../esbuild.config.js');
    directory = await mkdtemp(join(tmpdir(), 'wallpaper-deployment-'));
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    nats = await createNatsContainer({ enableJetStream: false });
  });

  afterEach(async () => {
    const results = await Promise.allSettled([
      ...services.splice(0).map((service) => service.stop()),
      ...proxies.splice(0).map((proxy) => proxy.close()),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason));
  });

  afterAll(async () => {
    const results = await Promise.allSettled([
      nats?.stop(),
      postgres?.stop(),
      directory ? rm(directory, { recursive: true, force: true }) : Promise.resolve(),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason));
  });

  const connections = async () => {
    const response = await fetch(
      `http://${nats.getHost()}:${nats.getContainer().getMappedPort(8222)}/connz`,
      { signal: AbortSignal.timeout(1000) }
    );
    return response.json();
  };

  it('serves operational endpoints and releases its broker session on SIGTERM', async () => {
    const port = await availablePort();
    const service = startArtifact(directory, {
      PORT: String(port),
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`,
      NATS_URL: nats.getConnectionUrl(),
    });
    const url = `http://127.0.0.1:${port}`;
    try {
      await vi.waitFor(
        async () => {
          expect(service.exit(), service.output()).toBeUndefined();
          const ready = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(1000) });
          expect(ready.status).toBe(200);
          expect(await ready.json()).toMatchObject({ ready: true });
        },
        { timeout: 10000 }
      );
      const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        status: 'healthy',
        checks: { database: true, nats: true, otel: true },
      });
      const wallpaper = await fetch(`${url}/wallpaper`, { signal: AbortSignal.timeout(1000) });
      expect(wallpaper.status).toBe(404);
      await wallpaper.arrayBuffer();
      await expect.poll(connections).toMatchObject({ num_connections: 1 });
      service.child.kill('SIGTERM');
      expect(await service.waitForExit()).toEqual({ code: 0, signal: null });
      await expect.poll(connections).toMatchObject({ num_connections: 0 });
      await expect(
        fetch(`${url}/ready`, { signal: AbortSignal.timeout(1000) })
      ).rejects.toMatchObject({
        cause: { code: 'ECONNREFUSED' },
      });
    } finally {
      await service.stop();
    }
  });

  it('recovers readiness after RTT and pre-INFO timeouts in the bundled process and shuts down concurrent work', async () => {
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const port = await availablePort();
    const service = startArtifact(directory, {
      PORT: String(port),
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`,
      NATS_URL: `nats://127.0.0.1:${proxy.port}`,
    });
    services.push(service);
    const readiness = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, {
        signal: AbortSignal.timeout(3000),
      });
      return { status: response.status, body: await response.json() };
    };
    await vi.waitFor(async () => expect(await readiness()).toMatchObject({ status: 200 }), {
      timeout: 10000,
    });
    const threadCount = async () => (await readdir(`/proc/${service.child.pid}/task`)).length;
    const healthyThreads = await threadCount();
    for (let cycle = 0; cycle < 2; cycle++) {
      proxy.block();
      expect(await readiness()).toMatchObject({ status: 503, body: { ready: false } });
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.unblock();
      proxy.pause();
      expect(await readiness()).toMatchObject({ status: 503, body: { ready: false } });
      await expect.poll(proxy.socketCount).toBe(0);
      expect(await threadCount()).toBeLessThanOrEqual(healthyThreads);
      proxy.resume();
      expect(await readiness()).toMatchObject({ status: 200, body: { ready: true } });
      expect(proxy.socketCount()).toBe(2);
      expect(await threadCount()).toBe(healthyThreads);
    }
    proxy.block();
    const concurrent = Array.from({ length: 3 }, readiness);
    await expect.poll(proxy.hasBlockedTraffic).toBe(true);
    service.child.kill('SIGTERM');
    const stopping = Promise.allSettled([service.waitForExit(), ...concurrent]);
    // Broker work has its own two-second bound; HTTP retains its existing five-second drain.
    await expect.poll(proxy.socketCount, { timeout: 3000 }).toBe(0);
    const results = await stopping;
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { code: 0, signal: null } });
    await expect.poll(proxy.socketCount).toBe(0);
    await expect.poll(connections).toMatchObject({ num_connections: 0 });
  });

  it('reaps the bundled worker when initial acquisition stalls before broker INFO', async () => {
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    proxy.pause();
    const service = startArtifact(directory, {
      PORT: String(await availablePort()),
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`,
      NATS_URL: `nats://127.0.0.1:${proxy.port}`,
    });
    services.push(service);
    const startedAt = Date.now();
    expect(await service.waitForExit()).toEqual({ code: 1, signal: null });
    expect(Date.now() - startedAt).toBeLessThan(4000);
    await expect.poll(proxy.socketCount).toBe(0);
    await expect.poll(connections).toMatchObject({ num_connections: 0 });
  });

  it('rejects malformed configuration without serving requests or exposing the supplied value', async () => {
    const port = await availablePort();
    const service = startArtifact(directory, {
      PORT: String(port),
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`,
      NATS_URL: nats.getConnectionUrl(),
      // Enum validation includes this input in its raw diagnostic. Only NODE_ENV is malformed.
      NODE_ENV: 'https://wallpaper:private-configuration-marker@database.example/wallpaper',
    });
    try {
      expect(await service.waitForExit()).toEqual({ code: 1, signal: null });
      expect(service.output()).toContain('Invalid wallpaper configuration');
      expect(service.output()).not.toContain('private-configuration-marker');
      await expect(
        fetch(`http://127.0.0.1:${port}/ready`, {
          signal: AbortSignal.timeout(1000),
        })
      ).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } });
      expect(await connections()).toMatchObject({ num_connections: 0 });
    } finally {
      await service.stop();
    }
  });
});

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!address || typeof address === 'string') throw new Error('Missing available TCP port');
  return address.port;
}

function startArtifact(directory: string, environment: Record<string, string>) {
  let output = '';
  let exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  const child = spawn(process.execPath, [resolve('dist/index.mjs')], {
    cwd: directory,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !name.startsWith('OTEL_') && !name.startsWith('DOTENV_') && name !== 'NODE_OPTIONS'
        )
      ),
      NODE_ENV: 'production',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.info('Owned Wallpaper artifact process', { pid: child.pid });
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });
  child.once('error', (error) => {
    output += error.message;
    exit = { code: null, signal: null };
  });
  const waitForExit = async () => {
    await vi.waitFor(() => expect(exit, output).toBeDefined(), { timeout: 10000 });
    return exit;
  };
  return {
    child,
    output: () => output,
    exit: () => exit,
    waitForExit,
    stop: async () => {
      if (!exit) child.kill('SIGKILL');
      await waitForExit();
    },
  };
}
