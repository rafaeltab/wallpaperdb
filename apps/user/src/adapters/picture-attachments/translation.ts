import { AssetCommandResultSchema, AssetSourceAcceptedSchema } from '@wallpaperdb/events/schemas';
import { z } from 'zod';
import type {
  AttachmentResult,
  SourceConfirmation,
} from '../../capabilities/picture-attachments/index.js';
const identity = z.string().min(1).max(256);
const envelope = z
  .object({
    specversion: z.literal('1.0'),
    id: identity,
    source: z.literal('https://wallpaperdb/asset'),
    type: z.enum(['asset.command.result', 'asset.source.accepted']),
    time: z.string().datetime(),
    datacontenttype: z.literal('application/json'),
    causationsource: z.string().url(),
    causationid: identity,
    correlationid: identity.optional(),
    traceparent: z.string().max(128).optional(),
    tracestate: z.string().max(512).optional(),
    data: z.unknown(),
  })
  .strict();
export type ConfirmationContext = Omit<z.infer<typeof envelope>, 'data'>;
export type Confirmation =
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'result';
      readonly result: AttachmentResult;
      readonly context: ConfirmationContext;
    }
  | {
      readonly kind: 'source';
      readonly confirmation: SourceConfirmation;
      readonly context: ConfirmationContext;
    };
export function decodeConfirmation(bytes: Uint8Array): Confirmation {
  if (bytes.byteLength > 16384) return { kind: 'invalid' };
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = envelope.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const event = parsed.data;
  const { data: _data, ...context } = event;
  if (event.type === 'asset.command.result') {
    if (event.causationsource !== 'https://wallpaperdb/user') return { kind: 'invalid' };
    const data = AssetCommandResultSchema.safeParse(event.data);
    if (!data.success) return { kind: 'invalid' };
    return {
      kind: 'result',
      context,
      result: {
        attachmentId: data.data.applicationReference,
        commandId: data.data.commandId,
        causationId: event.causationid,
        outcome: data.data.outcome,
        assetId: data.data.assetId,
      },
    };
  }
  const data = AssetSourceAcceptedSchema.safeParse(event.data);
  if (
    !data.success ||
    data.data.assetType !== 'picture' ||
    !event.correlationid ||
    event.causationsource !== 'https://wallpaperdb/asset/authors'
  )
    return { kind: 'invalid' };
  return {
    kind: 'source',
    context,
    confirmation: {
      assetId: data.data.assetId,
      candidateId: data.data.candidateId,
      sourceId: data.data.sourceId,
      defaultSourceId: data.data.defaultSourceId,
      initialAnalysisSourceId: data.data.initialAnalysisSourceId,
      intentId: event.correlationid,
      occurrenceId: event.id,
      ...(event.traceparent
        ? {
            trace: {
              traceparent: event.traceparent,
              ...(event.tracestate ? { tracestate: event.tracestate } : {}),
            },
          }
        : {}),
    },
  };
}
