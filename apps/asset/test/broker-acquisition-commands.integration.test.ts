import { Effect, Layer, ManagedRuntime } from 'effect';
import { protectedCommandsLayer } from '../src/adapters/commands/index.js';
import { Lifecycle, ResultOutbox } from '../src/capabilities/lifecycle/index.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url, ending) => {
  const options = {
    url,
    credential: { user: 'test', password: 'test' },
    applications: {
      test: {
        id: 'test',
        serviceUser: 'test',
        createSubject: 'asset.commands.test.create',
        deleteSubject: 'asset.commands.test.delete',
        resultSubject: 'asset.results.test',
      },
    },
    maxAckPending: 1,
    maxAttempts: 2,
    retryDelayMs: 10,
    pollMs: 10,
    shutdownTimeoutMs: 100,
  };
  const layer = protectedCommandsLayer(options).pipe(
    Layer.provide(Layer.mergeAll(Layer.mock(Lifecycle, {}), Layer.mock(ResultOutbox, {})))
  );
  const runtime = ManagedRuntime.make(layer);
  return {
    run: (signal) =>
      ending === 'cancellation'
        ? Effect.runPromiseExit(Effect.scoped(Layer.build(layer)), { signal })
        : runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
