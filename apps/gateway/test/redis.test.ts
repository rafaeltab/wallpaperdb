import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import { Effect, ManagedRuntime } from 'effect';
import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisQuotaLayer } from '../src/adapters/redis/index.js';
import { Quota } from '../src/admission/index.js';

let container: StartedTestContainer;
beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
});
afterAll(async () => {
  await container?.stop();
});
async function distributed(port = container.getMappedPort(6379), enabled = true) {
  const runtime = ManagedRuntime.make(
    redisQuotaLayer({ redisEnabled: enabled, redisHost: '127.0.0.1', redisPort: port })
  );
  const quota = await runtime.runPromise(Quota);
  return { quota, dispose: () => runtime.dispose() };
}
async function proxy() {
  let forwardsReplies = true;
  let acceptsConnections = true;
  let evals = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    if (!acceptsConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const upstream = connect(container.getMappedPort(6379), '127.0.0.1');
    socket.on('data', (chunk) => {
      evals += chunk.toString().split('\r\neval\r\n').length - 1;
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (forwardsReplies) socket.write(chunk);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      upstream.destroy();
    });
    upstream.on('close', () => socket.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    port: address.port,
    get sockets() {
      return sockets.size;
    },
    get evals() {
      return evals;
    },
    stall() {
      forwardsReplies = false;
    },
    disconnect() {
      acceptsConnections = false;
      for (const socket of sockets) socket.destroy();
    },
    restore() {
      forwardsReplies = true;
      acceptsConnections = true;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

describe('quota storage contract', () => {
  it('atomically shares windows across live Redis adapters and keeps keys isolated', async () => {
    const a = await distributed();
    const b = await distributed();
    try {
      const results = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).quota.take('shared', 3, 60000)),
          { concurrency: 'unbounded' }
        )
      );
      expect(results.filter((r) => r._tag === 'Allowed')).toHaveLength(3);
      expect(results.filter((r) => r._tag === 'Limited')).toHaveLength(5);
      expect(await Effect.runPromise(b.quota.take('other', 3, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 2,
      });
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
  it('allows every request without local quota windows when Redis is disabled or unreachable', async () => {
    for (const enabled of [false, true]) {
      const adapter = await distributed(1, enabled);
      try {
        for (let i = 0; i < 3; i++) {
          expect(
            await Effect.runPromise(adapter.quota.take('unavailable', 1, 60000))
          ).toMatchObject({ _tag: 'Allowed', remaining: 1 });
        }
      } finally {
        await adapter.dispose();
      }
    }
  });
  it('leaves denied windows unchanged and resets after expiry', async () => {
    const adapter = await distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      const ttl = await control.pttl('graphql:ratelimit:window');
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000))).toMatchObject({
        _tag: 'Limited',
      });
      expect(await control.pttl('graphql:ratelimit:window')).toBeLessThanOrEqual(ttl);
      await control.pexpire('graphql:ratelimit:window', 1);
      await expect.poll(() => control.exists('graphql:ratelimit:window')).toBe(0);
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
    } finally {
      control.disconnect();
      await adapter.dispose();
    }
  });
  it('fails open during a connection outage and restores distributed enforcement after reconnecting', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    try {
      expect(await Effect.runPromise(adapter.quota.take('reconnect', 1, 60000))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      bridge.disconnect();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('reconnect', 1, 60000)))
        .toMatchObject({ _tag: 'Allowed', remaining: 1 });
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('reconnect', 1, 60000)), { timeout: 5000 })
        .toMatchObject({ _tag: 'Limited' });
      await adapter.dispose();
      await expect.poll(() => bridge.sockets).toBe(0);
    } finally {
      await adapter.dispose();
      await bridge.close();
    }
  });
  it('retries an unavailable startup connection and begins enforcement when Redis returns', async () => {
    const bridge = await proxy();
    bridge.disconnect();
    const adapter = await distributed(bridge.port);
    try {
      expect(await Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000))).toMatchObject(
        { _tag: 'Allowed', remaining: 1 }
      );
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000)), {
          timeout: 5000,
        })
        .toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(await Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000))).toMatchObject(
        { _tag: 'Limited' }
      );
    } finally {
      await adapter.dispose();
      await bridge.close();
    }
  });
  it('bounds stalled socket work, never replays ambiguous commands, and releases the socket on scope closure', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      bridge.stall();
      const decisions = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 256 }, () => adapter.quota.take('stalled', 500, 60000)),
          { concurrency: 'unbounded' }
        ).pipe(Effect.timeout('3 seconds'))
      );
      expect(decisions.every((decision) => decision._tag === 'Allowed')).toBe(true);
      expect(bridge.evals).toBeLessThanOrEqual(64);
      const committed = Number(await control.get('graphql:ratelimit:stalled'));
      expect(committed).toBeGreaterThan(0);
      expect(committed).toBeLessThanOrEqual(64);
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('recovered', 1, 60000)), { timeout: 5000 })
        .toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(Number(await control.get('graphql:ratelimit:stalled'))).toBe(committed);
      await adapter.dispose();
      await expect.poll(() => bridge.sockets).toBe(0);
    } finally {
      control.disconnect();
      await adapter.dispose();
      await bridge.close();
    }
  });
});
