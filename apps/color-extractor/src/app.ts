import { Effect, Layer } from 'effect';
import type { FastifyInstance } from 'fastify';
import {
  ConsumerHealth,
  EventsHealth,
  natsConsumerLayer,
  natsEventsLayer,
} from './adapters/events/index.js';
import { ImageHealth, imageLayer } from './adapters/image/index.js';
import { AvailabilityProbe, availabilityLayer } from './availability/index.js';
import type { Config } from './config.js';
import { extractionLayer } from './extraction/index.js';
import { createHttpApp } from './http/index.js';
import { tracingLayer } from './runtime.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}
export function colorExtractorLayer(config: Config, options: AppOptions = {}) {
  const image = imageLayer({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    bucket: config.s3Bucket,
    assetReferenceBucket: config.assetReferenceBucket,
  });
  const eventOptions = {
    url: config.natsUrl,
    stream: config.natsStream,
    serviceName: config.otelServiceName,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  };
  const events = natsEventsLayer(eventOptions);
  const extraction = extractionLayer.pipe(Layer.provide(Layer.mergeAll(image, events)));
  const consumer = natsConsumerLayer(eventOptions).pipe(
    Layer.provide(Layer.mergeAll(extraction, events))
  );
  const probe = Layer.effect(
    AvailabilityProbe,
    Effect.gen(function* () {
      const storage = yield* ImageHealth;
      const broker = yield* EventsHealth;
      const worker = yield* ConsumerHealth;
      return AvailabilityProbe.of({
        inspect: () =>
          Effect.all(
            {
              s3: storage.check(),
              nats: broker.check(),
              consumer: worker.check(),
              otel: Effect.succeed(!config.otelEndpoint || options.otelHealthy === true),
            },
            { concurrency: 'unbounded' }
          ),
      });
    })
  ).pipe(Layer.provide(Layer.mergeAll(image, events, consumer)));
  return availabilityLayer.pipe(Layer.provide(probe), Layer.provideMerge(tracingLayer));
}
export async function createApp(
  config: Config,
  options: AppOptions = {}
): Promise<FastifyInstance> {
  return createHttpApp(
    { nodeEnv: config.nodeEnv, port: config.port },
    colorExtractorLayer(config, options),
    options
  );
}
