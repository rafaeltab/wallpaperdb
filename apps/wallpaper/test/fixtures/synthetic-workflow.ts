import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { AckPolicy, connect, StorageType } from 'nats';
import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import type { WorkflowConfig } from '../../src/workflow-config.js';

/** Public, disposable workflow dependencies for the real development entry point. */
export async function syntheticWorkflow(
  directory: string,
  databaseUrl: string,
  defer: (release: () => Promise<unknown>) => void
) {
  const pool = new Pool({ connectionString: databaseUrl });
  defer(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  const nats = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      {
        target: '/configuration.json',
        content: JSON.stringify({
          port: 4222,
          http: 8222,
          jetstream: { store_dir: '/data' },
          no_auth_user: 'legacy',
          accounts: {
            LEGACY: { jetstream: 'enabled', users: [{ user: 'legacy', password: '' }] },
            ASSET_WALLPAPER: {
              jetstream: 'enabled',
              users: [
                { user: 'operator', password: 'operator-test' },
                {
                  user: 'wallpaper-client',
                  password: 'application-test',
                  permissions: {
                    publish: {
                      allow: [
                        'asset.commands.wallpaper.create',
                        '$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_wallpaper',
                        '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_wallpaper',
                        '$JS.ACK.>',
                      ],
                    },
                    subscribe: { allow: ['_ASSET_INBOX.wallpaper.>'] },
                  },
                },
              ],
            },
          },
        }),
      },
    ])
    .withCommand(['-c', '/configuration.json'])
    .withExposedPorts(4222, 8222)
    .withWaitStrategy(Wait.forHttp('/healthz', 8222))
    .start();
  defer(() => nats.stop());
  const brokerUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
  const operator = await connect({ servers: brokerUrl, user: 'operator', pass: 'operator-test' });
  defer(() => operator.close());
  const manager = await operator.jetstreamManager();
  await manager.streams.add({
    name: 'ASSET_RESULTS',
    subjects: ['asset.results.wallpaper'],
    storage: StorageType.File,
  });
  await manager.consumers.add('ASSET_RESULTS', {
    durable_name: 'results_wallpaper',
    filter_subject: 'asset.results.wallpaper',
    ack_policy: AckPolicy.Explicit,
  });
  await operator.close();
  const workflowFile = join(directory, 'workflow.json');
  await writeFile(
    workflowFile,
    JSON.stringify({
      ownerNamespace: 'test-authors',
      credential: { user: 'wallpaper-client', password: 'application-test' },
      identityProviders: [
        {
          issuer: 'https://identity.example.test',
          jwksUrl: 'https://identity.example.test/.well-known/jwks.json',
          ownerNamespace: 'test-authors',
          audience: [],
          authorizedParties: [],
          requireAuthorizedParty: false,
        },
      ],
      operatorNotification: { url: 'http://127.0.0.1:1/events', token: 'test' },
      maxAttempts: 3,
      retryDelayMs: 100,
      pollMs: 50,
      shutdownTimeoutMs: 3000,
    } satisfies WorkflowConfig),
    { mode: 0o600 }
  );
  return { nats, brokerUrl, workflowFile };
}
