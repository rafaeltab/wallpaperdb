import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { attachmentBrokerLayer } from '../src/adapters/picture-attachments/index.js';
import {
  AttachmentHealth,
  PictureAttachments,
  AttachmentDelivery,
} from '../src/capabilities/picture-attachments/index.js';

const unused = () => Effect.die('No application work expected before broker acquisition');
it.each(['timeout', 'cancellation', 'disposal'] as const)(
  'closes the native pre-INFO transport after %s',
  async (mode) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.once('close', () => sockets.delete(socket));
      socket.resume();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    const runtime = ManagedRuntime.make(
      attachmentBrokerLayer({
        natsUrl: `nats://127.0.0.1:${address.port}`,
        credential: { user: 'fixture', password: 'fixture' },
        operatorNotification: { url: 'http://127.0.0.1:1', token: 'fixture' },
        maxAttempts: 1,
        retryDelayMs: 1,
        pollMs: 10,
        shutdownTimeoutMs: 100,
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(PictureAttachments, {
              begin: unused,
              get: unused,
              expectSource: unused,
              assetResult: unused,
              sourceAccepted: unused,
              cancel: unused,
            }),
            Layer.succeed(AttachmentDelivery, {
              claim: unused,
              complete: unused,
              failed: unused,
              quarantine: unused,
              recover: unused,
              alerts: unused,
              alerted: unused,
              retainedConfirmation: unused,
              confirmationRecovered: unused,
            })
          )
        )
      )
    );
    const controller = new AbortController();
    const outcome = runtime.runPromise(AttachmentHealth, { signal: controller.signal }).then(
      () => 'connected',
      () => 'failed'
    );
    try {
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(1);
      if (mode === 'cancellation') controller.abort();
      if (mode === 'disposal') await runtime.dispose();
      expect(await outcome).toBe('failed');
      await runtime.dispose();
      await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
    } finally {
      controller.abort();
      await runtime.dispose();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  10000
);
