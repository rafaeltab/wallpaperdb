import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';

/** Forward real dependency traffic, with controlled stalls and transport loss. */
export async function dependencyProxy(host: string, port: number) {
  let blocked = false;
  let blockedTraffic = false;
  let paused = false;
  const sockets = new Set<Socket>();
  let heldTraffic: Array<{ socket: Socket; data: Buffer }> = [];
  const forward = (socket: Socket, data: Buffer) => {
    if (paused) heldTraffic.push({ socket, data });
    else socket.write(data);
  };
  const server = createServer((incoming) => {
    const outgoing = createConnection({ host, port });
    sockets.add(incoming);
    sockets.add(outgoing);
    incoming.on('data', (data) => {
      if (blocked) blockedTraffic = true;
      else forward(outgoing, data);
    });
    outgoing.on('data', (data) => forward(incoming, data));
    incoming.on('error', () => outgoing.destroy());
    outgoing.on('error', () => incoming.destroy());
    incoming.on('close', () => {
      sockets.delete(incoming);
      heldTraffic = heldTraffic.filter(({ socket }) => socket !== incoming && socket !== outgoing);
      outgoing.destroy();
    });
    outgoing.on('close', () => {
      sockets.delete(outgoing);
      heldTraffic = heldTraffic.filter(({ socket }) => socket !== incoming && socket !== outgoing);
      incoming.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy did not bind a TCP port');
  return {
    port: address.port,
    block: () => {
      blocked = true;
      blockedTraffic = false;
    },
    unblock: () => {
      blocked = false;
    },
    hasBlockedTraffic: () => blockedTraffic,
    socketCount: () => sockets.size,
    waitForConnection: async () => {
      if (sockets.size > 0) return;
      await once(server, 'connection', { signal: AbortSignal.timeout(1000) });
    },
    pause: () => {
      paused = true;
      // Keep reading so that EOF and transport failure remain observable during a handshake stall.
    },
    resume: () => {
      paused = false;
      const traffic = heldTraffic;
      heldTraffic = [];
      for (const { socket, data } of traffic) {
        if (!socket.destroyed) socket.write(data);
      }
    },
    disconnect: () => {
      for (const socket of sockets) socket.destroy();
    },
    close: async () => {
      const disconnecting = [...sockets].map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once('close', () => resolve());
            socket.destroy();
          })
      );
      const results = await Promise.allSettled([
        ...disconnecting,
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        ),
      ]);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason));
    },
  };
}
