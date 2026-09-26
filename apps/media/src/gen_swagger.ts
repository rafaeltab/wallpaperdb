import { writeFile } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import { MediaDelivery } from './delivery/index.js';
import { createHttpApp } from './http/index.js';
const services = Layer.merge(
  availabilityLayer.pipe(
    Layer.provide(
      Layer.succeed(AvailabilityProbe, {
        inspect: () =>
          Effect.succeed({ database: false, s3: false, nats: false, consumer: false, otel: false }),
      })
    )
  ),
  Layer.succeed(MediaDelivery, {
    wallpaper: () => Effect.succeed({ _tag: 'NotFound' }),
    picture: () => Effect.succeed({ _tag: 'NotFound' }),
  })
);
const app = await createHttpApp({ nodeEnv: 'development', port: 3003 }, services);
try {
  await writeFile('swagger.json', JSON.stringify(app.swagger(), null, 2));
} finally {
  await app.close();
}
