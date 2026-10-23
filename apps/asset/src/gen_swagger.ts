import { writeFile } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { AvailabilityProbe, availabilityLayer } from './capabilities/availability/index.js';
import { AssetDelivery } from './capabilities/delivery/index.js';
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
  Layer.succeed(AssetDelivery, {
    wallpaper: () => Effect.succeed({ _tag: 'NotFound' }),
    picture: () => Effect.succeed({ _tag: 'NotFound' }),
  })
);
import { Sources } from './capabilities/sources/index.js';
import { AuthorAuthentication } from './adapters/authors/index.js';
const sourceServices = Layer.merge(
  Layer.succeed(AuthorAuthentication, { verify: () => Effect.succeed(null) }),
  Layer.succeed(Sources, {
    selectDefault: () => Effect.succeed({ kind: 'unavailable' }),
    withdraw: () => Effect.succeed({ kind: 'unavailable' }),
    policy: () => Effect.die('Documentation only'),
    list: () => Effect.die('Documentation only'),
    create: () => Effect.die('Documentation only'),
    status: () => Effect.die('Documentation only'),
    upload: () => Effect.die('Documentation only'),
    cancel: () => Effect.die('Documentation only'),
    accept: () => Effect.die('Documentation only'),
    original: () => Effect.die('Documentation only'),
  })
);
const app = await createHttpApp({ nodeEnv: 'development', port: 3003 }, services, {
  sourceServices,
});
try {
  await writeFile('swagger.json', JSON.stringify(app.swagger(), null, 2));
} finally {
  await app.close();
}
