import { AssetCommandResultSchema, AssetSourceAcceptedSchema } from '@wallpaperdb/events/schemas';
import { z } from 'zod';
import type { AssetResult, SourceAcceptance } from '../../capabilities/creation/index.js';
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
export type Confirmation =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'created'; readonly result: AssetResult }
  | { readonly kind: 'source'; readonly confirmation: SourceAcceptance };
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
  if (event.type === 'asset.command.result') {
    if (event.causationsource !== 'https://wallpaperdb/wallpaper') return { kind: 'invalid' };
    const data = AssetCommandResultSchema.safeParse(event.data);
    if (!data.success || (data.data.outcome !== 'created' && data.data.outcome !== 'rejected'))
      return { kind: 'invalid' };
    return {
      kind: 'created',
      result: {
        wallpaperId: data.data.applicationReference,
        commandId: data.data.commandId,
        creationEventId: event.causationid,
        outcome: data.data.outcome,
        assetId: data.data.assetId,
      },
    };
  }
  const data = AssetSourceAcceptedSchema.safeParse(event.data);
  if (
    !data.success ||
    data.data.assetType !== 'wallpaper' ||
    !event.correlationid ||
    event.causationsource !== 'https://wallpaperdb/asset/authors'
  )
    return { kind: 'invalid' };
  return {
    kind: 'source',
    confirmation: {
      assetId: data.data.assetId,
      candidateId: data.data.candidateId,
      sourceId: data.data.sourceId,
      defaultSourceId: data.data.defaultSourceId,
      initialAnalysisSourceId: data.data.initialAnalysisSourceId,
      intentId: event.correlationid,
      occurrenceId: event.id,
    },
  };
}
