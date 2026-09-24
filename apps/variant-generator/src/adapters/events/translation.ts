import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { GenerationInput } from '../../generation/index.js';
const decode = Option.liftThrowable((payload: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
);
export function translateUpload(payload: Uint8Array): GenerationInput | undefined {
  const raw = decode(payload);
  if (Option.isNone(raw)) return undefined;
  if (Predicate.hasProperty(raw.value, 'specversion')) {
    const result = WallpaperUploadedCloudEventSchema.safeParse(raw.value);
    if (!result.success) return undefined;
    const event = result.data;
    return {
      wallpaperId: event.data.wallpaper.id,
      fileType: event.data.wallpaper.fileType,
      mimeType: event.data.wallpaper.mimeType,
      width: event.data.wallpaper.width,
      height: event.data.wallpaper.height,
      storage: { bucket: event.data.wallpaper.storageBucket, key: event.data.wallpaper.storageKey },
      occurrence: { source: event.source, id: event.id },
      timestamp: event.time,
      ...(event.correlationid ? { correlationId: event.correlationid } : {}),
      ...(event.causationid ? { causationId: event.causationid } : {}),
    };
  }
  const result = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!result.success) return undefined;
  const event = result.data;
  return {
    wallpaperId: event.wallpaper.id,
    fileType: event.wallpaper.fileType,
    mimeType: event.wallpaper.mimeType,
    width: event.wallpaper.width,
    height: event.wallpaper.height,
    storage: { bucket: event.wallpaper.storageBucket, key: event.wallpaper.storageKey },
    occurrence: { source: 'wallpaperdb/ingestor', id: event.eventId },
    timestamp: event.timestamp,
  };
}
