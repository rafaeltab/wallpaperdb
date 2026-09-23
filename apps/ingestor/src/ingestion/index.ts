import { Clock, Context, Effect, Layer, Schema } from 'effect';

export interface ValidationLimits {
  readonly maxFileSizeImage: number;
  readonly maxFileSizeVideo: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly allowedFormats: readonly string[];
}
export const validationLimits: ValidationLimits = {
  maxFileSizeImage: 50 * 1024 * 1024,
  maxFileSizeVideo: 200 * 1024 * 1024,
  minWidth: 1280,
  minHeight: 720,
  maxWidth: 7680,
  maxHeight: 4320,
  allowedFormats: ['image/jpeg', 'image/png', 'image/webp'],
};
export interface FileMetadata {
  readonly mimeType: string;
  readonly fileType: 'image';
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly contentHash: string;
  readonly extension: string;
}
export type ValidationRejection =
  | { readonly _tag: 'InvalidFormat'; readonly mimeType: string }
  | {
      readonly _tag: 'TooLarge';
      readonly fileSizeBytes: number;
      readonly maxFileSizeBytes: number;
      readonly fileType: 'image' | 'video';
    }
  | {
      readonly _tag: 'InvalidDimensions';
      readonly width: number;
      readonly height: number;
      readonly minWidth: number;
      readonly minHeight: number;
      readonly maxWidth: number;
      readonly maxHeight: number;
    };
export class IngestionUnavailable extends Schema.TaggedError<IngestionUnavailable>()(
  'IngestionUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}
export interface ContentInspection {
  inspect(
    bytes: Uint8Array,
    declaredMimeType: string,
    limits: ValidationLimits
  ): Effect.Effect<
    { readonly _tag: 'Inspected'; readonly metadata: FileMetadata } | ValidationRejection,
    IngestionUnavailable
  >;
}
export const ContentInspection = Context.Service<ContentInspection>(
  'wallpaperdb.ingestor.ingestion.inspection'
);
export interface AssetReference {
  readonly wallpaperId: string;
  readonly extension: string;
}
export interface AssetStorage {
  put(input: {
    readonly wallpaperId: string;
    readonly profileId: string;
    readonly bytes: Uint8Array;
    readonly metadata: FileMetadata;
  }): Effect.Effect<void, IngestionUnavailable>;
  exists(reference: AssetReference): Effect.Effect<boolean, IngestionUnavailable>;
  remove(reference: AssetReference): Effect.Effect<void, IngestionUnavailable>;
  list(
    cursor?: string
  ): Effect.Effect<
    { readonly assets: readonly AssetReference[]; readonly cursor?: string },
    IngestionUnavailable
  >;
}
export const AssetStorage = Context.Service<AssetStorage>('wallpaperdb.ingestor.ingestion.assets');
export interface UploadedWallpaper {
  readonly id: string;
  readonly profileId: string;
  readonly metadata: FileMetadata;
  readonly originalFilename: string;
  readonly uploadedAt: string;
}
export interface UploadedEvent {
  readonly id: string;
  readonly source: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly wallpaper: UploadedWallpaper;
}
/** Publication completes only after durable broker acknowledgement; retries preserve the complete occurrence. */
export interface UploadEvents {
  publish(event: UploadedEvent): Effect.Effect<void, IngestionUnavailable>;
}
export const UploadEvents = Context.Service<UploadEvents>('wallpaperdb.ingestor.ingestion.events');
export interface UploadReceipt {
  readonly id: string;
  readonly uploadedAt: string;
  readonly fileType: 'image';
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
}
export interface UploadInput {
  readonly principal: { readonly profileId: string };
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly declaredMimeType: string;
}
export type UploadOutcome =
  | { readonly _tag: 'Accepted'; readonly upload: UploadReceipt }
  | { readonly _tag: 'Duplicate'; readonly upload: UploadReceipt }
  | { readonly _tag: 'InProgress' }
  | { readonly _tag: 'Unauthorized' }
  | ValidationRejection;
export interface Ingestion {
  upload(input: UploadInput): Effect.Effect<UploadOutcome, IngestionUnavailable>;
  reconcile(): Effect.Effect<void, IngestionUnavailable>;
  cleanup(): Effect.Effect<void, IngestionUnavailable>;
}
export const Ingestion = Context.Service<Ingestion>('wallpaperdb.ingestor.ingestion');
export interface IngestionIdentity {
  next(): Effect.Effect<{ readonly wallpaperId: string; readonly eventId: string; readonly correlationId: string; readonly causationId: string; readonly leaseToken: string }>;
}
export const IngestionIdentity = Context.Service<IngestionIdentity>('wallpaperdb.ingestor.ingestion.identity');

export interface UploadRecord {
  readonly wallpaper: UploadedWallpaper;
  readonly event: UploadedEvent;
  readonly state: 'uploading' | 'stored' | 'processing' | 'completed' | 'failed';
  readonly attempts: number;
  readonly leaseToken: string;
}
export type Reservation =
  | { readonly _tag: 'Reserved'; readonly record: UploadRecord }
  | { readonly _tag: 'Existing'; readonly record: UploadRecord };
/**
 * Reservations atomically deduplicate active uploads by owner and content hash.
 * The complete metadata and occurrence identity are durable before object storage runs.
 * stored() atomically commits stored state and the outbox entry. Claims use expiring
 * leases, never hold transactions across external effects, and all writes compare the
 * lease token so a stale worker cannot overwrite another worker's progress.
 * Deferred uploads become failed after maxAttempts; exhausted publications remain
 * durably quarantined in the outbox. Claimed batches contain at most limit records.
 */
export interface IngestionStore {
  reserve(record: UploadRecord, leaseUntil: Date): Effect.Effect<Reservation, IngestionUnavailable>;
  stored(record: UploadRecord): Effect.Effect<boolean, IngestionUnavailable>;
  published(record: UploadRecord): Effect.Effect<void, IngestionUnavailable>;
  defer(
    record: UploadRecord,
    now: Date,
    maxAttempts: number
  ): Effect.Effect<void, IngestionUnavailable>;
  claim(
    now: Date,
    staleBefore: Date,
    leaseUntil: Date,
    limit: number
  ): Effect.Effect<readonly UploadRecord[], IngestionUnavailable>;
  expireIntents(before: Date): Effect.Effect<void, IngestionUnavailable>;
  assetDisposition(wallpaperId: string): Effect.Effect<'retain' | 'remove', IngestionUnavailable>;
}
export const IngestionStore = Context.Service<IngestionStore>(
  'wallpaperdb.ingestor.ingestion.store'
);

export function ingestionLayer(): Layer.Layer<
  Ingestion,
  never,
  ContentInspection | AssetStorage | UploadEvents | IngestionStore | IngestionIdentity
> {
  return Layer.effect(
    Ingestion,
    Effect.gen(function* () {
      const inspection = yield* ContentInspection;
      const assets = yield* AssetStorage;
      const events = yield* UploadEvents;
      const store = yield* IngestionStore;
      const identity = yield* IngestionIdentity;
      const publish = Effect.fn('ingestion.publish')(function* (record: UploadRecord) {
        yield* events.publish(record.event);
        yield* store.published(record);
      });
      const defer = (record: UploadRecord, maximum: number) => Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) => store.defer(record, new Date(now), maximum))
      );
      const publishOrDefer = (record: UploadRecord) => publish(record).pipe(
        Effect.catchTag('IngestionUnavailable', () => defer(record, 10))
      );
      const recover = Effect.fn('ingestion.recover')(function* (record: UploadRecord) {
        if (record.state === 'uploading') {
          const exists = yield* assets.exists({ wallpaperId: record.wallpaper.id, extension: record.wallpaper.metadata.extension });
          if (!exists) return yield* defer(record, 3);
          const committed = yield* store.stored(record);
          if (!committed) return;
        }
        yield* publishOrDefer({ ...record, state: 'stored' });
      });
      const upload = Effect.fn('ingestion.upload')(function* (
        input: UploadInput
      ): Effect.fn.Return<UploadOutcome, IngestionUnavailable> {
        const inspected = yield* inspection.inspect(
          input.bytes,
          input.declaredMimeType,
          validationLimits
        );
        if (inspected._tag !== 'Inspected') return inspected;
        const now = yield* Clock.currentTimeMillis;
        const ids = yield* identity.next();
        const wallpaper: UploadedWallpaper = {
          id: ids.wallpaperId,
          profileId: input.principal.profileId,
          metadata: inspected.metadata,
          originalFilename: input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255),
          uploadedAt: new Date(now).toISOString(),
        };
        const record: UploadRecord = {
          wallpaper,
          state: 'uploading',
          attempts: 0,
          leaseToken: ids.leaseToken,
          event: {
            id: ids.eventId,
            source: 'wallpaperdb/ingestor',
            occurredAt: wallpaper.uploadedAt,
            correlationId: ids.correlationId,
            causationId: ids.causationId,
            wallpaper,
          },
        };
        const reservation = yield* store.reserve(record, new Date(now + 10 * 60 * 1000));
        if (reservation._tag === 'Existing') {
          return reservation.record.state === 'uploading'
            ? { _tag: 'InProgress' }
            : { _tag: 'Duplicate', upload: receipt(reservation.record.wallpaper) };
        }
        yield* assets.put({
          wallpaperId: wallpaper.id,
          profileId: wallpaper.profileId,
          bytes: input.bytes,
          metadata: wallpaper.metadata,
        });
        yield* store.stored(record);
        yield* publishOrDefer({ ...record, state: 'stored' });
        return { _tag: 'Accepted', upload: receipt(record.wallpaper) };
      });
      return Ingestion.of({
        upload,
        reconcile: Effect.fn('ingestion.reconcile')(function* () {
          const now = yield* Clock.currentTimeMillis;
          const records = yield* store.claim(new Date(now), new Date(now - 10 * 60 * 1000), new Date(now + 60_000), 100);
          yield* Effect.forEach(records, (record) => recover(record).pipe(Effect.catchTag('IngestionUnavailable', () => Effect.void)), { concurrency: 5, discard: true });
          yield* store.expireIntents(new Date(now - 60 * 60 * 1000));
        }),
        cleanup: () => Effect.void,
      });
    })
  );
}

function receipt(wallpaper: UploadedWallpaper): UploadReceipt {
  const { fileType, mimeType, width, height, fileSizeBytes } = wallpaper.metadata;
  return {
    id: wallpaper.id,
    uploadedAt: wallpaper.uploadedAt,
    fileType,
    mimeType,
    width,
    height,
    fileSizeBytes,
  };
}
