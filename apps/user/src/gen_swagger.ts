import { writeFile } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { AvailabilityProbe, availabilityLayer } from './capabilities/availability/index.js';
import { Profiles } from './capabilities/profile/index.js';
import { Pictures } from './capabilities/pictures/index.js';
import { PictureAttachments, AttachmentHealth } from './capabilities/picture-attachments/index.js';
import { registerAttachmentHttp } from './http/index.js';
import { createHttpApp } from './http/index.js';

const unavailable = () => Effect.die('Schema generation does not execute commands');
const services = Layer.mergeAll(
  availabilityLayer.pipe(
    Layer.provide(
      Layer.succeed(AvailabilityProbe, {
        inspect: () =>
          Effect.succeed({ database: false, nats: false, otel: false, workers: false }),
      })
    )
  ),
  Layer.succeed(Profiles, {
    ensure: unavailable,
    updateDetails: unavailable,
    changeHandle: unavailable,
    reactivateAlias: unavailable,
    scheduleAliasExpiry: unavailable,
    expireAliasImmediately: unavailable,
    expireDueAlias: unavailable,
    adoptPicture: unavailable,
    adoptImportedPicture: unavailable,
  }),
  Layer.succeed(Pictures, {
    policy: unavailable,
    stage: unavailable,
    upload: unavailable,
    pictureAvailable: unavailable,
    importPending: unavailable,
    cleanupExpired: unavailable,
  })
);
const app = await createHttpApp({ nodeEnv: 'test', port: 3009 }, services, {
  configure: (app) =>
    registerAttachmentHttp(
      app,
      Layer.merge(
        Layer.succeed(AttachmentHealth, { check: unavailable }),
        Layer.succeed(PictureAttachments, {
          begin: unavailable,
          get: unavailable,
          expectSource: unavailable,
          cancel: unavailable,
          assetResult: unavailable,
          sourceAccepted: unavailable,
        })
      )
    ),
});
try {
  await app.ready();
  await writeFile('swagger.json', JSON.stringify(app.swagger(), null, 2));
} finally {
  await app.close();
}
