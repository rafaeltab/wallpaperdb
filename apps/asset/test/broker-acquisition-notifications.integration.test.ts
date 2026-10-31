import { Effect, Layer, ManagedRuntime } from 'effect';
import { operatorWebhookLayer } from '../src/adapters/commands/index.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url, ending) => {
  const options = {
    url,
    credential: { user: 'test', password: 'test' },
    target: { url: 'http://127.0.0.1', token: 'test' },
    applications: {
      test: {
        id: 'test',
        serviceUser: 'test',
        createSubject: 'asset.commands.test.create',
        deleteSubject: 'asset.commands.test.delete',
        resultSubject: 'asset.results.test',
      },
    },
    maxAttempts: 2,
    retryDelayMs: 10,
    shutdownTimeoutMs: 100,
  };
  const layer = operatorWebhookLayer(options);
  const runtime = ManagedRuntime.make(layer);
  return {
    run: (signal) =>
      ending === 'cancellation'
        ? Effect.runPromiseExit(Effect.scoped(Layer.build(layer)), { signal })
        : runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
