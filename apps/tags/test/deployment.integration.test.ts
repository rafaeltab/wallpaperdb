import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('deployed tag service skeleton', () => {
  let postgres: StartedTestContainer;
  let nats: StartedNatsContainer;
  let directory: string;

  beforeAll(async () => {
    await import('../esbuild.config.js');
    directory = await mkdtemp(join(tmpdir(), 'tags-deployment-'));
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'tags' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    nats = await createNatsContainer({ enableJetStream: false });
  });

  afterAll(async () => {
    await Promise.all([
      nats?.stop(),
      postgres?.stop(),
      directory ? rm(directory, { recursive: true, force: true }) : Promise.resolve(),
    ]);
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
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/tags`,
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
      const tags = await fetch(`${url}/tags`, { signal: AbortSignal.timeout(1000) });
      expect(tags.status).toBe(404);
      await tags.arrayBuffer();
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

  it('rejects malformed configuration without serving requests or exposing the supplied value', async () => {
    const port = await availablePort();
    const service = startArtifact(directory, {
      PORT: String(port),
      DATABASE_URL: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/tags`,
      NATS_URL: nats.getConnectionUrl(),
      // Enum validation includes this input in its raw diagnostic. Only NODE_ENV is malformed.
      NODE_ENV: 'https://tags:private-configuration-marker@database.example/tags',
    });
    try {
      expect(await service.waitForExit()).toEqual({ code: 1, signal: null });
      expect(service.output()).toContain('Invalid tags configuration');
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
