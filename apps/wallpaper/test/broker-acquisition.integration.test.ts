import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { Cause, Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
import { WorkflowHealth, Creation, WorkflowDelivery } from '../src/capabilities/creation/index.js';

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
    const layer = assetWorkflowLayer({
      natsUrl: `nats://127.0.0.1:${address.port}`,
      credential: { user: 'test', password: 'test' },
      ownerNamespace: 'test',
      identityProviders: [
        {
          issuer: 'https://identity.test',
          jwksUrl: 'https://identity.test/jwks',
          ownerNamespace: 'test',
          audience: [],
          authorizedParties: [],
          requireAuthorizedParty: false,
        },
      ],
      operatorNotification: { url: 'http://127.0.0.1', token: 'test' },
      maxAttempts: 2,
      retryDelayMs: 10,
      pollMs: 10,
      shutdownTimeoutMs: 100,
    }).pipe(
      Layer.provide(Layer.mergeAll(Layer.mock(Creation, {}), Layer.mock(WorkflowDelivery, {})))
    );
    const runtime = ManagedRuntime.make(layer);
    const controller = new AbortController();
    const acquisition =
      ending === 'cancellation'
        ? Effect.runPromiseExit(Effect.scoped(Layer.build(layer)), { signal: controller.signal })
        : runtime.runPromiseExit(WorkflowHealth.pipe(Effect.flatMap((h) => h.check())), {
            signal: controller.signal,
          });
    try {
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(1);
      if (ending === 'cancellation') controller.abort();
      const disposal = ending === 'disposal' ? runtime.dispose() : Promise.resolve();
      if (ending === 'timeout') await acquisition;
      const [result] = await Promise.all([
        acquisition,
        expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0),
        disposal,
      ]);
      expect(result._tag).toBe('Failure');
      if (ending === 'cancellation') {
        expect(result._tag === 'Failure' && Cause.hasInterrupts(result.cause)).toBe(true);
      }
    } finally {
      try {
        await runtime.dispose();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => peer.close(() => resolve()));
      }
    }
  }, 10000);
}
