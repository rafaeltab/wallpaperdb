import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { cleanupWorkerLayer } from '../src/adapters/cleanup/worker.js';
import { Cleanup, CleanupStore } from '../src/capabilities/cleanup/index.js';

for (const ending of ['timeout', 'cancellation', 'disposal'] as const) {
  it(`closes the native silent-peer socket after ${ending}`, async () => {
    const sockets = new Set<Socket>();
    const peer = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    peer.listen(0, '127.0.0.1');
    await once(peer, 'listening');
    const address = peer.address();
    if (!address || typeof address === 'string') throw new Error('Missing peer port');
    const options = {
      url: `nats://127.0.0.1:${address.port}`,
      credential: { user: 'test', password: 'test' },
      applications: {
        test: {
          id: 'test',
          serviceUser: 'test',
          createSubject: 'asset.commands.test.create',
          deleteSubject: 'asset.commands.test.delete',
          resultSubject: 'asset.results.test',
        },
      },
      pollMs: 10,
      shutdownTimeoutMs: 100,
    };
    const runtime = ManagedRuntime.make(
      cleanupWorkerLayer(options).pipe(
        Layer.provide(Layer.mergeAll(Layer.mock(Cleanup, {}), Layer.mock(CleanupStore, {})))
      )
    );
    const controller = new AbortController();
    const acquisition = runtime.runPromiseExit(Effect.void, { signal: controller.signal });
    try {
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(1);
      if (ending === 'cancellation') controller.abort();
      if (ending === 'disposal') await runtime.dispose();
      const result = await acquisition;
      expect(result._tag).toBe('Failure');
      await runtime.dispose();
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
    } finally {
      await runtime.dispose();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  }, 10000);
}
