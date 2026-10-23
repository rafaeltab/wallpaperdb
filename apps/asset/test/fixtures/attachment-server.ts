import { createInterface } from 'node:readline';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connect } from 'nats';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { authorityFixture } from './authority.js';
import { parseAuthority } from '../../src/authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../../src/adapters/lifecycle/index.js';
import { lifecycleLayer } from '../../src/capabilities/lifecycle/index.js';
import {
  protectedCommandsLayer,
  ProtectedCommandHealth,
  provisionAssetBroker,
  renderBrokerConfiguration,
} from '../../src/adapters/commands/index.js';
import {
  sourcePostgresLayer,
  sourceStorageLayer,
  sourceConfirmationsLayer,
  SourceConfirmationHealth,
} from '../../src/adapters/sources/index.js';
import { sourcesLayer } from '../../src/capabilities/sources/index.js';
import { AuthorAuthentication } from '../../src/adapters/authors/index.js';
import { AssetDelivery } from '../../src/capabilities/delivery/index.js';
import { Availability } from '../../src/capabilities/availability/index.js';
import { createHttpApp } from '../../src/http/index.js';
const raw = authorityFixture();
raw.applications.user.allowedOperations.push('delete');
const authority = parseAuthority(raw);
const setup = z.object({
  databaseUrl: z.string(),
  natsUrl: z.string(),
  storage: z.object({
    endpoint: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    bucket: z.string(),
  }),
});
const request = z.object({
  id: z.number().int(),
  operation: z.enum([
    'describe',
    'configure',
    'start-commands',
    'stop-commands',
    'start-confirmations',
    'close',
  ]),
  options: z.unknown().optional(),
});
let options: z.infer<typeof setup> | undefined;
let app: FastifyInstance | undefined;
let commands: ReturnType<typeof startCommands> | undefined;
let confirmations: ReturnType<typeof startConfirmations> | undefined;
const configured = () => {
  if (!options) throw new Error('Fixture is not configured');
  return options;
};
const persistence = () =>
  lifecyclePostgresLayer({
    databaseUrl: configured().databaseUrl,
    revision: authority.identity,
    ...authority.delivery,
    leaseMs: 1000,
  });
const sourcePersistence = () =>
  sourcePostgresLayer({
    databaseUrl: configured().databaseUrl,
    ...authority.delivery,
    leaseMs: 1000,
  });
const commandOptions = () => ({
  url: configured().natsUrl,
  credential: authority.broker.service,
  applications: authority.applications,
  maxAckPending: authority.broker.maxAckPending,
  ...authority.delivery,
});
function startCommands() {
  return ManagedRuntime.make(
    protectedCommandsLayer(commandOptions()).pipe(
      Layer.provideMerge(
        lifecycleLayer({
          assetTypes: authority.assetTypes,
          revision: authority.identity,
          applications: authority.applications,
        }).pipe(Layer.provide(persistence()))
      ),
      Layer.provide(persistence())
    )
  );
}
function startConfirmations() {
  return ManagedRuntime.make(
    sourceConfirmationsLayer(commandOptions()).pipe(Layer.provide(sourcePersistence()))
  );
}
let stopping: Promise<void> | undefined;
const close = () => {
  stopping ??= (async () => {
    const results = await Promise.allSettled([
      app?.close(),
      confirmations?.dispose(),
      commands?.dispose(),
    ]);
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Asset fixture cleanup failed');
  })();
  return stopping;
};
process.once('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});
const lines = createInterface({ input: process.stdin });
try {
  for await (const line of lines) {
    const parsed = request.parse(JSON.parse(line));
    try {
      let result: unknown = null;
      if (parsed.operation === 'describe')
        result = {
          brokerConfiguration: renderBrokerConfiguration(authority),
          delivery: authority.delivery,
          application: { user: 'user-1', password: 'user-secret' },
          operator: { user: 'asset-operator_user', password: authority.broker.operator.password },
        };
      if (parsed.operation === 'configure') {
        options = setup.parse(parsed.options);
        const pool = new Pool({ connectionString: options.databaseUrl });
        try {
          await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
        } finally {
          await pool.end();
        }
        await Effect.runPromise(activateLifecycle(options.databaseUrl, authority.identity));
        for (const id of ['user', 'wallpaper']) {
          const connection = await connect({
            servers: options.natsUrl,
            user: `asset-operator_${id}`,
            pass: authority.broker.operator.password,
          });
          try {
            await provisionAssetBroker(connection, authority, id);
          } finally {
            await connection.close();
          }
        }
        const bytes = sourceStorageLayer({ ...options.storage, region: 'us-east-1' });
        const sources = sourcesLayer({
          revision: authority.identity,
          types: authority.assetTypes,
        }).pipe(Layer.provide(Layer.merge(sourcePersistence(), bytes)));
        app = await createHttpApp(
          { nodeEnv: 'test', port: 3003 },
          Layer.merge(
            Layer.succeed(Availability, {
              health: () => Effect.die('unused'),
              ready: () => Effect.die('unused'),
            }),
            Layer.succeed(AssetDelivery, {
              wallpaper: () => Effect.die('unused'),
              picture: () => Effect.die('unused'),
            })
          ),
          {
            sourceServices: Layer.merge(
              sources,
              Layer.succeed(AuthorAuthentication, {
                verify: (token) =>
                  Effect.succeed(
                    token?.startsWith('Bearer ')
                      ? { namespace: 'clerk-test', subject: token.slice(7) }
                      : null
                  ),
              })
            ),
          }
        );
        // Private fixture control uses stdin. All picture operations use real HTTP.
        result = { url: await app.listen({ host: '127.0.0.1', port: 0 }) };
      }
      if (parsed.operation === 'start-commands') {
        if (commands) throw new Error('Command service already started');
        commands = startCommands();
        await commands.runPromise(ProtectedCommandHealth);
      }
      if (parsed.operation === 'stop-commands') {
        await commands?.dispose();
        commands = undefined;
      }
      if (parsed.operation === 'start-confirmations') {
        if (confirmations) throw new Error('Source publisher already started');
        confirmations = startConfirmations();
        await confirmations.runPromise(SourceConfirmationHealth);
      }
      if (parsed.operation === 'close') await close();
      process.stdout.write(
        'ATTACHMENT_FIXTURE ' + JSON.stringify({ id: parsed.id, result }) + '\n'
      );
      if (parsed.operation === 'close') break;
    } catch (error) {
      process.stderr.write(String(error) + '\n');
      process.stdout.write(
        'ATTACHMENT_FIXTURE ' +
          JSON.stringify({ id: parsed.id, error: 'Asset fixture operation failed' }) +
          '\n'
      );
    }
  }
} finally {
  await close();
}
