import { once } from 'node:events';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer } from 'effect';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { assetWorkflowLayer } from '../../src/adapters/asset-workflow/index.js';
import { workflowPostgresLayer } from '../../src/adapters/workflow/index.js';
import { CreatorAuthentication, creationLayer } from '../../src/capabilities/creation/index.js';
import { registerCreationHttp } from '../../src/http/index.js';

// A process boundary keeps each application's implementation and dependencies local.
// Only the identity-provider adapter is controlled; HTTP, PostgreSQL and publication are real.
const databaseUrl = process.env.PUBLICATION_TEST_DATABASE_URL;
const natsUrl = process.env.PUBLICATION_TEST_NATS_URL;
if (!databaseUrl || !natsUrl) throw new Error('Missing publication fixture endpoints');
const pool = new Pool({ connectionString: databaseUrl });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}
const store = workflowPostgresLayer({
  databaseUrl,
  maxAttempts: 3,
  retryDelayMs: 10,
  leaseMs: 5000,
});
const creation = creationLayer('clerk').pipe(Layer.provideMerge(store));
const workflow = assetWorkflowLayer({
  natsUrl,
  ownerNamespace: 'clerk',
  credential: { user: 'wallpaper-client', password: 'application-test' },
  identityProviders: [],
  operatorNotification: { url: 'http://127.0.0.1:1/unused', token: 'test' },
  maxAttempts: 3,
  retryDelayMs: 10,
  pollMs: 10,
  shutdownTimeoutMs: 1000,
}).pipe(Layer.provide(creation));
const app = Fastify();
try {
  await registerCreationHttp(
    app,
    Layer.mergeAll(
      creation,
      workflow,
      Layer.succeed(CreatorAuthentication, {
        verify: (authorization) =>
          Effect.succeed(
            authorization === 'Bearer owner' ? { namespace: 'clerk', subject: 'owner' } : null
          ),
      })
    )
  );
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(`PUBLICATION_FIXTURE ${JSON.stringify({ url })}\n`);
  process.stdin.resume();
  await once(process.stdin, 'end');
} finally {
  await app.close();
}
