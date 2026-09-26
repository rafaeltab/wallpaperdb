import { reconcileEventMetadata } from '@wallpaperdb/events/envelope';
import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { MsgHdrs } from 'nats';
import { z } from 'zod';
import type { ExtractionInput } from '../../extraction/index.js';
const decode = Option.liftThrowable((payload: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
);
const structuredSchema = WallpaperUploadedCloudEventSchema.extend({
  causationsource: z.string().min(1).optional(),
});
const envelopeSchema = structuredSchema.omit({
  data: true,
  datacontenttype: true,
});
export function translateUpload(
  payload: Uint8Array,
  headers?: MsgHdrs
): ExtractionInput | undefined {
  const raw = decode(payload);
  if (Option.isNone(raw)) return undefined;
  if (
    Predicate.hasProperty(raw.value, 'specversion') &&
    !structuredSchema.safeParse(raw.value).success
  )
    return undefined;
  const result = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!result.success) return undefined;
  const event = result.data;
  const metadata = reconcileEventMetadata(
    raw.value,
    headers,
    event,
    (value) => envelopeSchema.safeParse(value).data
  );
  if (!metadata.valid) return undefined;
  const envelope = metadata.value;
  return {
    wallpaperId: event.wallpaper.id,
    fileType: event.wallpaper.fileType,
    storage:
      'storageBucket' in event.wallpaper
        ? { bucket: event.wallpaper.storageBucket, key: event.wallpaper.storageKey }
        : { ...event.wallpaper.asset, mimeType: event.wallpaper.mimeType },
    occurrence: { source: envelope?.source ?? 'wallpaperdb/ingestor', id: event.eventId },
    timestamp: event.timestamp,
    ...(envelope?.correlationid ? { correlationId: envelope.correlationid } : {}),
    ...(envelope?.causationid ? { causationId: envelope.causationid } : {}),
  };
}
