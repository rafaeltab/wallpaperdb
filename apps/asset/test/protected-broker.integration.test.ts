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
  const connection = await connect({ servers: url, user, pass, inboxPrefix, reconnect: false });
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
  for (const application of Object.values(authority.applications)) {
    const operator = await connection(application.operatorUser, 'operator-secret');
    await provisionAssetBroker(operator, authority, application.id);
  }
});
afterAll(async () => {
  await Promise.all(connections.map((client) => client.close()));
  await container?.stop();
});
it('isolates application publication and each filtered result consumer from all alternate ingress and control planes', async () => {
  const user = await connection('user-1', 'user-secret', '_ASSET_INBOX.user');
  const wallpaper = await connection('wallpaper-1', 'wallpaper-secret', '_ASSET_INBOX.wallpaper');
  const service = await connection('asset-service_user', 'service-secret', '_ASSET_INBOX.service');
  const operator = await connection('asset-operator_user', 'operator-secret');
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
    await expect(user.request(target, codec.encode('{}'), { timeout: 200 })).rejects.toMatchObject({
      code: 'PERMISSIONS_VIOLATION',
    });
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
  const wallpaperService = await connection(
    'asset-service_wallpaper',
    'service-secret',
    '_ASSET_INBOX.service'
  );
  await wallpaperService
    .jetstream()
    .publish('asset.results.wallpaper', codec.encode('wallpaper-result'));
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

it('cannot use permitted JetStream APIs to reflect replies into another application or a command subject', async () => {
  const user = await connection('user-1', 'user-secret', '_ASSET_INBOX.user');
  const service = await connection('asset-service_user', 'service-secret', '_ASSET_INBOX.service');
  const operator = await connection('asset-operator_user', 'operator-secret');
  const manager = await operator.jetstreamManager();
  const victimOperator = await connection('asset-operator_wallpaper', 'operator-secret');
  const observed = [
    'asset.commands.wallpaper.create',
    'asset.results.wallpaper',
    '_ASSET_INBOX.wallpaper.attack',
  ].map(
    (subject) =>
      new Promise<string | undefined>((resolve, reject) => {
        victimOperator.subscribe(subject, {
          max: 1,
          timeout: 1000,
          callback: (error, message) => {
            if (error?.code === 'TIMEOUT') resolve(undefined);
            else if (error) reject(error);
            else resolve(message.string());
          },
        });
      })
  );
  await victimOperator.flush();
  const commandCount = (await manager.streams.info('ASSET_COMMANDS')).state.messages;
  const resultCount = (await manager.streams.info('ASSET_RESULTS')).state.messages;
  await service.jetstream().publish('asset.results.user', 'private-user-result');
  user.publish(
    '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_user',
    JSON.stringify({ batch: 1, expires: 1000000000 }),
    { reply: 'asset.results.wallpaper' }
  );
  user.publish('$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_user', '{}', {
    reply: 'asset.commands.wallpaper.create',
  });
  user.publish('$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_user', '{}', {
    reply: '_ASSET_INBOX.wallpaper.attack',
  });
  await user.flush();
  expect(await Promise.all(observed)).toEqual([undefined, undefined, undefined]);
  await expect
    .poll(async () => (await manager.streams.info('ASSET_COMMANDS')).state.messages, {
      timeout: 1500,
    })
    .toBe(commandCount);
  expect((await manager.streams.info('ASSET_RESULTS')).state.messages).toBe(resultCount + 1);
});

it('denies direct reads of another application and retains application identity through credential overlap and revocation', async () => {
  const old = await connection('user-1', 'user-secret', '_ASSET_INBOX.user');
  for (const subject of [
    'asset.results.wallpaper',
    '_ASSET_INBOX.wallpaper.>',
    '_ASSET_INBOX.service.>',
    'asset.commands.>',
  ]) {
    const denied = new Promise<unknown>((resolve) => {
      old.subscribe(subject, { timeout: 1000, callback: (error) => resolve(error) });
    });
    await old.flush();
    expect(await denied).toMatchObject({ code: 'PERMISSIONS_VIOLATION' });
  }
  const raw = authorityFixture();
  raw.applications.user.credentials.push({
    user: 'user-2',
    password: 'rotated-secret',
    revision: '2',
  });
  const overlap = parseAuthority(raw);
  await container.copyContentToContainer([
    { content: renderBrokerConfiguration(overlap), target: '/etc/nats/asset.conf' },
  ]);
  await container.exec(['sh', '-c', 'kill -HUP 1']);
  let current: NatsConnection | undefined;
  await expect
    .poll(
      async () => {
        try {
          current = await connection('user-2', 'rotated-secret', '_ASSET_INBOX.user');
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 3000 }
    )
    .toBe(true);
  await old.jetstream().publish('asset.commands.user.create', 'old-generation');
  if (!current) throw new Error('Rotation did not establish a new connection');
  await current.jetstream().publish('asset.commands.user.create', 'new-generation');
  raw.applications.user.credentials.shift();
  await container.copyContentToContainer([
    { content: renderBrokerConfiguration(parseAuthority(raw)), target: '/etc/nats/asset.conf' },
  ]);
  await container.exec(['sh', '-c', 'kill -HUP 1']);
  await expect.poll(() => old.isClosed(), { timeout: 3000 }).toBe(true);
  await expect(connection('user-1', 'user-secret', '_ASSET_INBOX.user')).rejects.toMatchObject({
    code: 'AUTHORIZATION_VIOLATION',
  });
  await current.jetstream().publish('asset.commands.user.create', 'still-same-application');
  const operator = await connection('asset-operator_user', 'operator-secret');
  const manager = await operator.jetstreamManager();
  expect((await manager.streams.info('ASSET_COMMANDS')).config.subjects).toEqual([
    'asset.commands.user.create',
    'asset.commands.user.delete',
  ]);
});
