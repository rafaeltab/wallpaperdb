import { createHash } from 'node:crypto';
import { context, propagation } from '@opentelemetry/api';
import { recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { Effect } from 'effect';
import {
  AckPolicy,
  connect,
  DiscardPolicy,
  headers,
  StorageType,
  type ConsumerMessages,
  type JetStreamClient,
  type JsMsg,
  type NatsConnection,
} from 'nats';
import { z } from 'zod';
import type { ProjectCatalogue, ProjectionOutcome } from '../../projection/index.js';
import { translate } from './translation.js';
import { runGatewayEffect } from '../../runtime.js';

export interface ProjectionDelivery {
  readonly subject: string;
  readonly payload: Uint8Array;
  readonly attempt: number;
}
export type DeliveryDecision =
  | ProjectionOutcome
  | { readonly _tag: 'Invalid' }
  | { readonly _tag: 'Exhausted' };

/** Parses and translates the broker contract before calling the application port.
 * The broker owner must durably quarantine Invalid, Rejected and Exhausted outcomes. */
export function deliverProjection(
  delivery: ProjectionDelivery,
  project: ProjectCatalogue
): Effect.Effect<DeliveryDecision> {
  const translated = translate(delivery.subject, delivery.payload);
  if (translated._tag === 'Invalid') return Effect.succeed({ _tag: 'Invalid' });
  if (delivery.attempt > 4) return Effect.succeed({ _tag: 'Exhausted' });
  return project.record(translated.change).pipe(
    Effect.map(
      (outcome): DeliveryDecision =>
        outcome._tag === 'Retry' && delivery.attempt >= 4 ? { _tag: 'Exhausted' } : outcome
    ),
    Effect.withSpan('catalogue.delivery', {
      attributes: {
        'event.source': translated.change.occurrence.source,
        'event.id': translated.change.occurrence.id,
        'event.correlation_id': translated.correlationId ?? '',
        'event.causation_id': translated.causationId ?? '',
        'event.delivery_attempt': delivery.attempt,
        'catalogue.subject_id':
          translated.change._tag === 'ProfilePublished'
            ? translated.change.profile.id
            : translated.change.wallpaperId,
      },
    })
  );
}

export interface NatsProjectionOptions {
  readonly url: string;
  readonly wallpaperStream?: string;
  readonly serviceName?: string;
  readonly quarantineStream?: string;
  readonly quarantineSubject?: string;
  readonly retryDelayMs?: number;
}
export interface NatsProjectionConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
  check(): Promise<boolean>;
}

const subscriptions = [
  { stream: 'WALLPAPER', subject: 'wallpaper.uploaded', durable: 'gateway-wallpaper-uploaded' },
  {
    stream: 'WALLPAPER',
    subject: 'wallpaper.variant.available',
    durable: 'gateway-wallpaper-variant-available',
  },
  {
    stream: 'WALLPAPER',
    subject: 'wallpaper.colors.extracted',
    durable: 'gateway-wallpaper-colors-extracted',
  },
  { stream: 'PROFILE', subject: 'profile.created', durable: 'gateway-profile-created' },
  { stream: 'PROFILE', subject: 'profile.updated', durable: 'gateway-profile-updated' },
];
const notFound = z.object({ code: z.literal('404') });

class BrokerProjection implements NatsProjectionConsumer {
  private connection: NatsConnection | undefined;
  private readonly messages: ConsumerMessages[] = [];
  private readonly processing: Promise<void>[] = [];
  private running = false;
  private healthy = false;

  constructor(
    private readonly options: NatsProjectionOptions,
    private readonly project: ProjectCatalogue
  ) {}

  async start(): Promise<void> {
    if (this.running) throw new Error('Projection consumer already started');
    this.connection = await connect({
      servers: this.options.url,
      name: this.options.serviceName ?? 'gateway',
      timeout: 5000,
    });
    try {
      const manager = await this.connection.jetstreamManager({ timeout: 5000 });
      const quarantineStream = this.options.quarantineStream ?? 'GATEWAY_QUARANTINE';
      try {
        await manager.streams.info(quarantineStream);
      } catch (error) {
        if (!notFound.safeParse(error).success) throw error;
        await manager.streams.add({
          name: quarantineStream,
          subjects: [this.options.quarantineSubject ?? 'gateway.quarantine'],
          storage: StorageType.File,
          discard: DiscardPolicy.New,
        });
      }
      const js = this.connection.jetstream({ timeout: 5000 });
      this.running = true;
      for (const subscription of subscriptions) {
        const stream =
          subscription.stream === 'WALLPAPER'
            ? (this.options.wallpaperStream ?? 'WALLPAPER')
            : subscription.stream;
        const config = {
          durable_name: subscription.durable,
          ack_policy: AckPolicy.Explicit,
          ack_wait: 30_000_000_000,
          max_deliver: -1,
          filter_subject: subscription.subject,
          max_ack_pending: 1,
        };
        try {
          await manager.consumers.info(stream, subscription.durable);
          await manager.consumers.update(stream, subscription.durable, config);
        } catch (error) {
          if (!notFound.safeParse(error).success) throw error;
          await manager.consumers.add(stream, config);
        }
        const consumer = await js.consumers.get(stream, subscription.durable);
        const messages = await consumer.consume({ max_messages: 1 });
        this.messages.push(messages);
        this.processing.push(this.consume(messages, js));
      }
      this.healthy = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.healthy = false;
    for (const messages of this.messages) messages.stop();
    await Promise.all(this.processing);
    this.messages.length = 0;
    this.processing.length = 0;
    await this.connection?.drain();
    this.connection = undefined;
  }

  async check(): Promise<boolean> {
    return this.healthy && this.connection !== undefined && !this.connection.isClosed();
  }

  private async consume(messages: ConsumerMessages, js: JetStreamClient): Promise<void> {
    try {
      for await (const message of messages) {
        if (!this.running) break;
        await this.process(message, js);
      }
    } catch {
      this.healthy = false;
    }
  }

  private async process(message: JsMsg, js: JetStreamClient): Promise<void> {
    const carrier: Record<string, string> = {};
    for (const key of message.headers?.keys() ?? []) carrier[key] = message.headers?.get(key) ?? '';
    const parent = propagation.extract(context.active(), carrier);
    const attempt = message.info.deliveryCount;
    const translated = translate(message.subject, message.data);
    await context.with(parent, () =>
      withSpan(
        'catalogue.events.consume',
        {
          'event.subject': message.subject,
          'event.consumer': message.info.consumer,
          'event.delivery_attempt': attempt,
          ...(translated._tag === 'Translated'
            ? {
                'event.source': translated.change.occurrence.source,
                'event.id': translated.change.occurrence.id,
                'event.correlation_id': translated.correlationId ?? '',
                'event.causation_id': translated.causationId ?? '',
                'catalogue.subject_id':
                  translated.change._tag === 'ProfilePublished'
                    ? translated.change.profile.id
                    : translated.change.wallpaperId,
              }
            : {}),
        },
        async (span) => {
          const started = performance.now();
          let status = 'error';
          try {
            const outcome = await runGatewayEffect(
              deliverProjection(
                { subject: message.subject, payload: message.data, attempt },
                this.project
              )
            );
            span.setAttribute('event.outcome', outcome._tag);
            switch (outcome._tag) {
              case 'Completed':
              case 'Ignored':
                status = 'success';
                message.ack();
                return;
              case 'Retry':
                message.nak(this.retryDelay(attempt));
                return;
              case 'Invalid':
              case 'Rejected':
              case 'Exhausted':
                await this.quarantine(js, message, outcome._tag);
                message.ack();
                return;
            }
          } catch {
            // A defect or unavailable quarantine never acknowledges uncompleted work.
            span.setAttribute('event.outcome', 'Retry');
            message.nak(this.retryDelay(attempt));
          } finally {
            const duration = performance.now() - started;
            span.setAttribute('event.duration_ms', duration);
            recordTelemetry(() => {
              recordCounter('events.consumed.total', 1, { 'event.type': message.subject, status });
              recordHistogram('events.consume_duration_ms', duration, {
                'event.type': message.subject,
              });
            });
          }
        }
      )
    );
  }

  private retryDelay(attempt: number): number {
    return Math.min(30_000, (this.options.retryDelayMs ?? 1000) * 2 ** Math.min(attempt - 1, 5));
  }

  private async quarantine(js: JetStreamClient, message: JsMsg, outcome: string): Promise<void> {
    const identity = createHash('sha256')
      .update(`${message.info.stream}/${message.seq}/${message.info.consumer}`)
      .digest('hex');
    const original = translate(message.subject, message.data);
    const traceCarrier: Record<string, string> = {};
    propagation.inject(context.active(), traceCarrier);
    const traceHeaders = headers();
    for (const [key, value] of Object.entries(traceCarrier)) traceHeaders.set(key, value);
    await js.publish(
      this.options.quarantineSubject ?? 'gateway.quarantine',
      JSON.stringify({
        specversion: '1.0',
        source: 'wallpaperdb/gateway/projection',
        id: identity,
        type: 'gateway.projection.quarantined',
        time: new Date(message.info.timestampNanos / 1_000_000).toISOString(),
        ...(original._tag === 'Translated'
          ? {
              causationid: original.change.occurrence.id,
              causationsource: original.change.occurrence.source,
              ...(original.correlationId ? { correlationid: original.correlationId } : {}),
            }
          : {}),
        data: {
          subject: message.subject,
          original: Buffer.from(message.data).toString('base64'),
          consumer: message.info.consumer,
          outcome,
        },
      }),
      { msgID: identity, headers: traceHeaders }
    );
  }
}

function recordTelemetry(record: () => void): void {
  try {
    record();
  } catch {
    /* Observability cannot stop a subscription or alter acknowledgement. */
  }
}

export function createNatsProjectionConsumer(
  options: NatsProjectionOptions,
  project: ProjectCatalogue
): NatsProjectionConsumer {
  return new BrokerProjection(options, project);
}
