import { Effect, Layer, ManagedRuntime } from 'effect';
import { sourceConfirmationsLayer } from '../src/adapters/sources/index.js';
import { SourceAcceptanceOutbox } from '../src/capabilities/sources/index.js';
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
    retryDelayMs: 10,
    pollMs: 10,
    shutdownTimeoutMs: 100,
  };
  const runtime = ManagedRuntime.make(
    sourceConfirmationsLayer(options).pipe(
      Layer.provide(Layer.mergeAll(Layer.mock(SourceAcceptanceOutbox, {})))
    )
  );
  return {
    run: (signal) => runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
