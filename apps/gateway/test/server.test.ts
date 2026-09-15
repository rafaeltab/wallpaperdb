import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { startGateway } from '../src/server.js';
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
      OPENSEARCH_URL: tester.opensearch.config.endpoint.fromHost,
      OPENSEARCH_USERNAME: tester.opensearch.config.username,
      OPENSEARCH_PASSWORD: tester.opensearch.config.password,
      OPENSEARCH_INDEX: 'bootstrap_wallpapers',
      NATS_URL: tester.nats.config.endpoints.fromHost,
      NATS_STREAM: 'WALLPAPER',
      REDIS_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'false',
      MEDIA_SERVICE_URL: 'http://media.example.test',
      CURSOR_SECRET: 'gateway-bootstrap-test-secret-over-32-characters',
    };
  }

  it('keeps a real listener running until explicit, idempotent shutdown', async () => {
    const running = await startGateway({ ...loadConfig(environment()), port: 0 }, null);
    if (!running) throw new Error('Gateway failed to start');
    try {
      const response = await fetch(`${running.address.replace('0.0.0.0', '127.0.0.1')}/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ready: true });
    } finally {
      await Promise.all([running.stop(), running.stop()]);
    }
    await expect(fetch(`${running.address}/ready`)).rejects.toThrow();
  });

  it('handles the process shutdown signal and shares its completion with explicit shutdown', async () => {
    const running = await startGateway({ ...loadConfig(environment()), port: 0 }, null);
    if (!running) throw new Error('Gateway failed to start');
    process.emit('SIGTERM');
    await running.stop();
    await expect(fetch(`${running.address}/ready`)).rejects.toThrow();
  });

  it('returns a failed startup status after closing partially acquired resources', async () => {
    const originalExitCode = process.exitCode;
    try {
      const result = await startGateway(
        { ...loadConfig(environment()), natsUrl: 'nats://127.0.0.1:1', port: 0 },
        null
      );
      expect(result).toBeUndefined();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('starts the built service, serves GraphQL, and exits cleanly on SIGINT', async () => {
    const port = await availablePort();
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.mjs', import.meta.url))],
      {
        cwd: '/tmp',
        env: { ...environment(), PORT: String(port) },
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
    }
  });
});
