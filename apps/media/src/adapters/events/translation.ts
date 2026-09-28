import { reconcileEventMetadata } from '@wallpaperdb/events/envelope';
import {
  WallpaperUploadedEventSchema,
  WallpaperUploadedCloudEventSchema,
  WallpaperVariantUploadedEventSchema,
  ProfileCreatedEventSchema,
  ProfileUpdatedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { MsgHdrs } from 'nats';
import { z } from 'zod';
import type { ProjectionInput, ProjectionMetadata } from '../../capabilities/catalog/index.js';
const decode = Option.liftThrowable((data: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
);
const binaryEnvelope = z.object({
  specversion: z.literal('1.0'),
  source: z.string().url(),
  id: z.string().min(1),
  type: z.string().min(1),
  time: z.string().datetime(),
  correlationid: z.string().min(1).optional(),
  causationid: z.string().min(1).optional(),
  causationsource: z.string().min(1).optional(),
});
function metadata(
  raw: unknown,
  header: MsgHdrs | undefined,
  subject: string,
  legacy: { eventId: string; timestamp: string },
  source: string
): ProjectionMetadata | undefined {
  const result = reconcileEventMetadata(
    raw,
    header,
    { ...legacy, eventType: subject },
    (value) => binaryEnvelope.safeParse(value).data
  );
  if (!result.valid) return undefined;
  const envelope = result.value;
  const extensions = envelope;
  return {
    occurrence: envelope
      ? { source: envelope.source, id: envelope.id }
      : { source, id: legacy.eventId },
    occurredAt: envelope ? envelope.time : legacy.timestamp,
    ...(extensions?.correlationid ? { correlationId: extensions.correlationid } : {}),
    ...(extensions?.causationid ? { causationId: extensions.causationid } : {}),
    ...(extensions?.causationsource ? { causationSource: extensions.causationsource } : {}),
    ...(header?.get('traceparent') ? { traceparent: header.get('traceparent') } : {}),
    ...(header?.get('tracestate') ? { tracestate: header.get('tracestate') } : {}),
  };
}
export function translateEvent(
  subject: string,
  data: Uint8Array,
  header?: MsgHdrs
): ProjectionInput | undefined {
  const raw = decode(data);
  if (Option.isNone(raw)) return undefined;
  if (subject === 'wallpaper.uploaded') {
    const parsed = WallpaperUploadedEventSchema.safeParse(raw.value);
    if (!parsed.success) return undefined;
    // Structured envelopes are checked independently so their source survives the legacy-compatible schema.
    if (
      Predicate.hasProperty(raw.value, 'specversion') &&
      !WallpaperUploadedCloudEventSchema.safeParse(raw.value).success
    )
      return undefined;
    const event = parsed.data;
    const meta = metadata(raw.value, header, subject, event, 'wallpaperdb/ingestor');
    if (!meta) return undefined;
    const w = event.wallpaper;
    return {
      ...meta,
      kind: 'wallpaper',
      wallpaper: {
        id: w.id,
        ...(w.asset
          ? { reference: { ...w.asset } }
          : { storageBucket: w.storageBucket, storageKey: w.storageKey }),
        mimeType: w.mimeType,
        width: w.width,
        height: w.height,
        fileSizeBytes: w.fileSizeBytes,
        createdAt: w.uploadedAt,
      },
    };
  }
  if (subject === 'wallpaper.variant.uploaded') {
    const parsed = WallpaperVariantUploadedEventSchema.safeParse(raw.value);
    if (!parsed.success) return undefined;
    const event = parsed.data;
    const meta = metadata(raw.value, header, subject, event, 'wallpaperdb/variant-generator');
    if (!meta) return undefined;
    const v = event.variant;
    return {
      ...meta,
      kind: 'variant',
      variant: {
        wallpaperId: v.wallpaperId,
        ...(v.asset
          ? { reference: { ...v.asset } }
          : { storageBucket: v.storageBucket, storageKey: v.storageKey }),
        mimeType: v.format,
        width: v.width,
        height: v.height,
        fileSizeBytes: v.fileSizeBytes,
        createdAt: v.createdAt,
      },
    };
  }
  if (subject === 'profile.created' || subject === 'profile.updated') {
    const parsed = z
      .union([ProfileCreatedEventSchema, ProfileUpdatedEventSchema])
      .safeParse(raw.value);
    if (!parsed.success || parsed.data.eventType !== subject) return undefined;
    const event = parsed.data;
    const meta = metadata(raw.value, header, subject, event, 'wallpaperdb/user');
    if (!meta) return undefined;
    return {
      ...meta,
      kind: 'profile',
      profile: {
        id: event.profile.id,
        version: event.profile.version,
        pictureId: event.profile.pictureAssetId,
        updatedAt: event.profile.updatedAt,
      },
      ...(event.change.type === 'picture-changed' && event.change.asset
        ? { asset: { ...event.change.asset, createdAt: event.timestamp } }
        : {}),
    };
  }
  return undefined;
}
