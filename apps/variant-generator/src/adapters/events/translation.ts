import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { MsgHdrs } from 'nats';
import type { GenerationInput } from '../../generation/index.js';
const decode = Option.liftThrowable((payload: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
);
const envelopeSchema = WallpaperUploadedCloudEventSchema.omit({
  data: true,
  datacontenttype: true,
});
export function translateUpload(
  payload: Uint8Array,
  headers?: MsgHdrs
): GenerationInput | undefined {
  const raw = decode(payload);
  if (Option.isNone(raw)) return undefined;
  const structured = Predicate.hasProperty(raw.value, 'specversion')
    ? WallpaperUploadedCloudEventSchema.safeParse(raw.value)
    : undefined;
  const binary = headers?.keys().some((key) => key.toLowerCase().startsWith('ce-'))
    ? envelopeSchema.safeParse({
        specversion: headers.get('ce-specversion'),
        source: headers.get('ce-source'),
        id: headers.get('ce-id'),
        type: headers.get('ce-type'),
        time: headers.get('ce-time'),
        correlationid: headers.get('ce-correlationid') || undefined,
        causationid: headers.get('ce-causationid') || undefined,
      })
    : undefined;
  const result = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!result.success) return undefined;
  const event = result.data;
  for (const envelope of [structured, binary]) {
    if (
      envelope &&
      (!envelope.success ||
        envelope.data.id !== event.eventId ||
        envelope.data.time !== event.timestamp)
    )
      return undefined;
  }
  if (structured?.success && binary?.success && structured.data.source !== binary.data.source)
    return undefined;
  const envelope = structured?.success
    ? structured.data
    : binary?.success
      ? binary.data
      : undefined;
  return {
    wallpaperId: event.wallpaper.id,
    fileType: event.wallpaper.fileType,
    mimeType: event.wallpaper.mimeType,
    width: event.wallpaper.width,
    height: event.wallpaper.height,
    storage: { bucket: event.wallpaper.storageBucket, key: event.wallpaper.storageKey },
    occurrence: { source: envelope?.source ?? 'wallpaperdb/ingestor', id: event.eventId },
    timestamp: event.timestamp,
    ...(envelope?.correlationid ? { correlationId: envelope.correlationid } : {}),
    ...(envelope?.causationid ? { causationId: envelope.causationid } : {}),
  };
}
