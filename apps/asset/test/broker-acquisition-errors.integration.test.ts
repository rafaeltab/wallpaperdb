import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { connect } from 'nats';
import { GenericContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { withBrokerAddresses } from './fixtures/broker-addresses.js';

let broker: Awaited<ReturnType<GenericContainer['start']>>;
let address: string;
beforeAll(async () => {
  broker = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      {
        target: '/broker.json',
        content: JSON.stringify({
          port: 4222,
          http: 8222,
          accounts: { TEST: { users: [{ user: 'client', password: 'client-secret' }] } },
        }),
      },
    ])
    .withCommand(['-c', '/broker.json'])
    .withExposedPorts(4222, 8222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  address = (await lookup(broker.getHost(), { family: 4 })).address;
});
afterAll(async () => {
  await broker?.stop();
});

it('preserves authorization denial across multiple resolved address candidates without an abort signal', async () => {
  await withBrokerAddresses(address, async (hostname) => {
    await expect(
      connect({
        servers: `nats://${hostname}:${broker.getMappedPort(4222)}`,
        user: 'client',
        pass: 'wrong-password',
        reconnect: false,
        noRandomize: true,
      })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_VIOLATION' });
  });
});

it('closes the native silent-peer socket on explicit abort without dialing the remaining candidate', async () => {
  const sockets = new Set<Socket>();
  let accepted = 0;
  const peer = createServer((socket) => {
    accepted++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  peer.listen(0, '127.0.0.1');
  await once(peer, 'listening');
  const endpoint = peer.address();
  if (!endpoint || typeof endpoint === 'string') throw new Error('Missing silent peer port');
  const controller = new AbortController();
  try {
    await withBrokerAddresses('127.0.0.1', async (hostname) => {
      const outcome = connect({
        servers: `nats://${hostname}:${endpoint.port}`,
        reconnect: false,
        noRandomize: true,
        timeout: 2000,
        signal: controller.signal,
      }).then(
        (connection) => ({ kind: 'connected' as const, connection }),
        (error: unknown) => ({ kind: 'failed' as const, error })
      );
      try {
        await expect.poll(() => accepted, { timeout: 1000 }).toBe(1);
        controller.abort();
        const closure = (async () => {
          await expect.poll(() => sockets.size, { timeout: 1000 }).toBe(0);
        })();
        const [result] = await Promise.all([outcome, closure]);
        expect(result).toMatchObject({ kind: 'failed', error: { code: 'CANCELLED' } });
        expect(accepted).toBe(1);
      } finally {
        controller.abort();
        const result = await outcome;
        if (result.kind === 'connected') await result.connection.close();
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

it('preserves healthy authenticated acquisition and native broker shutdown with multiple candidates', async () => {
  await withBrokerAddresses(address, async (hostname) => {
    const connection = await connect({
      servers: `nats://${hostname}:${broker.getMappedPort(4222)}`,
      user: 'client',
      pass: 'client-secret',
      reconnect: false,
      noRandomize: true,
      signal: new AbortController().signal,
    });
    const monitoring = `http://${broker.getHost()}:${broker.getMappedPort(8222)}/connz`;
    const connectionCount = async () => {
      const response = await fetch(monitoring);
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('num_connections' in body)) {
        throw new Error('Missing broker connection count');
      }
      return body.num_connections;
    };
    try {
      await connection.flush();
      expect(connection.isClosed()).toBe(false);
      await expect.poll(connectionCount, { timeout: 1000 }).toBe(1);
    } finally {
      await connection.close();
    }
    await expect.poll(connectionCount, { timeout: 1000 }).toBe(0);
  });
});
