import { reconcileEventMetadata, type CloudEventMetadata } from '@wallpaperdb/events/envelope';
import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
  WallpaperPublishedSchema,
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
const publicationEnvelope = envelope.extend({
  type: z.literal('wallpaper.published'),
});
const structuredPublication = publicationEnvelope.extend({
  datacontenttype: z.literal('application/json'),
  data: WallpaperPublishedSchema,
});
function ownershipAttributes(
  eventId: string,
  wallpaperId: string,
  metadata: CloudEventMetadata | undefined
) {
  return {
    'event.id': eventId,
    'event.source': metadata?.source ?? 'wallpaperdb/ingestor',
    'wallpaper.id': wallpaperId,
    ...(metadata?.correlationid ? { 'event.correlation_id': metadata.correlationid } : {}),
    ...(metadata?.causationid ? { 'event.causation_id': metadata.causationid } : {}),
  };
}

export function translateOwnership(subject: string, bytes: Uint8Array, headers?: MsgHdrs) {
  if (subject === 'wallpaper.published') return translatePublication(bytes, headers);
  if (subject !== 'wallpaper.uploaded')
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const raw = decode(bytes);
  if (Option.isNone(raw)) return { kind: 'invalid', reason: 'parse_error' } as const;
  const parsed = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!parsed.success) return { kind: 'invalid', reason: 'validation_error' } as const;
  const external = parsed.data;
  if (
    Predicate.hasProperty(raw.value, 'specversion') &&
    !structuredEnvelope.safeParse(raw.value).success
  )
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const metadata = reconcileEventMetadata(
    raw.value,
    headers,
    external,
    (value) => envelope.safeParse(value).data
  );
  if (!metadata.valid) return { kind: 'invalid', reason: 'validation_error' } as const;
  return {
    kind: 'ownership' as const,
    ownership: { wallpaperId: external.wallpaper.id, profileId: external.wallpaper.userId },
    attributes: ownershipAttributes(external.eventId, external.wallpaper.id, metadata.value),
  };
}

function translatePublication(bytes: Uint8Array, headers?: MsgHdrs) {
  const raw = decode(bytes);
  if (Option.isNone(raw)) return { kind: 'invalid', reason: 'parse_error' } as const;
  const parsed = structuredPublication.safeParse(raw.value);
  if (!parsed.success) return { kind: 'invalid', reason: 'validation_error' } as const;
  const external = parsed.data;
  const metadata = reconcileEventMetadata(
    raw.value,
    headers,
    { eventId: external.id, eventType: external.type, timestamp: external.time },
    (value) => publicationEnvelope.safeParse(value).data
  );
  if (!metadata.valid) return { kind: 'invalid', reason: 'validation_error' } as const;
  return {
    kind: 'ownership' as const,
    ownership: { wallpaperId: external.data.wallpaperId, profileId: external.data.contributorId },
    attributes: ownershipAttributes(external.id, external.data.wallpaperId, metadata.value),
  };
}
