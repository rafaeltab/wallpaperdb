import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';
import { describe, expect, it, vi } from 'vitest';
import { startDevelopmentWatcher } from './fixtures/development-watcher.js';
import { syntheticWorkflow } from './fixtures/synthetic-workflow.js';

describe('Wallpaper development watch entry', () => {
  it('restarts and adopts a private broker-worker-only edit', async () => {
    const releases: Array<() => Promise<unknown>> = [];
    const failures: unknown[] = [];
    try {
      const root = await mkdtemp(join(tmpdir(), 'wallpaper-development-watch-'));
      releases.push(() => rm(root, { recursive: true, force: true }));
      const directory = join(root, 'apps/wallpaper');
      await mkdir(directory, { recursive: true });
      // pnpm's installed bin wrappers resolve relative to the workspace layout.
      await symlink(resolve('../../node_modules'), join(root, 'node_modules'), 'dir');
      // Copy only public source and its package metadata, never local configuration.
      await cp('src', join(directory, 'src'), { recursive: true });
      await cp('package.json', join(directory, 'package.json'));
      await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
      const postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start();
      releases.push(() => postgres.stop());
      const databaseUrl = `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/wallpaper`;
      const { nats, brokerUrl, workflowFile } = await syntheticWorkflow(
        root,
        databaseUrl,
        (release) => releases.push(release)
      );
      const port = await availablePort();
      const dockerfile = await readFile('Dockerfile.dev', 'utf8');
      const watcher = startDevelopmentWatcher(dockerfile, directory, {
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        NATS_URL: brokerUrl,
        WALLPAPER_WORKFLOW_FILE: workflowFile,
      });
      releases.push(watcher.stop);
      const health = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        return response.json();
      };
      await vi.waitFor(
        async () =>
          expect(await health()).toMatchObject({
            checks: { database: true, nats: true },
          }),
        { timeout: 10000 }
      );
      await watcher.recordProcesses('before worker edit');
      const worker = join(directory, 'src/adapters/dependencies/broker-worker.ts');
      const original = await readFile(worker, 'utf8');
      const changed = original.replace(
        "port.postMessage('healthy')",
        "port.postMessage(new Error('development watch fixture changed worker'))"
      );
      expect(changed).not.toBe(original);
      await writeFile(worker, changed);
      console.info('Edited only disposable broker worker', { worker });
      try {
        await vi.waitFor(
          async () =>
            expect(await health()).toMatchObject({
              checks: { database: true, nats: false },
            }),
          { timeout: 10000 }
        );
        console.info('Development watch adopted changed worker behavior');
      } finally {
        await watcher.recordProcesses('after worker edit');
        console.info('Development watcher output', watcher.output());
      }
      await watcher.stop();
      const connections = async () => {
        const response = await fetch(`http://${nats.getHost()}:${nats.getMappedPort(8222)}/connz`, {
          signal: AbortSignal.timeout(1000),
        });
        return response.json();
      };
      await expect.poll(connections).toMatchObject({ num_connections: 0 });
      await expect(
        fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        })
      ).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } });
    } catch (cause) {
      failures.push(cause);
    } finally {
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (cause) {
          failures.push(cause);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length)
      throw new AggregateError(failures, 'Development watch check and cleanup failed');
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
