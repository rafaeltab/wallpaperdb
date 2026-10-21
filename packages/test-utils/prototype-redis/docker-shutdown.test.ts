import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import Docker from 'dockerode';
import { getContainerRuntimeClient } from 'testcontainers';
import { expect, it, vi } from 'vitest';
import { createGroup, docker, timing } from './fixture';

it.each([
  'stop',
  'remove',
  'list',
  'all',
] as const)('cancels stalled Docker %s requests and preserves earlier cleanup errors', async (stalled) => {
  const metrics = timing();
  const client = (await getContainerRuntimeClient()).container;
  const runtime = client.dockerode;
  const realContainer = runtime.getContainer.bind(runtime);
  const realStop = client.stop.bind(client);
  const realRemove = client.remove.bind(client);
  const restores: Array<() => void> = [];
  const sockets = new Set<Socket>();
  const pending = new Map<ServerResponse, string>();
  const attempts: string[] = [];
  let released = false;
  let ownedId = '';
  let group: Awaited<ReturnType<typeof createGroup>> | undefined;
  let running: Promise<unknown> | undefined;
  let closing: Promise<unknown> | undefined;
  let releaseCase: (() => void) | undefined;
  let failure: unknown;
  let failed = false;
  const cleanupErrors: unknown[] = [];
  async function bounded(operation: Promise<unknown>, timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('test cleanup timed out')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function cleanup(operation: () => unknown) {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  function finish(response: ServerResponse, phase: string) {
    if (phase === 'list') {
      if (!response.headersSent) response.writeHead(200, { Connection: 'close' });
      response.end(response.headersSent && pending.has(response) ? ']' : '[]');
    } else {
      response.writeHead(204, { Connection: 'close' });
      response.end();
    }
  }
  const server = createServer((request, response) => {
    request.resume();
    const phase =
      request.method === 'GET' ? 'list' : request.method === 'DELETE' ? 'remove' : 'stop';
    attempts.push(phase);
    if (!released && (phase === stalled || stalled === 'all')) {
      pending.set(response, phase);
      response.on('close', () => pending.delete(response));
      if (phase === 'list') {
        response.writeHead(200, { Connection: 'close' });
        response.write('[');
      }
    } else {
      finish(response, phase);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  try {
    // Capture the owned ID while preserving real container startup.
    let startedId = '';
    const capture = vi.spyOn(runtime, 'getContainer').mockImplementation((id) => {
      startedId = id;
      return realContainer(id);
    });
    restores.push(() => capture.mockRestore());
    group = await createGroup(metrics, 100);
    ownedId = startedId;
    capture.mockRestore();
    assert.ok(ownedId, 'startup must expose the owned Redis container ID');

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const controlled = new Docker({ host: '127.0.0.1', port: address.port, protocol: 'http' });
    const getContainer = vi
      .spyOn(runtime, 'getContainer')
      .mockImplementation((id) =>
        id === ownedId ? controlled.getContainer(id) : realContainer(id)
      );
    restores.push(() => getContainer.mockRestore());
    // Legacy Testcontainers teardown retains the container acquired during setup.
    const stop = vi.spyOn(client, 'stop').mockImplementation(async (container, options) => {
      if (container.id !== ownedId) return realStop(container, options);
      await controlled.getContainer(container.id).stop({ t: (options?.timeout ?? 0) / 1000 });
    });
    restores.push(() => stop.mockRestore());
    const remove = vi.spyOn(client, 'remove').mockImplementation(async (container, options) => {
      if (container.id !== ownedId) return realRemove(container, options);
      await controlled.getContainer(container.id).remove({ v: options?.removeVolumes });
    });
    restores.push(() => remove.mockRestore());
    const runtimeList = vi
      .spyOn(runtime, 'listContainers')
      .mockImplementation(controlled.listContainers.bind(controlled));
    restores.push(() => runtimeList.mockRestore());
    const list = vi
      .spyOn(docker, 'listContainers')
      .mockImplementation(controlled.listContainers.bind(controlled));
    restores.push(() => list.mockRestore());

    let entered = false;
    const blocked = new Promise<void>((resolve) => {
      releaseCase = resolve;
    });
    running = group
      .runCase('stuck', async () => {
        entered = true;
        await blocked;
      })
      .catch((error: unknown) => error);
    let settled = false;
    await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
    closing = group.close().catch((error: unknown) => error);
    void closing.finally(() => {
      settled = true;
    });
    await expect.poll(() => settled, { timeout: 9000 }).toBe(true);
    const error = await closing;
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors;
    expect(errors.map(String).join(' ')).toContain('pending cases');
    const caseError = await running;
    expect(caseError).toBeInstanceOf(Error);
    expect(errors).toContain((caseError as Error).cause);
    for (const phase of stalled === 'all' ? ['stop', 'remove', 'list'] : [stalled]) {
      expect(errors.map(String).join(' ')).toContain(`Docker ${phase}`);
    }
    expect(errors.map(String).join(' ')).toContain(ownedId);
    expect(attempts).toEqual(['stop', 'remove', 'list']);
    await expect.poll(() => sockets.size, { timeout: 1500 }).toBe(0);
    if (stalled === 'list' || stalled === 'all') expect(metrics.containersRemoved).toBe(0);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      // Release legacy requests so the red regression can finish its real HTTP work.
      released = true;
      for (const [response, phase] of pending) {
        await cleanup(() => {
          if (!response.destroyed) finish(response, phase);
        });
      }
      releaseCase?.();
      await cleanup(() =>
        bounded(
          Promise.allSettled([running, closing ?? group?.close().catch((error: unknown) => error)]),
          5000
        )
      );
      for (const restore of restores.reverse()) await cleanup(restore);
      await cleanup(() => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
      });
      await cleanup(() =>
        bounded(
          new Promise<void>((resolve, reject) => {
            if (!server.listening) return resolve();
            server.close((error) => (error ? reject(error) : resolve()));
          }),
          1000
        )
      );
    } finally {
      // The controlled daemon never removes the real, uniquely owned container.
      await cleanup(async () => {
        if (!ownedId) return;
        const options = { force: true, v: true, abortSignal: AbortSignal.timeout(5000) };
        try {
          await realContainer(ownedId).remove(options);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            error.statusCode === 404
          )
            return;
          throw error;
        }
      });
    }
  }
  if (failed && !cleanupErrors.length) throw failure;
  if (failed) cleanupErrors.unshift(failure);
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Docker regression cleanup failed');
}, 25000);
