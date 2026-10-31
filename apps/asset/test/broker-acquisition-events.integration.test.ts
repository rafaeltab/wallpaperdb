import { Effect, ManagedRuntime } from 'effect';
import { natsEventsLayer } from '../src/adapters/events/broker.js';
import { brokerAcquisitionContract } from './fixtures/broker-acquisition.js';

brokerAcquisitionContract((url) => {
  const options = {
    url,
    stream: 'TEST',
    serviceName: 'test',
    shutdownTimeoutMs: 100,
  };
  const runtime = ManagedRuntime.make(natsEventsLayer(options));
  return {
    run: (signal) => runtime.runPromiseExit(Effect.void, { signal }),
    dispose: () => runtime.dispose(),
  };
});
