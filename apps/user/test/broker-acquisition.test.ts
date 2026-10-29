import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { attachmentBrokerLayer } from '../src/adapters/picture-attachments/index.js';
import {
  PictureAttachments,
  AttachmentDelivery,
  AttachmentHealth,
} from '../src/capabilities/picture-attachments/index.js';
const unexpected = () =>
  Effect.die(new Error('Unexpected capability call during broker acquisition'));
const services = Layer.merge(
  Layer.succeed(PictureAttachments, {
    begin: unexpected,
    get: unexpected,
    expectSource: unexpected,
    cancel: unexpected,
    assetResult: unexpected,
    sourceAccepted: unexpected,
  }),
  Layer.succeed(AttachmentDelivery, {
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

for (const ending of ['timeout', 'cancellation', 'disposal'] as const) {
  it(`closes the native pre-INFO socket after ${ending}`, async () => {
    const sockets = new Set<Socket>();
    let accepted!: () => void;
    const connected = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      accepted();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    const runtime = ManagedRuntime.make(
      attachmentBrokerLayer({
        natsUrl: `nats://127.0.0.1:${address.port}`,
        credential: { user: 'test', password: 'test' },
        operatorNotification: { url: 'http://127.0.0.1/unused', token: 'test' },
        maxAttempts: 2,
        retryDelayMs: 1,
        pollMs: 10,
        shutdownTimeoutMs: 100,
      }).pipe(Layer.provide(services))
    );
    const controller = new AbortController();
    const startup = runtime.runPromise(AttachmentHealth, { signal: controller.signal }).then(
      () => 'ready',
      () => 'failed'
    );
    try {
      await connected;
      expect(sockets.size).toBe(1);
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
