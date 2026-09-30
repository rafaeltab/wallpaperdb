import { createHash } from 'node:crypto';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import {
  COLOR_ANCHORS_SHA256,
  COLOR_REFERENCE_COMMIT,
  WallpaperColorsExtractedCloudEventSchema,
} from '@wallpaperdb/events';
import { context, propagation, trace } from '@opentelemetry/api';
import { Clock, Context, Effect, Exit, Layer, Option, Semaphore } from 'effect';
import {
  connect,
  headers,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import { ColorEvents, ExtractionUnavailable } from '../../capabilities/extraction/index.js';

export interface NatsEventsOptions {
  readonly url: string;
  readonly stream: string;
  readonly serviceName: string;
  readonly retryDelayMs?: number;
  readonly shutdownTimeoutMs?: number;
}
export interface EventsHealth {
  check(): Effect.Effect<boolean>;
}
export const EventsHealth = Context.Service<EventsHealth>(
  'wallpaperdb/color-extractor/EventsHealth'
);
export interface NatsBroker {
  readonly connection: NatsConnection;
  readonly client: JetStreamClient;
  readonly manager: JetStreamManager;
}
export const NatsBroker = Context.Service<NatsBroker>('wallpaperdb/color-extractor/NatsBroker');
export function broker<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ExtractionUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Color extraction broker operation failed', { operation, cause: error.cause })
    )
  );
}
class NatsColorEvents implements ColorEvents {
  constructor(
    private readonly client: JetStreamClient,
    private readonly stream: string,
    private readonly permits: Semaphore.Semaphore
  ) {}
  readonly publish = Effect.fn('colors.events.publish')(function* (
    this: NatsColorEvents,
    result: Parameters<ColorEvents['publish']>[0]
  ) {
    const { input, measurements, originalSha256 } = result;
    const source = 'https://wallpaperdb/color-extractor';
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          'colors-extracted',
          measurements.version,
          input.occurrence.source,
          input.occurrence.id,
        ])
      )
      .digest('hex');
    const parsed = WallpaperColorsExtractedCloudEventSchema.safeParse({
      specversion: '1.0',
      source,
      id,
      type: 'wallpaper.colors.extracted',
      time: input.timestamp,
      datacontenttype: 'application/json',
      correlationid: input.correlationId,
      causationid: input.occurrence.id,
      causationsource: input.occurrence.source,
      data: {
        schemaVersion: 1,
        wallpaperId: input.wallpaperId,
        original: {
          owner: 'ingestor',
          id: 'owner' in input.storage ? input.storage.id : input.wallpaperId,
        },
        provenance: {
          referenceCommit: COLOR_REFERENCE_COMMIT,
          anchorsSha256: COLOR_ANCHORS_SHA256,
          originalSha256,
        },
        measurements,
      },
    });
    if (!parsed.success)
      return yield* Effect.fail(
        new ExtractionUnavailable({ operation: 'validate-colors', cause: parsed.error })
      ).pipe(
        Effect.tapError((error) =>
          Effect.logError('Color measurement publication rejected', {
            operation: error.operation,
            cause: error.cause,
          })
        )
      );
    const event = parsed.data;
    const carrier: Record<string, string> = {};
    const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.option);
    propagation.inject(
      Option.isSome(span) ? trace.setSpan(context.active(), span.value) : context.active(),
      carrier
    );
    const metadata = headers();
    for (const [key, value] of Object.entries(carrier)) metadata.set(key, value);
    metadata.set('content-type', 'application/cloudevents+json');
    const messageId = JSON.stringify([source, id]);
    metadata.set('Nats-Msg-Id', messageId);
    metadata.set('Nats-Expected-Stream', this.stream);
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload) + Buffer.byteLength(metadata.toString()) > 64 * 1024)
      return yield* Effect.fail(
        new ExtractionUnavailable({
          operation: 'encode-colors',
          cause: new Error('Measurement event exceeds the 64 KiB source-message budget'),
        })
      ).pipe(
        Effect.tapError((error) =>
          Effect.logError('Color measurement publication rejected', {
            operation: error.operation,
            cause: error.cause,
          })
        )
      );
    const started = yield* Clock.currentTimeMillis;
    yield* this.permits.withPermits(1)(
      broker('publish-colors', () =>
        this.client.publish('wallpaper.colors.extracted', payload, {
          headers: metadata,
          msgID: messageId,
          expect: { streamName: this.stream },
          timeout: 5000,
        })
      ).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const duration = (yield* Clock.currentTimeMillis) - started;
            yield* Effect.sync(() => {
              const attributes = { 'event.type': 'wallpaper.colors.extracted' };
              recordCounter('events.published.total', 1, {
                ...attributes,
                status: Exit.isSuccess(exit) ? 'success' : 'error',
              });
              recordHistogram('events.publish_duration_ms', duration, attributes);
            }).pipe(Effect.catchCause(() => Effect.void));
          })
        ),
        Effect.uninterruptible
      )
    );
  });
}
export function natsEventsLayer(
  options: NatsEventsOptions
): Layer.Layer<ColorEvents | EventsHealth | NatsBroker, ExtractionUnavailable> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        broker('connect-events', () =>
          connect({ servers: options.url, name: options.serviceName, timeout: 5000 })
        ),
        (connection) =>
          broker('drain-events', () => connection.drain()).pipe(
            Effect.interruptible,
            Effect.timeout(options.shutdownTimeoutMs ?? 5000),
            Effect.catchCause(() => Effect.promise(() => connection.close()))
          )
      );
      const manager = yield* broker('create-event-manager', () =>
        connection.jetstreamManager({ timeout: 5000 })
      );
      yield* broker('inspect-event-stream', () => manager.streams.info(options.stream));
      const client = connection.jetstream({ timeout: 5000 });
      const permits = yield* Semaphore.make(1);
      return Context.make(ColorEvents, new NatsColorEvents(client, options.stream, permits)).pipe(
        Context.add(NatsBroker, { connection, client, manager }),
        Context.add(EventsHealth, {
          check: () =>
            connection.isClosed()
              ? Effect.succeed(false)
              : broker('check-events', () => manager.streams.info(options.stream)).pipe(
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
        })
      );
    })
  );
}
