import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';

interface ProxiedClient {
  readonly incoming: Socket;
  readonly outgoing: Socket;
  name?: string;
  held: boolean;
}

/** Forward real dependency traffic, with controlled stalls and transport loss. */
export async function dependencyProxy(host: string, port: number) {
  let blocked = false;
  let blockedName: string | undefined;
  let blockedTraffic = false;
  let paused = false;
  let pauseNew = false;
  const sockets = new Set<Socket>();
  const clients = new Set<ProxiedClient>();
  let heldTraffic: Array<{ socket: Socket; data: Buffer }> = [];
  const server = createServer((incoming) => {
    const outgoing = createConnection({ host, port });
    const client: ProxiedClient = { incoming, outgoing, held: pauseNew };
    clients.add(client);
    sockets.add(incoming);
    sockets.add(outgoing);
    const forward = (socket: Socket, data: Buffer) => {
      if (paused || client.held) heldTraffic.push({ socket, data });
      else socket.write(data);
    };
    let firstLine: string | undefined = '';
    incoming.on('data', (data) => {
      // Only NATS CONNECT supplies a name. A held pre-INFO socket has no such identity.
      // Other dependency protocols continue through the same unclassified proxy.
      if (firstLine !== undefined) {
        firstLine += data.toString();
        if (!'CONNECT '.startsWith(firstLine) && !firstLine.startsWith('CONNECT ')) {
          firstLine = undefined;
        } else if (firstLine.includes('\r\n')) {
          const options = JSON.parse(firstLine.slice(8, firstLine.indexOf('\r\n')));
          if (typeof options?.name === 'string') client.name = options.name;
          firstLine = undefined;
        } else if (firstLine.length > 65536) {
          firstLine = undefined;
        }
      }
      if (blocked && (blockedName === undefined || blockedName === client.name))
        blockedTraffic = true;
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
    const forget = () => {
      if (!sockets.has(incoming) && !sockets.has(outgoing)) clients.delete(client);
    };
    incoming.on('close', forget);
    outgoing.on('close', forget);
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
    block: (name?: string) => {
      blocked = true;
      blockedName = name;
      blockedTraffic = false;
    },
    unblock: () => {
      blocked = false;
    },
    hasBlockedTraffic: () => blockedTraffic,
    socketCount: () => sockets.size,
    socketCountFor: (name: string) =>
      [...clients]
        .filter((client) => client.name === name)
        .reduce(
          (count, client) =>
            count + Number(sockets.has(client.incoming)) + Number(sockets.has(client.outgoing)),
          0
        ),
    unidentifiedSocketCount: () =>
      [...clients]
        .filter((client) => client.name === undefined)
        .reduce(
          (count, client) =>
            count + Number(sockets.has(client.incoming)) + Number(sockets.has(client.outgoing)),
          0
        ),
    waitForConnection: async () => {
      if (sockets.size > 0) return;
      await once(server, 'connection', { signal: AbortSignal.timeout(1000) });
    },
    pause: () => {
      paused = true;
      // Keep reading so that EOF and transport failure remain observable during a handshake stall.
    },
    pauseNewConnections: () => {
      pauseNew = true;
    },
    resume: () => {
      paused = false;
      pauseNew = false;
      for (const client of clients) client.held = false;
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
