import { Effect, ManagedRuntime } from 'effect';
import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisQuotaLayer } from '../../src/adapters/quota/index.js';
import { Quota } from '../../src/admission/index.js';

describe('upload quota storage', () => {
  let container: StartedTestContainer;
  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  });
  afterAll(async () => { await container?.stop(); });
  const distributed = (redisPort = container.getMappedPort(6379), redisEnabled = true) =>
    ManagedRuntime.make(redisQuotaLayer({ redisEnabled, redisHost: '127.0.0.1', redisPort }));

  async function proxy() {
    let replies = true;
    let accepting = true;
    let commands = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      if (!accepting) { socket.destroy(); return; }
      sockets.add(socket);
      const upstream = connect(container.getMappedPort(6379), '127.0.0.1');
      socket.on('data', (chunk) => {
        commands += chunk.toString().split('\r\neval\r\n').length - 1;
        upstream.write(chunk);
      });
      upstream.on('data', (chunk) => { if (replies) socket.write(chunk); });
      upstream.on('error', () => socket.destroy());
      upstream.on('close', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    return {
      port: address.port,
      get commands() { return commands; },
      get sockets() { return sockets.size; },
      stall() { replies = false; },
      disconnect() { accepting = false; for (const socket of sockets) socket.destroy(); },
      restore() { replies = true; accepting = true; },
      async close() {
        for (const socket of sockets) socket.destroy();
        server.close();
        await once(server, 'close');
      },
    };
  }

  it('atomically shares quotas across instances and keeps Profile windows isolated', async () => {
    const first = distributed();
    const second = distributed();
    try {
      const a = await first.runPromise(Quota);
      const b = await second.runPromise(Quota);
      const decisions = await Effect.runPromise(Effect.all(
        Array.from({ length: 8 }, (_, index) => (index % 2 ? a : b).take('shared', 3, 60_000)),
        { concurrency: 'unbounded' }
      ));
      expect(decisions.filter(({ _tag }) => _tag === 'Allowed')).toHaveLength(3);
      expect(decisions.filter(({ _tag }) => _tag === 'Limited')).toHaveLength(5);
      expect(await Effect.runPromise(a.take('other', 3, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 2,
      });
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('retains isolated local limits when Redis is disabled or unavailable', async () => {
    for (const enabled of [false, true]) {
      const first = distributed(1, enabled);
      const second = distributed(1, enabled);
      try {
        const a = await first.runPromise(Quota);
        const b = await second.runPromise(Quota);
        expect(await Effect.runPromise(a.take('offline', 1, 60_000))).toMatchObject({
          _tag: 'Allowed', remaining: 0,
        });
        expect(await Effect.runPromise(a.take('offline', 1, 60_000))).toMatchObject({ _tag: 'Limited' });
        expect(await Effect.runPromise(b.take('offline', 1, 60_000))).toMatchObject({
          _tag: 'Allowed', remaining: 0,
        });
      } finally {
        await first.dispose();
        await second.dispose();
      }
    }
  });

  it('never extends denied windows and resumes consumption after Redis expires them', async () => {
    const runtime = distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      const quota = await runtime.runPromise(Quota);
      expect(await Effect.runPromise(quota.take('expires', 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
      const ttl = await control.pttl('wallpaperdb:ratelimit:user:expires');
      const denied = await Effect.runPromise(quota.take('expires', 1, 60_000));
      expect(denied).toMatchObject({ _tag: 'Limited', retryAfter: 60 });
      expect(await control.pttl('wallpaperdb:ratelimit:user:expires')).toBeLessThanOrEqual(ttl);
      expect(await control.get('wallpaperdb:ratelimit:user:expires')).toBe('1');
      await control.pexpire('wallpaperdb:ratelimit:user:expires', 1);
      await expect.poll(() => control.exists('wallpaperdb:ratelimit:user:expires')).toBe(0);
      expect(await Effect.runPromise(quota.take('expires', 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
    } finally {
      control.disconnect();
      await runtime.dispose();
    }
  });

  it('bounds stalled commands, retains local protection and never replays ambiguous charges', async () => {
    const bridge = await proxy();
    const runtime = distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      const quota = await runtime.runPromise(Quota);
      bridge.stall();
      const decisions = await Effect.runPromise(Effect.all(
        Array.from({ length: 256 }, () => quota.take('stalled', 500, 60_000)),
        { concurrency: 'unbounded' }
      ).pipe(Effect.timeout('3 seconds')));
      expect(decisions.every(({ _tag }) => _tag === 'Allowed')).toBe(true);
      expect(bridge.commands).toBeLessThanOrEqual(64);
      const committed = Number(await control.get('wallpaperdb:ratelimit:user:stalled'));
      expect(committed).toBeGreaterThan(0);
      expect(committed).toBeLessThanOrEqual(64);
      expect(await Effect.runPromise(quota.take('offline-limited', 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
      expect(await Effect.runPromise(quota.take('offline-limited', 1, 60_000))).toMatchObject({
        _tag: 'Limited',
      });
      bridge.restore();
      await expect.poll(async () => {
        await Effect.runPromise(quota.take('after-stall', 100, 60_000));
        return Number(await control.get('wallpaperdb:ratelimit:user:after-stall'));
      }).toBeGreaterThan(0);
      expect(Number(await control.get('wallpaperdb:ratelimit:user:stalled'))).toBe(committed);
      await runtime.dispose();
      await expect.poll(() => bridge.sockets).toBe(0);
    } finally {
      control.disconnect();
      await runtime.dispose();
      await bridge.close();
    }
  });

  it('retains command permits until cancelled Redis work actually settles', async () => {
    const bridge = await proxy();
    const runtime = distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      const quota = await runtime.runPromise(Quota);
      bridge.stall();
      pending = Effect.runPromiseExit(Effect.all(
        Array.from({ length: 64 }, () => quota.take('cancelled', 100, 60_000)),
        { concurrency: 'unbounded' }
      ), { signal: controller.signal });
      await expect.poll(() => control.get('wallpaperdb:ratelimit:user:cancelled')).toBe('64');
      controller.abort();
      expect(await Effect.runPromise(quota.take('during-cancellation', 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
      expect(await control.exists('wallpaperdb:ratelimit:user:during-cancellation')).toBe(0);
      expect(bridge.commands).toBe(64);
      expect(await pending).toMatchObject({ _tag: 'Failure' });
    } finally {
      await Promise.allSettled([pending]);
      control.disconnect();
      await runtime.dispose();
      await bridge.close();
    }
  });

  it.each(['invalid-counter', 'missing-expiry'])('falls back when Redis stores %s', async (name) => {
    const runtime = distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      const key = `wallpaperdb:ratelimit:user:${name}`;
      if (name === 'invalid-counter') await control.lpush(key, 'invalid');
      else await control.set(key, '1');
      const quota = await runtime.runPromise(Quota);
      expect(await Effect.runPromise(quota.take(name, 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
      expect(await Effect.runPromise(quota.take(name, 1, 60_000))).toMatchObject({ _tag: 'Limited' });
    } finally {
      control.disconnect();
      await runtime.dispose();
    }
  });

  it('recovers distributed protection after an initial connection outage', async () => {
    const bridge = await proxy();
    bridge.disconnect();
    const runtime = distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      const quota = await runtime.runPromise(Quota);
      expect(await Effect.runPromise(quota.take('startup-outage', 1, 60_000))).toMatchObject({
        _tag: 'Allowed', remaining: 0,
      });
      expect(await Effect.runPromise(quota.take('startup-outage', 1, 60_000))).toMatchObject({
        _tag: 'Limited',
      });
      bridge.restore();
      await expect.poll(async () => {
        await Effect.runPromise(quota.take('restored', 100, 60_000));
        return Number(await control.get('wallpaperdb:ratelimit:user:restored'));
      }).toBeGreaterThan(0);
    } finally {
      control.disconnect();
      await runtime.dispose();
      await bridge.close();
    }
  });
});
import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
