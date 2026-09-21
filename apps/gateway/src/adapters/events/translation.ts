import {
  BaseEventSchema,
  ProfileUpdatedEventSchema,
  PublicProfileSnapshotSchema,
  WallpaperColorsExtractedEventSchema,
  WallpaperUploadedEventSchema,
  WallpaperVariantAvailableEventSchema,
  type ProfileUpdatedEvent,
  type PublicProfileSnapshot,
  type WallpaperColorsExtractedEvent,
  type WallpaperUploadedEvent,
  type WallpaperVariantAvailableEvent,
} from '@wallpaperdb/events';
import { DateTime, Option, Predicate, Schema } from 'effect';
import type { Occurrence, ProjectionChange } from '../../projection/index.js';

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeUtf8 = Option.liftThrowable((payload: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(payload)
);
const decodeCreated = Schema.decodeUnknownOption(
  Schema.Struct({
    eventType: Schema.Literal('profile.created'),
    profile: Schema.Unknown,
  })
);
const decodeCloud = Schema.decodeUnknownOption(
  Schema.Struct({
    specversion: Schema.Literal('1.0'),
    id: Schema.NonEmptyString,
    source: Schema.NonEmptyString,
    type: Schema.NonEmptyString,
    time: Schema.String,
    data: Schema.Record(Schema.String, Schema.Unknown),
    correlationid: Schema.optionalKey(Schema.String),
    causationid: Schema.optionalKey(Schema.String),
  })
);
const historicalProfile = PublicProfileSnapshotSchema.strip();
type LegacyEvent =
  | WallpaperUploadedEvent
  | WallpaperVariantAvailableEvent
  | WallpaperColorsExtractedEvent
  | ProfileUpdatedEvent
  | {
      eventId: string;
      eventType: 'profile.created';
      timestamp: string;
      profile: PublicProfileSnapshot;
    };

// These payload schemas are shared producer contracts owned by @wallpaperdb/events.
function parseLegacy(value: unknown): LegacyEvent | undefined {
  const base = BaseEventSchema.safeParse(value);
  if (!base.success) return undefined;
  switch (base.data.eventType) {
    case 'wallpaper.uploaded':
      return WallpaperUploadedEventSchema.safeParse(value).data;
    case 'wallpaper.variant.available':
      return WallpaperVariantAvailableEventSchema.safeParse(value).data;
    case 'wallpaper.colors.extracted':
      return WallpaperColorsExtractedEventSchema.safeParse(value).data;
    case 'profile.updated':
      return ProfileUpdatedEventSchema.safeParse(value).data;
    case 'profile.created': {
      const created = decodeCreated(value);
      if (Option.isNone(created)) return undefined;
      const profile = historicalProfile.safeParse(created.value.profile);
      return profile.success
        ? { ...base.data, eventType: 'profile.created', profile: profile.data }
        : undefined;
    }
    default:
      return undefined;
  }
}

export type TranslatedEvent =
  | {
      readonly _tag: 'Translated';
      readonly change: ProjectionChange;
      readonly correlationId?: string;
      readonly causationId?: string;
    }
  | { readonly _tag: 'Invalid' };

export function translate(subject: string, payload: Uint8Array): TranslatedEvent {
  const raw = Option.flatMap(decodeUtf8(payload), decodeJson);
  if (Option.isNone(raw)) return { _tag: 'Invalid' };
  const envelope = decodeCloud(raw.value);
  if (Predicate.hasProperty(raw.value, 'specversion') && Option.isNone(envelope))
    return { _tag: 'Invalid' };
  const event = parseLegacy(
    Option.isSome(envelope)
      ? {
          ...envelope.value.data,
          eventId: envelope.value.id,
          eventType: envelope.value.type,
          timestamp: envelope.value.time,
        }
      : raw.value
  );
  if (!event || event.eventType !== subject) return { _tag: 'Invalid' };
  const occurrence: Occurrence = {
    source: Option.isSome(envelope) ? envelope.value.source : legacySource(event.eventType),
    id: event.eventId,
    occurredAt: DateTime.formatIso(DateTime.makeUnsafe(event.timestamp)),
  };
  return {
    _tag: 'Translated',
    change: toChange(event, occurrence),
    ...(Option.isSome(envelope) && envelope.value.correlationid
      ? { correlationId: envelope.value.correlationid }
      : {}),
    ...(Option.isSome(envelope) && envelope.value.causationid
      ? { causationId: envelope.value.causationid }
      : {}),
  };
}

function legacySource(eventType: LegacyEvent['eventType']): string {
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

function toChange(event: LegacyEvent, occurrence: Occurrence): ProjectionChange {
  switch (event.eventType) {
    case 'wallpaper.uploaded':
      return {
        _tag: 'WallpaperUploaded',
        occurrence,
        wallpaperId: event.wallpaper.id,
        profileId: event.wallpaper.userId,
        uploadedAt: DateTime.formatIso(DateTime.makeUnsafe(event.wallpaper.uploadedAt)),
      };
    case 'wallpaper.variant.available': {
      const { wallpaperId, ...variant } = event.variant;
      return {
        _tag: 'VariantAvailable',
        occurrence,
        wallpaperId,
        variant: {
          ...variant,
          createdAt: DateTime.formatIso(DateTime.makeUnsafe(variant.createdAt)),
        },
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
