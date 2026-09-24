import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { ExtractionInput } from '../../extraction/index.js';
const decode = Option.liftThrowable((payload: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
);
export function translateUpload(payload: Uint8Array): ExtractionInput | undefined {
  const raw = decode(payload);
  if (Option.isNone(raw)) return undefined;
  if (Predicate.hasProperty(raw.value, 'specversion')) {
    const result = WallpaperUploadedCloudEventSchema.safeParse(raw.value);
    if (!result.success) return undefined;
    const event = result.data;
    return {
      wallpaperId: event.data.wallpaper.id,
      fileType: event.data.wallpaper.fileType,
      storage: { bucket: event.data.wallpaper.storageBucket, key: event.data.wallpaper.storageKey },
      occurrence: { source: event.source, id: event.id },
      timestamp: event.time,
      ...(event.correlationid ? { correlationId: event.correlationid } : {}),
    };
  }
  const result = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!result.success) return undefined;
  const event = result.data;
  return {
    wallpaperId: event.wallpaper.id,
    fileType: event.wallpaper.fileType,
    storage: { bucket: event.wallpaper.storageBucket, key: event.wallpaper.storageKey },
    occurrence: { source: 'wallpaperdb/ingestor', id: event.eventId },
    timestamp: event.timestamp,
  };
}
