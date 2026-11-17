import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { natsEventsLayer, NatsBroker } from '../src/adapters/events/index.js';

it.each(['timeout', 'cancel', 'dispose'] as const)(
  'closes Asset native broker sockets after acquisition %s before INFO',
  async (scenario) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.resume();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const runtime = ManagedRuntime.make(
      natsEventsLayer({
        url: `nats://127.0.0.1:${address.port}`,
        serviceName: 'asset-silent-peer',
        stream: 'WALLPAPER',
        shutdownTimeoutMs: 100,
      })
    );
    const controller = new AbortController();
    const accepted = once(server, 'connection');
    const started = runtime.runPromiseExit(NatsBroker, { signal: controller.signal });
    try {
      await accepted;
      expect(sockets.size).toBe(1);
      if (scenario === 'cancel') controller.abort();
      if (scenario === 'dispose') await runtime.dispose();
      const result = await started;
      expect(result._tag).toBe('Failure');
      await runtime.dispose();
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
    } finally {
      await runtime.dispose();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
);
