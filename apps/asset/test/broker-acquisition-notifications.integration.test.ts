import { Effect, ManagedRuntime } from 'effect';
import { operatorWebhookLayer } from '../src/adapters/commands/index.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url) => {
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
  const runtime = ManagedRuntime.make(operatorWebhookLayer(options));
  return {
    run: (signal) => runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
