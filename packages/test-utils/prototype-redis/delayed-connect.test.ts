import assert from 'node:assert/strict';
import { createServer, type NetConnectOpts, type Socket } from 'node:net';
import net from 'node:net';
import type { RedisClientType } from 'redis';
import { expect, it, vi } from 'vitest';
import { createGroup } from './fixture';

const routing = vi.hoisted(() => ({
  subscriberUrl: undefined as string | undefined,
  upstreamUrl: undefined as string | undefined,
  subscriber: undefined as RedisClientType | undefined,
}));

vi.mock('redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('redis')>();
  return {
    ...actual,
    createClient: ((...args: Parameters<typeof actual.createClient>) => {
      const options = args[0];
      if (routing.subscriberUrl && options?.name?.endsWith(':subscriber')) {
        routing.upstreamUrl = options.url;
        const client = actual.createClient({ ...options, url: routing.subscriberUrl });
        routing.subscriber = client as RedisClientType;
        return client;
      }
      return actual.createClient(...args);
    }) as typeof actual.createClient,
  };
});

it('closes a subscriber TCP socket when case cleanup beats Redis socket assignment', async () => {
  const group = await createGroup(undefined, 100);
  const originalConnect = net.connect.bind(net);
  const sockets = new Set<Socket>();
  const accepted = new Set<Socket>();
  const restores: Array<() => void> = [];
  let held = false;
  let releaseConnect: (() => void) | undefined;
  let subscriberSocket: Socket | undefined;
  let retired: Promise<unknown> | undefined;
  let acquisition: Promise<unknown> | undefined;
  let acquisitionSettled = false;
  let caseSettled = false;
  const server = createServer((downstream) => {
    accepted.add(downstream);
    sockets.add(downstream);
    downstream.on('close', () => {
      accepted.delete(downstream);
      sockets.delete(downstream);
    });
    assert.ok(routing.upstreamUrl);
    const endpoint = new URL(routing.upstreamUrl);
    const upstream = originalConnect({ host: endpoint.hostname, port: Number(endpoint.port) });
    sockets.add(upstream);
    upstream.on('close', () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
    downstream.on('close', () => upstream.destroy());
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    downstream.pipe(upstream).pipe(downstream);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
    routing.subscriberUrl = `redis://127.0.0.1:${address.port}`;
    const connectSpy = vi.spyOn(net, 'connect').mockImplementation(((options: NetConnectOpts) => {
      const socket = originalConnect(options);
      if ('port' in options && options.port === address.port) {
        subscriberSocket = socket;
        const emit = socket.emit.bind(socket);
        const emitSpy = vi
          .spyOn(socket, 'emit')
          .mockImplementation((event: string | symbol, ...args: unknown[]) => {
            if (event === 'connect' && !held) {
              held = true;
              releaseConnect = () => {
                // A correctly aborted transport must not receive a fabricated late event.
                if (!socket.destroyed) emit(event, ...args);
              };
              return false;
            }
            return emit(event, ...args);
          });
        restores.push(() => emitSpy.mockRestore());
      }
      return socket;
    }) as typeof net.connect);
    restores.push(() => connectSpy.mockRestore());

    retired = group
      .runCase('detached', async (scope) => {
        acquisition = scope
          .subscribe(scope.channel('owned'), () => {})
          .catch((error: unknown) => error)
          .finally(() => {
            acquisitionSettled = true;
          });
        await expect.poll(() => held, { timeout: 2000 }).toBe(true);
        await expect.poll(() => accepted.size, { timeout: 2000 }).toBe(1);
        expect(routing.subscriber?.isOpen).toBe(true);
        // Return while node-redis still awaits createSocket(), before private assignment.
      })
      .catch((error: unknown) => error)
      .finally(() => {
        caseSettled = true;
      });
    await expect.poll(() => caseSettled, { timeout: 1500 }).toBe(true);
    expect(routing.subscriber?.isOpen).toBe(false);
    // Redis flags are insufficient: the actual accepted TCP socket must close.
    const closure = await expect
      .poll(() => accepted.size, { timeout: 500 })
      .toBe(0)
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect.soft(closure).toBeUndefined();
    expect.soft(subscriberSocket?.destroyed).toBe(true);

    releaseConnect?.();
    await expect.poll(() => acquisitionSettled, { timeout: 2000 }).toBe(true);
    expect(await acquisition).toBeInstanceOf(Error);
    await expect.poll(() => accepted.size, { timeout: 500 }).toBe(0);
  } finally {
    releaseConnect?.();
    routing.subscriberUrl = undefined;
    // Close proxy transports before group auditing, including the old leaked socket.
    for (const socket of sockets) socket.destroy();
    try {
      await group.close().catch(() => {});
      await Promise.allSettled([retired, acquisition]);
    } finally {
      for (const restore of restores.reverse()) restore();
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      routing.upstreamUrl = undefined;
      routing.subscriber = undefined;
    }
  }
}, 15000);
