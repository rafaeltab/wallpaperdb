import { Context, type Effect, Schema } from 'effect';

export class CatalogFailure extends Schema.TaggedError<CatalogFailure>()('CatalogFailure', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface Occurrence {
  readonly source: string;
  readonly id: string;
}
export interface ProjectionMetadata {
  readonly occurrence: Occurrence;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly causationSource?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}
export interface Asset {
  readonly id: string;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly createdAt: string;
}
export type ProjectionInput = ProjectionMetadata &
  (
    | { readonly kind: 'wallpaper'; readonly wallpaper: Asset }
    | {
        readonly kind: 'variant';
        readonly variant: Omit<Asset, 'id'> & { readonly wallpaperId: string };
      }
    | {
        readonly kind: 'profile';
        readonly profile: {
          readonly id: string;
          readonly version: number;
          readonly pictureId: string | null;
          readonly updatedAt: string;
        };
        readonly asset?: Asset;
      }
  );
export type AvailableFormat = 'image/jpeg' | 'image/png' | 'image/webp';
/** Availability announces supported image renditions. Other immutable originals
 * remain retrievable but cannot be represented by the availability contract. */
export function availableFormat(mimeType: string): AvailableFormat | null {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp'
    ? mimeType
    : null;
}
export interface AvailableNotification {
  readonly id: string;
  readonly timestamp: string;
  readonly causationId: string;
  readonly causationSource: string;
  readonly correlationId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly variant: {
    readonly wallpaperId: string;
    readonly width: number;
    readonly height: number;
    readonly fileSizeBytes: number;
    readonly format: AvailableFormat;
    readonly createdAt: string;
  };
}
/** Atomically accepts an occurrence, projects its facts and persists its notification.
 * Replays are no-ops; variants may precede parents; profile heads only advance.
 */
export interface CatalogProjectionPort {
  readonly accept: (input: ProjectionInput) => Effect.Effect<void, CatalogFailure>;
}
export class CatalogProjection extends Context.Service<CatalogProjection, CatalogProjectionPort>()(
  'media/catalog/CatalogProjection'
) {}
/** Publications may repeat after an ambiguous broker response. Identity and payload
 * are immutable; acknowledgement deletes only the successfully published record.
 * Pending variants become visible only after the parent is available.
 */
export interface CatalogOutboxPort {
  readonly listPending: (
    limit: number
  ) => Effect.Effect<readonly AvailableNotification[], CatalogFailure>;
  readonly markPublished: (id: string) => Effect.Effect<void, CatalogFailure>;
}
export class CatalogOutbox extends Context.Service<CatalogOutbox, CatalogOutboxPort>()(
  'media/catalog/CatalogOutbox'
) {}

export interface CatalogHealthPort {
  readonly check: Effect.Effect<boolean>;
}
export class CatalogHealth extends Context.Service<CatalogHealth, CatalogHealthPort>()(
  'media/catalog/CatalogHealth'
) {}
