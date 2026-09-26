import { createHash } from 'node:crypto';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Clock, Context, Effect, Exit, Layer, Metric, Option, Semaphore } from 'effect';
import {
  connect,
  headers,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import {
  VariantEvents,
  GenerationUnavailable,
  variantAssetReference,
} from '../../generation/index.js';

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
  'wallpaperdb/variant-generator/EventsHealth'
);
export interface NatsBroker {
  readonly connection: NatsConnection;
  readonly client: JetStreamClient;
  readonly manager: JetStreamManager;
}
export const NatsBroker = Context.Service<NatsBroker>('wallpaperdb/variant-generator/NatsBroker');
export function broker<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new GenerationUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Variant generation broker operation failed', {
        operation,
        cause: error.cause,
      })
    )
  );
}
class NatsVariantEvents implements VariantEvents {
  constructor(
    private readonly client: JetStreamClient,
    private readonly stream: string,
    private readonly permits: Semaphore.Semaphore
  ) {}
  readonly publish = Effect.fn('variants.events.publish')(function* (
    this: NatsVariantEvents,
    result: Parameters<VariantEvents['publish']>[0]
  ) {
    const { input, variant } = result;
    const source = 'https://wallpaperdb/variant-generator';
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          'variant-uploaded-v1',
          input.occurrence.source,
          input.occurrence.id,
          variant.width,
          variant.height,
          variant.format,
          variant.storageKey,
        ])
      )
      .digest('hex');
    const event = {
      eventId: id,
      eventType: 'wallpaper.variant.uploaded',
      timestamp: input.timestamp,
      variant: {
        wallpaperId: variant.wallpaperId,
        width: variant.width,
        height: variant.height,
        aspectRatio: variant.aspectRatio,
        format: variant.format,
        fileSizeBytes: variant.fileSizeBytes,
        asset: variantAssetReference(variant),
        createdAt: variant.createdAt.toISOString(),
      },
    };
    const carrier: Record<string, string> = {};
    const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.option);
    propagation.inject(
      Option.isSome(span) ? trace.setSpan(context.active(), span.value) : context.active(),
      carrier
    );
    const metadata = headers();
    for (const [key, value] of Object.entries(carrier)) metadata.set(key, value);
    metadata.set('content-type', 'application/json');
    metadata.set('ce-specversion', '1.0');
    metadata.set('ce-source', source);
    metadata.set('ce-id', id);
    metadata.set('ce-type', 'wallpaper.variant.uploaded');
    metadata.set('ce-time', input.timestamp);
    metadata.set('ce-causationid', input.occurrence.id);
    metadata.set('ce-causationsource', input.occurrence.source);
    if (input.correlationId) metadata.set('ce-correlationid', input.correlationId);
    const started = yield* Clock.currentTimeMillis;
    yield* this.permits.withPermits(1)(
      broker('publish-variant', () =>
        this.client.publish('wallpaper.variant.uploaded', JSON.stringify(event), {
          headers: metadata,
          msgID: JSON.stringify([source, id]),
          expect: { streamName: this.stream },
          timeout: 5000,
        })
      ).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const duration = (yield* Clock.currentTimeMillis) - started;
            const attributes = { 'event.type': 'wallpaper.variant.uploaded' };
            yield* Metric.update(
              Metric.counter('events.published.total', {
                incremental: true,
                attributes: { ...attributes, status: Exit.isSuccess(exit) ? 'success' : 'error' },
              }),
              1
            );
            yield* Metric.update(
              Metric.histogram('events.publish_duration_ms', {
                boundaries: [1, 10, 100, 1000, 5000],
                attributes,
              }),
              duration
            );
          })
        ),
        Effect.uninterruptible
      )
    );
  });
}
export function natsEventsLayer(
  options: NatsEventsOptions
): Layer.Layer<VariantEvents | EventsHealth | NatsBroker, GenerationUnavailable> {
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
      return Context.make(
        VariantEvents,
        new NatsVariantEvents(client, options.stream, permits)
      ).pipe(
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
