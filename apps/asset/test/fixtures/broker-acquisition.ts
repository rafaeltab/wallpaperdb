import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { expect, it } from 'vitest';

interface Acquisition {
  readonly run: (signal: AbortSignal) => Promise<{ readonly _tag: string }>;
  readonly dispose: () => Promise<void>;
}

/** Each participant must enter its production broker acquisition, without replacing NATS. */
export function brokerAcquisitionContract(
  start: (url: string, ending: 'timeout' | 'cancellation' | 'disposal') => Acquisition
) {
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
      const runtime = start(`nats://127.0.0.1:${address.port}`, ending);
      const controller = new AbortController();
      const acquisition = runtime.run(controller.signal);
      try {
        await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(1);
        if (ending === 'cancellation') controller.abort();
        if (ending === 'disposal') await runtime.dispose();
        expect((await acquisition)._tag).toBe('Failure');
        await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
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
}
