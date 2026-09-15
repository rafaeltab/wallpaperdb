import {
  ProfileUpdatedEventSchema,
  PublicProfileSnapshotSchema,
  WallpaperColorsExtractedEventSchema,
  WallpaperUploadedEventSchema,
  WallpaperVariantAvailableEventSchema,
} from '@wallpaperdb/events';
import { z } from 'zod';
import type { Occurrence, ProjectionChange } from '../../projection/index.js';

const created = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('profile.created'),
  timestamp: z.string().datetime(),
  profile: PublicProfileSnapshotSchema.strip(),
});
const legacy = z.discriminatedUnion('eventType', [
  WallpaperUploadedEventSchema,
  WallpaperVariantAvailableEventSchema,
  WallpaperColorsExtractedEventSchema,
  created,
  ProfileUpdatedEventSchema,
]);
const cloud = z.object({
  specversion: z.literal('1.0'),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z.string().min(1),
  time: z.string().datetime(),
  data: z.record(z.unknown()),
  correlationid: z.string().optional(),
  causationid: z.string().optional(),
});

export type TranslatedEvent =
  | {
      readonly _tag: 'Translated';
      readonly change: ProjectionChange;
      readonly correlationId?: string;
      readonly causationId?: string;
    }
  | { readonly _tag: 'Invalid' };

export function translate(subject: string, payload: Uint8Array): TranslatedEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return { _tag: 'Invalid' };
  }
  const envelope = cloud.safeParse(raw);
  if (typeof raw === 'object' && raw !== null && 'specversion' in raw && !envelope.success)
    return { _tag: 'Invalid' };
  const event = legacy.safeParse(
    envelope.success
      ? {
          ...envelope.data.data,
          eventId: envelope.data.id,
          eventType: envelope.data.type,
          timestamp: envelope.data.time,
        }
      : raw
  );
  if (!event.success || event.data.eventType !== subject) return { _tag: 'Invalid' };
  const occurrence: Occurrence = {
    source: envelope.success ? envelope.data.source : legacySource(event.data.eventType),
    id: event.data.eventId,
    occurredAt: new Date(event.data.timestamp).toISOString(),
  };
  return {
    _tag: 'Translated',
    change: toChange(event.data, occurrence),
    ...(envelope.success && envelope.data.correlationid
      ? { correlationId: envelope.data.correlationid }
      : {}),
    ...(envelope.success && envelope.data.causationid
      ? { causationId: envelope.data.causationid }
      : {}),
  };
}

function legacySource(eventType: z.infer<typeof legacy>['eventType']): string {
  switch (eventType) {
    case 'wallpaper.uploaded':
      return 'wallpaperdb/ingestor';
    case 'wallpaper.variant.available':
      return 'wallpaperdb/media';
    case 'wallpaper.colors.extracted':
      return 'wallpaperdb/color-extractor';
    case 'profile.created':
    case 'profile.updated':
      return 'wallpaperdb/profile';
  }
}

function toChange(event: z.infer<typeof legacy>, occurrence: Occurrence): ProjectionChange {
  switch (event.eventType) {
    case 'wallpaper.uploaded':
      return {
        _tag: 'WallpaperUploaded',
        occurrence,
        wallpaperId: event.wallpaper.id,
        profileId: event.wallpaper.userId,
        uploadedAt: new Date(event.wallpaper.uploadedAt).toISOString(),
      };
    case 'wallpaper.variant.available': {
      const { wallpaperId, ...variant } = event.variant;
      return {
        _tag: 'VariantAvailable',
        occurrence,
        wallpaperId,
        variant: { ...variant, createdAt: new Date(variant.createdAt).toISOString() },
      };
    }
    case 'wallpaper.colors.extracted':
      return {
        _tag: 'ColorsExtracted',
        occurrence,
        wallpaperId: event.wallpaperId,
        colorHistogram: event.colorHistogram,
        colorSpace: event.colorSpace,
      };
    case 'profile.created':
    case 'profile.updated':
      return { _tag: 'ProfilePublished', occurrence, profile: { ...event.profile } };
  }
}
