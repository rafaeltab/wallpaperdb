import { AckPolicy, DiscardPolicy, RetentionPolicy, StorageType, type NatsConnection } from 'nats';
import type { Authority } from '../../authority.js';

const commands = 'ASSET_COMMANDS';
const results = 'ASSET_RESULTS';
const ownInbox = (prefix: string) => `${prefix}.>`;
function permissions(publish: readonly string[], inbox: string) {
  return { publish: { allow: publish }, subscribe: { allow: [ownInbox(inbox)] } };
}
const consumerOperations = (stream: string, consumer: string) => [
  `$JS.API.CONSUMER.INFO.${stream}.${consumer}`,
  `$JS.API.CONSUMER.MSG.NEXT.${stream}.${consumer}`,
  `$JS.ACK.${stream}.${consumer}.>`,
  `$JS.ACK.*.*.${stream}.${consumer}.>`,
];
/** The legacy account deliberately has no imports/exports with ASSET. Its broker
 * administration cannot create a stream, transform or consumer in this account. */
export function renderBrokerConfiguration(authority: Authority): string {
  const servicePermissions = [
    '$JS.API.INFO',
    ...[commands, results, 'ASSET_QUARANTINE', 'ASSET_OPERATIONS'].map(
      (stream) => `$JS.API.STREAM.INFO.${stream}`
    ),
    ...Object.keys(authority.applications).flatMap((id) =>
      consumerOperations(commands, `commands_${id}`)
    ),
    'asset.results.*',
    'asset.quarantine',
    'asset.operator.notifications',
  ];
  const users = [
    { user: authority.broker.operator.user, password: authority.broker.operator.password },
    {
      user: authority.broker.service.user,
      password: authority.broker.service.password,
      permissions: permissions(servicePermissions, '_ASSET_INBOX.service'),
    },
    ...Object.values(authority.applications).flatMap((application) =>
      application.credentials.map((credential) => ({
        user: credential.user,
        password: credential.password,
        permissions: permissions(
          [
            ...application.allowedOperations.map((operation) =>
              operation === 'create' ? application.createSubject : application.deleteSubject
            ),
            '$JS.API.INFO',
            ...consumerOperations(results, application.resultConsumer),
          ],
          application.inboxPrefix
        ),
      }))
    ),
  ];
  return JSON.stringify({
    port: 4222,
    http: 8222,
    jetstream: { store_dir: '/data' },
    no_auth_user: 'legacy',
    accounts: {
      LEGACY: { jetstream: 'enabled', users: [{ user: 'legacy', password: '' }] },
      ASSET: { jetstream: 'enabled', users },
    },
  });
}

/** Trusted bootstrap credentials own stream/consumer setup. Runtime credentials
 * cannot create, update or redirect them. Retention never evicts pending work. */
export async function provisionAssetBroker(
  connection: NatsConnection,
  authority: Authority
): Promise<void> {
  const manager = await connection.jetstreamManager();
  for (const [name, subjects] of [
    [
      commands,
      Object.values(authority.applications).flatMap((application) => [
        application.createSubject,
        application.deleteSubject,
      ]),
    ],
    [
      results,
      Object.values(authority.applications).map((application) => application.resultSubject),
    ],
    ['ASSET_QUARANTINE', ['asset.quarantine']],
    ['ASSET_OPERATIONS', ['asset.operator.notifications']],
  ] as const) {
    const config = {
      name,
      subjects: [...subjects],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.New,
      max_age: 0,
      max_msgs: -1,
      max_bytes: -1,
      max_msg_size: 16384,
      duplicate_window: 120_000_000_000,
    };
    const existing = await manager.streams.info(name).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '404')
        return null;
      throw error;
    });
    if (!existing) await manager.streams.add(config);
    else {
      if (
        existing.config.storage !== StorageType.File ||
        existing.config.retention !== RetentionPolicy.Limits ||
        existing.config.discard !== DiscardPolicy.New ||
        existing.config.max_age !== 0 ||
        existing.config.subject_transform ||
        existing.config.sources?.length ||
        existing.config.mirror
      )
        throw new Error(`Unsafe protected stream configuration: ${name}`);
      await manager.streams.update(name, config);
    }
  }
  for (const application of Object.values(authority.applications)) {
    for (const [stream, durable, subject] of [
      [commands, `commands_${application.id}`, `asset.commands.${application.id}.*`],
      [results, application.resultConsumer, application.resultSubject],
    ] as const) {
      const config = {
        durable_name: durable,
        filter_subject: subject,
        ack_policy: AckPolicy.Explicit,
        max_deliver: -1,
        ack_wait: 30_000_000_000,
        max_ack_pending: 1,
        max_batch: 1,
        max_expires: 30_000_000_000,
      };
      const existing = await manager.consumers.info(stream, durable).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '404')
          return null;
        throw error;
      });
      if (!existing) await manager.consumers.add(stream, config);
      else if (
        existing.config.filter_subject !== subject ||
        existing.config.ack_policy !== AckPolicy.Explicit ||
        existing.config.deliver_subject ||
        existing.config.filter_subjects?.length ||
        existing.config.max_deliver !== -1
      )
        throw new Error(`Unsafe protected consumer: ${stream}/${durable}`);
    }
  }
  const operatorConsumer = 'operator_notifications';
  const existing = await manager.consumers
    .info('ASSET_OPERATIONS', operatorConsumer)
    .catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '404')
        return null;
      throw error;
    });
  if (!existing)
    await manager.consumers.add('ASSET_OPERATIONS', {
      durable_name: operatorConsumer,
      filter_subject: 'asset.operator.notifications',
      ack_policy: AckPolicy.Explicit,
      max_deliver: -1,
    });
}
