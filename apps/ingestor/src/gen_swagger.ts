import { writeFile } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { Admission } from './admission/index.js';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import { Ingestion } from './ingestion/index.js';
import { createHttpApp } from './http/index.js';
const unavailable = () => Effect.die('Documentation generation never executes requests');
const services = Layer.mergeAll(
  Layer.succeed(Ingestion, { upload: unavailable, reconcile: unavailable, cleanup: unavailable }),
  Layer.succeed(Admission, { admit: unavailable }),
  availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, { inspect: unavailable })))
);
const app = await createHttpApp({ nodeEnv: 'test', rateLimitMax: 100 }, services);
try {
  await app.ready();
  await writeFile('swagger.json', JSON.stringify(app.swagger(), null, 2));
} finally {
  await app.close();
}
