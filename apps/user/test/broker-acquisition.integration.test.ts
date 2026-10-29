import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, it, expect } from 'vitest';
import { attachmentBrokerLayer } from '../src/adapters/picture-attachments/index.js';
import {
  PictureAttachments,
  AttachmentDelivery,
  AttachmentHealth,
} from '../src/capabilities/picture-attachments/index.js';

const unused = () => Effect.die('No workflow operation may run before acquisition');

describe('broker acquisition native transport ownership', () => {
  for (const ending of ['timeout', 'cancellation', 'disposal']) {
    it(`closes a peer that never sends INFO after ${ending}`, async () => {
      const sockets = new Set<Socket>();
      const peer = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.resume();
      });
      peer.listen(0, '127.0.0.1');
      await once(peer, 'listening');
      const address = peer.address();
      if (!address || typeof address === 'string') throw new Error('Missing peer port');
      const runtime = ManagedRuntime.make(
        attachmentBrokerLayer({
          natsUrl: `nats://127.0.0.1:${address.port}`,
          credential: { user: 'test', password: 'test' },
          operatorNotification: { url: 'http://127.0.0.1:1', token: 'test' },
          maxAttempts: 2,
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
      try {
        const controller = new AbortController();
        const acquisition = runtime
          .runPromise(AttachmentHealth, { signal: controller.signal })
          .then(
            () => 'success',
            () => 'failed'
          );
        await expect.poll(() => sockets.size).toBe(1);
        if (ending === 'cancellation') controller.abort();
        const disposal = ending === 'disposal' ? runtime.dispose() : undefined;
        expect(await acquisition).toBe('failed');
        await disposal;
        await runtime.dispose();
        await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
      } finally {
        await runtime.dispose();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => peer.close(() => resolve()));
      }
    });
  }
});
