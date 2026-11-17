import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { assetWorkflowLayer } from '../src/adapters/asset-workflow/index.js';
import { WorkflowDelivery, WorkflowHealth, Creation } from '../src/capabilities/creation/index.js';

const unexpected = () => Effect.die('No workflow work may run before broker acquisition');
const dependencies = Layer.merge(
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

it.each(['timeout', 'cancel', 'dispose'] as const)(
  'closes Wallpaper native broker sockets after acquisition %s before INFO',
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
      assetWorkflowLayer({
        natsUrl: `nats://127.0.0.1:${address.port}`,
        ownerNamespace: 'owner',
        identityProviders: [],
        credential: { user: 'application', password: 'test' },
        operatorNotification: { url: 'https://controlled.test/events', token: 'test' },
        maxAttempts: 2,
        retryDelayMs: 1,
        pollMs: 10,
        shutdownTimeoutMs: 100,
      }).pipe(Layer.provide(dependencies))
    );
    const controller = new AbortController();
    const accepted = once(server, 'connection');
    const started = runtime.runPromiseExit(WorkflowHealth, { signal: controller.signal });
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
