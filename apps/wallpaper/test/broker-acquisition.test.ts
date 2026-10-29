import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
import { Creation, WorkflowDelivery, WorkflowHealth } from '../src/capabilities/creation/index.js';
const unexpected = () =>
  Effect.die(new Error('Unexpected capability call during broker acquisition'));
const services = Layer.merge(
  Layer.succeed(Creation, {
    list: unexpected,
    begin: unexpected,
    get: unexpected,
    expectSource: unexpected,
    assetResult: unexpected,
    sourceAccepted: unexpected,
  }),
  Layer.succeed(WorkflowDelivery, {
    claim: unexpected,
    complete: unexpected,
    failed: unexpected,
    quarantine: unexpected,
    recover: unexpected,
    alerts: unexpected,
    alerted: unexpected,
    retainedConfirmation: unexpected,
    confirmationRecovered: unexpected,
  })
);

for (const stalledConnection of ['protected', 'publication'] as const) {
  for (const ending of ['timeout', 'cancellation', 'disposal'] as const) {
    it(`closes the native pre-INFO socket for ${stalledConnection} after ${ending}`, async () => {
      const sockets = new Set<Socket>();
      let accepted!: () => void;
      const connected = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      let connections = 0;
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        connections++;
        if (stalledConnection === 'publication' && connections === 1) {
          // The protected connection succeeds, then legacy publication stalls.
          socket.write(
            'INFO {"server_id":"test","version":"2.10.0","proto":1,"headers":true,"max_payload":1048576}\r\n'
          );
          socket.on('data', (data) => {
            if (data.toString().includes('PING\r\n')) socket.write('PONG\r\n');
          });
        } else accepted();
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing TCP address');
      const runtime = ManagedRuntime.make(
        assetWorkflowLayer({
          natsUrl: `nats://127.0.0.1:${address.port}`,
          credential: { user: 'test', password: 'test' },
          operatorNotification: { url: 'http://127.0.0.1/unused', token: 'test' },
          maxAttempts: 2,
          retryDelayMs: 1,
          pollMs: 10,
          shutdownTimeoutMs: 100,
          ownerNamespace: 'test',
          identityProviders: [],
        }).pipe(Layer.provide(services))
      );
      const controller = new AbortController();
      const startup = runtime.runPromise(WorkflowHealth, { signal: controller.signal }).then(
        () => 'ready',
        () => 'failed'
      );
      try {
        await connected;
        expect(sockets.size).toBe(stalledConnection === 'publication' ? 2 : 1);
        if (ending === 'cancellation') controller.abort();
        if (ending === 'disposal') await runtime.dispose();
        expect(await startup).toBe('failed');
        if (ending !== 'disposal') {
          // Cancellation may return before the masked acquisition timeout expires.
          await expect.poll(() => sockets.size, { timeout: 3000 }).toBe(0);
        }
        await runtime.dispose();
        await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
      } finally {
        await runtime.dispose();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });
  }
}
