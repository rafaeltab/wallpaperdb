import { reconcileEventMetadata } from '@wallpaperdb/events/envelope';
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
