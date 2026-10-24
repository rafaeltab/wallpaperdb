import { connect } from 'nats';
import { assetBrokerTransport } from '../../src/adapters/nats.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { runOperator } from '../../scripts/operator.js';
import { readAuthority } from '../../src/authority.js';
import { Lifecycle, ResultOutbox } from '../../src/capabilities/lifecycle/index.js';
import {
  protectedCommandsLayer,
  ProtectedCommandHealth,
  operatorWebhookLayer,
  OperatorNotificationHealth,
} from '../../src/adapters/commands/index.js';
import {
  sourceConfirmationsLayer,
  SourceConfirmationHealth,
} from '../../src/adapters/sources/index.js';
import { SourceAcceptanceOutbox } from '../../src/capabilities/sources/index.js';
import { natsEventsLayer, EventsHealth } from '../../src/adapters/events/index.js';

const [mode, url, path] = process.argv.slice(2);
if (!url || !path) throw new Error('Fixture arguments required');
const authority = readAuthority(path);
const user = authority.applications.user;
if (!user) throw new Error('Missing User authority fixture');
const applications = { user };
const options = {
  url,
  credential: authority.broker.service,
  applications,
  maxAckPending: authority.broker.maxAckPending,
  ...authority.delivery,
};
const controlled = Layer.merge(
  Layer.succeed(Lifecycle, {
    command: () => Effect.die('No commands expected'),
    inspect: () => Effect.die('No inspection expected'),
  }),
  Layer.succeed(ResultOutbox, {
    claim: () => Effect.succeed([]),
    pendingAlerts: () => Effect.succeed([]),
    published: () => Effect.void,
    failed: () => Effect.void,
    alerted: () => Effect.void,
    recover: () => Effect.succeed(false),
  })
);
try {
  if (mode === 'operator') {
    await runOperator(['provision', '--url', url, '--authority-file', path]);
  } else if (mode === 'commands') {
    const runtime = ManagedRuntime.make(
      protectedCommandsLayer(options).pipe(Layer.provide(controlled))
    );
    try {
      await runtime.runPromise(ProtectedCommandHealth);
    } finally {
      await runtime.dispose();
    }
  } else if (mode === 'sources') {
    const runtime = ManagedRuntime.make(
      sourceConfirmationsLayer(options).pipe(
        Layer.provide(
          Layer.succeed(SourceAcceptanceOutbox, {
            claim: () => Effect.succeed([]),
            pendingAlerts: () => Effect.succeed([]),
            published: () => Effect.void,
            failed: () => Effect.void,
            alerted: () => Effect.void,
            recover: () => Effect.succeed(false),
          })
        )
      )
    );
    try {
      const health = await runtime.runPromise(SourceConfirmationHealth);
      if (!(await runtime.runPromise(health.check())))
        throw new Error('Source publisher unavailable');
    } finally {
      await runtime.dispose();
    }
  } else if (mode === 'notifications') {
    const runtime = ManagedRuntime.make(
      operatorWebhookLayer({ ...options, target: authority.operatorNotification })
    );
    try {
      await runtime.runPromise(OperatorNotificationHealth);
    } finally {
      await runtime.dispose();
    }
  } else if (mode === 'legacy-setup') {
    const connection = await connect({ ...assetBrokerTransport(url), timeout: 5000 });
    try {
      const manager = await connection.jetstreamManager();
      await manager.streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] });
    } finally {
      await connection.close();
    }
  } else if (mode === 'events') {
    const runtime = ManagedRuntime.make(
      natsEventsLayer({ url, stream: 'WALLPAPER', serviceName: 'asset-test' })
    );
    try {
      await runtime.runPromise(EventsHealth);
    } finally {
      await runtime.dispose();
    }
  } else throw new Error('Unknown fixture mode');
  process.stdout.write('broker-selection: accepted\n');
} catch {
  process.stdout.write('broker-selection: refused\n');
  process.exitCode = 1;
}
