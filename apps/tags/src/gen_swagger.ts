import { writeFile } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import { createHttpApp } from './http/index.js';

const app = await createHttpApp(
  { nodeEnv: 'development', port: 3008 },
  availabilityLayer.pipe(
    Layer.provide(
      Layer.succeed(AvailabilityProbe, {
        inspect: () => Effect.die('OpenAPI generation does not execute health probes'),
      })
    )
  )
);
try {
  await writeFile('swagger.json', JSON.stringify(app.swagger(), null, 2));
} finally {
  await app.close();
}
