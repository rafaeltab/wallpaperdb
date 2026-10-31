import { Effect, Layer, ManagedRuntime } from 'effect';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url, ending) => {
  const options = {
    url,
    stream: 'TEST',
    serviceName: 'test',
    shutdownTimeoutMs: 100,
  };
  const layer = natsEventsLayer(options);
  const runtime = ManagedRuntime.make(layer);
  return {
    run: (signal) =>
      ending === 'cancellation'
        ? Effect.runPromiseExit(Effect.scoped(Layer.build(layer)), { signal })
        : runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
