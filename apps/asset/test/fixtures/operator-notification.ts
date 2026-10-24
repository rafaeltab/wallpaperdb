import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { GenericContainer, Wait } from 'testcontainers';
import { parseAuthority } from '../../src/authority.js';
import {
  provisionAssetBroker,
  renderBrokerConfiguration,
  operatorWebhookLayer,
} from '../../src/adapters/commands/index.js';
import { authorityFixture } from './authority.js';

export async function withOperatorNotificationFixture(
  handler: RequestListener,
  run: (fixture: Awaited<ReturnType<typeof acquire>>) => Promise<void>,
  faults: {
    afterProvision?: (fixture: {
      server: ReturnType<typeof createServer>;
      container: Awaited<ReturnType<GenericContainer['start']>>;
      operator: NatsConnection;
    }) => Promise<void>;
    closeOperator?: (operator: NatsConnection) => Promise<void>;
  } = {}
) {
  const releases: Array<() => Promise<unknown>> = [];
  const failures: unknown[] = [];
  async function acquire() {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    releases.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    });
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
    releases.push(() => container.stop());
    const url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
    const operator = await connect({
      servers: url,
      user: 'asset-operator_user',
      pass: 'operator-secret',
    });
    releases.push(() => (faults.closeOperator ? faults.closeOperator(operator) : operator.close()));
    await provisionAssetBroker(operator, authority, 'user');
    await faults.afterProvision?.({ server, container, operator });
    const wallpaperOperator = await connect({
      servers: url,
      user: 'asset-operator_wallpaper',
      pass: 'operator-secret',
    });
    releases.push(() => wallpaperOperator.close());
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
    releases.push(() => runtime.dispose());
    return { server, container, url, authority, operator, wallpaperOperator, runtime };
  }
  try {
    await run(await acquire());
  } catch (error) {
    failures.push(error);
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Operator notification fixture failed');
}
