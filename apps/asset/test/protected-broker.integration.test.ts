import { GenericContainer, Wait } from 'testcontainers';
import { connect, StringCodec, type NatsConnection } from 'nats';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { renderBrokerConfiguration, provisionAssetBroker } from '../src/adapters/commands/index.js';
import { authorityFixture } from './fixtures/authority.js';

const authority = parseAuthority(authorityFixture());
let container: Awaited<ReturnType<GenericContainer['start']>>;
const connections: NatsConnection[] = [];
let url: string;
async function connection(user?: string, pass?: string, inboxPrefix?: string) {
  const connection = await connect({ servers: url, user, pass, inboxPrefix });
  connections.push(connection);
  return connection;
}
beforeAll(async () => {
  container = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
  const operator = await connection('asset-operator', 'operator-secret');
  await provisionAssetBroker(operator, authority);
});
afterAll(async () => {
  await Promise.all(connections.map((client) => client.close()));
  await container?.stop();
});
it('isolates application publication and each filtered result consumer from all alternate ingress and control planes', async () => {
  const user = await connection('user-1', 'user-secret', '_ASSET_INBOX.user');
  const wallpaper = await connection('wallpaper-1', 'wallpaper-secret', '_ASSET_INBOX.wallpaper');
  const service = await connection('asset-service', 'service-secret', '_ASSET_INBOX.service');
  const operator = await connection('asset-operator', 'operator-secret');
  const legacy = await connection();
  const codec = StringCodec();
  const manager = await operator.jetstreamManager();
  await user.jetstream().publish('asset.commands.user.create', codec.encode('trusted-user'));
  for (const target of [
    'asset.commands.wallpaper.create',
    'asset.commands.user.delete',
    'asset.results.user',
    'asset.quarantine',
    'asset.operator.notifications',
    '$JS.API.STREAM.CREATE.HIJACK',
    '$JS.API.STREAM.UPDATE.ASSET_COMMANDS',
    '$JS.API.STREAM.PURGE.ASSET_COMMANDS',
    '$JS.API.STREAM.MSG.GET.ASSET_COMMANDS',
    '$JS.API.CONSUMER.CREATE.ASSET_COMMANDS',
    '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_wallpaper',
    '$JS.ACK.ASSET_RESULTS.results_wallpaper.1.1.1.1.0',
  ]) {
    await expect(user.request(target, codec.encode('{}'), { timeout: 200 })).rejects.toThrow();
  }
  await expect(
    wallpaper
      .jetstream()
      .publish('asset.commands.user.create', codec.encode('spoof'), { timeout: 200 })
  ).rejects.toThrow();
  await legacy
    .jetstream()
    .publish('asset.commands.user.create', codec.encode('legacy-spoof'), { timeout: 200 })
    .catch(() => undefined);
  expect((await manager.streams.info('ASSET_COMMANDS')).state.messages).toBe(1);
  await service.jetstream().publish('asset.results.user', codec.encode('user-result'));
  await service.jetstream().publish('asset.results.wallpaper', codec.encode('wallpaper-result'));
  const userResults = await user.jetstream().consumers.get('ASSET_RESULTS', 'results_user');
  const message = await userResults.next({ expires: 1000 });
  expect(message?.string()).toBe('user-result');
  message?.ack();
  expect(await userResults.next({ expires: 1000 })).toBeNull();
  await expect(
    user.jetstream().consumers.get('ASSET_RESULTS', 'results_wallpaper')
  ).rejects.toThrow();
  await expect(legacy.jetstream().consumers.get('ASSET_RESULTS', 'results_user')).rejects.toThrow();
  expect(
    (await manager.consumers.info('ASSET_RESULTS', 'results_user')).config.filter_subject
  ).toBe('asset.results.user');
});
