import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { MsgHdrs } from 'nats';
import { z } from 'zod';

const decode = Option.liftThrowable((bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
);
const envelope = z.object({
  specversion: z.literal('1.0'),
  source: z.string().url(),
  id: z.string().min(1),
  type: z.literal('wallpaper.uploaded'),
  time: z.string().datetime(),
  correlationid: z.string().min(1).optional(),
  causationid: z.string().min(1).optional(),
  causationsource: z.string().min(1).optional(),
});
const structuredEnvelope = WallpaperUploadedCloudEventSchema.extend({
  causationsource: envelope.shape.causationsource,
});
type Envelope = z.infer<typeof envelope>;
type EventIdentity = { readonly eventId: string; readonly timestamp: string };
type MetadataResult =
  | { readonly valid: false }
  | { readonly valid: true; readonly value: Envelope | undefined };

/** Binary CloudEvents carry their structural envelope in headers instead of JSON. */
function binaryEnvelope(headers: MsgHdrs | undefined) {
  if (!headers?.keys().some((key) => key.toLowerCase().startsWith('ce-'))) return undefined;
  return envelope.safeParse({
    specversion: headers.get('ce-specversion'),
    source: headers.get('ce-source'),
    id: headers.get('ce-id'),
    type: headers.get('ce-type'),
    time: headers.get('ce-time'),
    correlationid: headers.get('ce-correlationid') || undefined,
    causationid: headers.get('ce-causationid') || undefined,
    causationsource: headers.get('ce-causationsource') || undefined,
  });
}

/** Multiple representations must identify the same occurrence before metadata is trusted. */
function eventMetadata(
  raw: unknown,
  headers: MsgHdrs | undefined,
  event: EventIdentity
): MetadataResult {
  const structured = Predicate.hasProperty(raw, 'specversion')
    ? structuredEnvelope.safeParse(raw)
    : undefined;
  const binary = binaryEnvelope(headers);
  for (const parsed of [structured, binary]) {
    if (
      parsed &&
      (!parsed.success || parsed.data.id !== event.eventId || parsed.data.time !== event.timestamp)
    )
      return { valid: false };
  }
  if (
    structured?.success &&
    binary?.success &&
    (structured.data.source !== binary.data.source ||
      structured.data.correlationid !== binary.data.correlationid ||
      structured.data.causationid !== binary.data.causationid ||
      structured.data.causationsource !== binary.data.causationsource)
  )
    return { valid: false };
  if (structured?.success) return { valid: true, value: structured.data };
  if (binary?.success) return { valid: true, value: binary.data };
  return { valid: true, value: undefined };
}

function ownershipAttributes(eventId: string, wallpaperId: string, metadata: Envelope | undefined) {
  return {
    'event.id': eventId,
    'event.source': metadata?.source ?? 'wallpaperdb/ingestor',
    'wallpaper.id': wallpaperId,
    ...(metadata?.correlationid ? { 'event.correlation_id': metadata.correlationid } : {}),
    ...(metadata?.causationid ? { 'event.causation_id': metadata.causationid } : {}),
  };
}

export function translateOwnership(subject: string, bytes: Uint8Array, headers?: MsgHdrs) {
  if (subject !== 'wallpaper.uploaded')
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const raw = decode(bytes);
  if (Option.isNone(raw)) return { kind: 'invalid', reason: 'parse_error' } as const;
  const parsed = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!parsed.success) return { kind: 'invalid', reason: 'validation_error' } as const;
  const external = parsed.data;
  const metadata = eventMetadata(raw.value, headers, external);
  if (!metadata.valid) return { kind: 'invalid', reason: 'validation_error' } as const;
  return {
    kind: 'ownership' as const,
    ownership: { wallpaperId: external.wallpaper.id, profileId: external.wallpaper.userId },
    attributes: ownershipAttributes(external.eventId, external.wallpaper.id, metadata.value),
  };
}
