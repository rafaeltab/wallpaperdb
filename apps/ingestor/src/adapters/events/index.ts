import { context, propagation } from '@opentelemetry/api';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import {
  WallpaperUploadedCloudEventSchema,
  WALLPAPER_UPLOADED_SUBJECT,
} from '@wallpaperdb/events/schemas';
import { Clock, Context, Effect, Exit, Layer, Semaphore } from 'effect';
import { connect, headers, type JetStreamClient } from 'nats';
import { IngestionUnavailable, UploadEvents, type UploadedEvent } from '../../ingestion/index.js';

export interface UploadedEventsConfig {
  readonly url: string;
  readonly stream: string;
  readonly serviceName: string;
  readonly assetBucket: string;
}

export interface UploadEventsHealth {
  check(): Effect.Effect<boolean>;
}
export const UploadEventsHealth = Context.Service<UploadEventsHealth>(
  'wallpaperdb.ingestor.events.health'
);
const broker = <A>(operation: string, send: () => Promise<A>) =>
  Effect.tryPromise({
    try: send,
    catch: (cause) => new IngestionUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Upload event broker operation failed', {
        operation,
        cause: error.cause,
      })
    )
  );

function envelope(event: UploadedEvent, bucket: string) {
  const { wallpaper } = event;
  const { metadata } = wallpaper;
  return WallpaperUploadedCloudEventSchema.parse({
    specversion: '1.0',
    id: event.id,
    source: event.source,
    type: 'wallpaper.uploaded',
    time: event.occurredAt,
    datacontenttype: 'application/json',
    correlationid: event.correlationId,
    causationid: event.causationId,
    data: {
      wallpaper: {
        id: wallpaper.id,
        userId: wallpaper.profileId,
        fileType: metadata.fileType,
        mimeType: metadata.mimeType,
        fileSizeBytes: metadata.fileSizeBytes,
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.width / metadata.height,
        storageKey: `${wallpaper.id}/original.${metadata.extension}`,
        storageBucket: bucket,
        originalFilename: wallpaper.originalFilename,
        uploadedAt: wallpaper.uploadedAt,
      },
    },
  });
}

class NatsUploadEvents implements UploadEvents {
  constructor(
    private readonly client: JetStreamClient,
    private readonly config: UploadedEventsConfig,
    private readonly permits: Semaphore.Semaphore
  ) {}
  readonly publish = Effect.fn('ingestion.events.publish')(function* (
    this: NatsUploadEvents,
    event: UploadedEvent
  ) {
    const value = yield* Effect.try({
      try: () => envelope(event, this.config.assetBucket),
      catch: (cause) => new IngestionUnavailable({ operation: 'encode-upload-event', cause }),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError('Upload event encoding failed', { cause: error.cause })
      )
    );
    const started = yield* Clock.currentTimeMillis;
    const metadata = headers();
    const carrier: Record<string, string> = {};
    if (event.traceContext) {
      carrier.traceparent = event.traceContext.traceparent;
      if (event.traceContext.tracestate) carrier.tracestate = event.traceContext.tracestate;
    } else {
      propagation.inject(context.active(), carrier);
    }
    for (const [key, value] of Object.entries(carrier)) metadata.set(key, value);
    metadata.set('content-type', 'application/cloudevents+json');
    metadata.set('event-id', event.id);
    // NATS requests cannot be cancelled: retain their permit until the bounded PubAck wait settles.
    yield* this.permits.withPermits(1)(
      broker('publish-upload-event', () =>
        this.client.publish(
          WALLPAPER_UPLOADED_SUBJECT,
          new TextEncoder().encode(JSON.stringify(value)),
          {
            headers: metadata,
            msgID: JSON.stringify([event.source, event.id]),
            expect: { streamName: this.config.stream },
            timeout: 5000,
          }
        )
      ).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const finished = yield* Clock.currentTimeMillis;
            yield* Effect.try(() => {
              const attributes = { 'event.type': 'wallpaper.uploaded' };
              recordCounter('events.published.total', 1, {
                ...attributes,
                status: Exit.isSuccess(exit) ? 'success' : 'error',
              });
              recordHistogram('events.publish_duration_ms', finished - started, attributes);
            }).pipe(Effect.ignore);
          })
        ),
        Effect.uninterruptible
      )
    );
  });
}

export function uploadedEventsLayer(
  config: UploadedEventsConfig
): Layer.Layer<UploadEvents | UploadEventsHealth, IngestionUnavailable> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        broker('connect-upload-events', () =>
          connect({ servers: config.url, name: config.serviceName, timeout: 5000 })
        ),
        (connection) =>
          broker('close-upload-events', () => connection.drain()).pipe(
            Effect.timeout('5 seconds'),
            Effect.catch(() => Effect.promise(() => connection.close()))
          )
      );
      const manager = yield* broker('inspect-upload-stream', () =>
        connection.jetstreamManager({ timeout: 1000 })
      );
      yield* broker('inspect-upload-stream', () => manager.streams.info(config.stream));
      const permits = yield* Semaphore.make(32);
      return Context.make(
        UploadEvents,
        new NatsUploadEvents(connection.jetstream({ timeout: 5000 }), config, permits)
      ).pipe(
        Context.add(UploadEventsHealth, {
          check: () =>
            connection.isClosed()
              ? Effect.succeed(false)
              : broker('check-upload-events', () => manager.streams.info(config.stream)).pipe(
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
        })
      );
    })
  );
}
