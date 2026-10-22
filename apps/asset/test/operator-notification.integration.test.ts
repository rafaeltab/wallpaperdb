import { createServer } from 'node:http';
import { once } from 'node:events';
import { GenericContainer, Wait } from 'testcontainers';
import { connect } from 'nats';
import { ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import {
  provisionAssetBroker,
  renderBrokerConfiguration,
  operatorWebhookLayer,
  OperatorNotificationHealth,
  recoverQuarantine,
} from '../src/adapters/commands/index.js';
import { authorityFixture } from './fixtures/authority.js';

it('delivers durable operator notices to the configured HTTP destination and quarantines exhausted notification delivery until recovery', async () => {
  let status = 200;
  const received: unknown[] = [];
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls++;
    if (request.headers.authorization !== 'Bearer operator-inbox-token') {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (status === 200) received.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(status).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const authority = parseAuthority(authorityFixture());
  const container = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  const url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
  const operator = await connect({
    servers: url,
    user: 'asset-operator_user',
    pass: 'operator-secret',
  });
  await provisionAssetBroker(operator, authority, 'user');
  const wallpaperOperator = await connect({
    servers: url,
    user: 'asset-operator_wallpaper',
    pass: 'operator-secret',
  });
  await provisionAssetBroker(wallpaperOperator, authority, 'wallpaper');
  const runtime = ManagedRuntime.make(
    operatorWebhookLayer({
      url,
      credential: authority.broker.service,
      applications: authority.applications,
      target: { url: `http://127.0.0.1:${address.port}/events`, token: 'operator-inbox-token' },
      ...authority.delivery,
    })
  );
  try {
    await runtime.runPromise(OperatorNotificationHealth);
    const notice = {
      id: 'a'.repeat(64),
      kind: 'result-quarantine',
      subject: 'asset.results.user',
      reason: 'exhausted',
      context: {
        occurrence: { source: 'https://example.test/application', id: 'command-occurrence' },
        correlationId: 'workflow-1',
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      },
    };
    await operator.jetstream().publish('asset.operator.notifications', JSON.stringify(notice));
    await expect
      .poll(() => received, { timeout: 3000 })
      .toEqual([{ ...notice, applicationId: 'user' }]);
    status = 503;
    await operator
      .jetstream()
      .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'b'.repeat(64) }));
    const manager = await operator.jetstreamManager();
    await expect
      .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
        timeout: 5000,
      })
      .toBe(1);
    expect(calls).toBe(4);
    const stored = await manager.streams.getMessage('ASSET_QUARANTINE', { seq: 1 });
    expect(JSON.parse(stored.string()).type).toBe('asset.notification.quarantined');
    status = 200;
    await wallpaperOperator
      .jetstream()
      .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'c'.repeat(64) }));
    await expect.poll(() => received.length, { timeout: 3000 }).toBe(2);
    expect(
      await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
    ).toBe(false);
    await recoverQuarantine(operator, authority, 'user', 1);
    await expect.poll(() => received.length, { timeout: 3000 }).toBe(3);
    expect(
      await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
    ).toBe(true);
    await manager.consumers.delete('ASSET_OPERATIONS', 'operator_notifications');
    await expect
      .poll(
        () => runtime.runPromise(OperatorNotificationHealth.use((service) => service.check())),
        { timeout: 3000 }
      )
      .toBe(false);
    await wallpaperOperator
      .jetstream()
      .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'd'.repeat(64) }));
    await expect.poll(() => received.length, { timeout: 3000 }).toBe(4);
    expect(
      await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
    ).toBe(false);
  } finally {
    await runtime.dispose();
    await operator.close();
    await wallpaperOperator.close();
    await container.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
