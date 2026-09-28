import { Context, type Effect, Schema } from 'effect';

export interface ValidationLimits {
  readonly maxFileSizeImage: number;
  readonly maxFileSizeVideo: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly allowedFormats: readonly string[];
}

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
  | { readonly _tag: 'UnsupportedAnimation' }
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
      readonly maxWidth: number;
      readonly maxHeight: number;
    }
  | {
      readonly _tag: 'TooManyPixels';
      readonly width: number;
      readonly height: number;
      readonly maxPixels: number;
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
  /** Opaque W3C propagation carrier retained with the durable occurrence. */
  readonly traceContext?: { readonly traceparent: string; readonly tracestate?: string };
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
  reconcile(): Effect.Effect<{ readonly processed: number }, IngestionUnavailable>;
  cleanup(): Effect.Effect<void, IngestionUnavailable>;
}

export const Ingestion = Context.Service<Ingestion>('wallpaperdb.ingestor.ingestion');

export interface IngestionIdentity {
  next(): Effect.Effect<{
    readonly wallpaperId: string;
    readonly eventId: string;
    readonly correlationId: string;
    readonly causationId: string;
    readonly leaseToken: string;
  }>;
}

export const IngestionIdentity = Context.Service<IngestionIdentity>(
  'wallpaperdb.ingestor.ingestion.identity'
);

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
