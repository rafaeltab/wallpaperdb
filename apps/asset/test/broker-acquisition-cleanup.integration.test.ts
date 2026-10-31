import { Effect, Layer, ManagedRuntime } from 'effect';
import { cleanupWorkerLayer } from '../src/adapters/cleanup/worker.js';
import { Cleanup, CleanupStore } from '../src/capabilities/cleanup/index.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url) => {
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
    pollMs: 10,
    shutdownTimeoutMs: 100,
  };
  const runtime = ManagedRuntime.make(
    cleanupWorkerLayer(options).pipe(
      Layer.provide(Layer.mergeAll(Layer.mock(Cleanup, {}), Layer.mock(CleanupStore, {})))
    )
  );
  return {
    run: (signal) => runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
