import { Context, type Effect, Schema } from 'effect';

export interface StoredAsset {
  readonly storageBucket: string;
  readonly storageKey: string;
}

export interface Wallpaper extends StoredAsset {
  readonly id: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface Variant extends StoredAsset {
  readonly id: string;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
}

export interface ResizeOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fit: 'contain' | 'cover' | 'fill';
}

export class DeliveryUnavailable extends Schema.TaggedError<DeliveryUnavailable>()(
  'DeliveryUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}

export interface Catalog {
  findWallpaper(id: string): Effect.Effect<Wallpaper | null, DeliveryUnavailable>;
  findSmallestVariant(
    id: string,
    minWidth: number,
    minHeight: number
  ): Effect.Effect<Variant | null, DeliveryUnavailable>;
  findCurrentPicture(id: string): Effect.Effect<StoredAsset | null, DeliveryUnavailable>;
}

export const Catalog = Context.Service<Catalog>('wallpaperdb.asset.delivery.Catalog');

export interface AssetBody extends AsyncIterable<Uint8Array> {
  close(): void;
}

/** Missing objects return null. Failed reads fail; iterators propagate stream errors and release resources on return. */
export interface AssetReader {
  read(
    asset: StoredAsset,
    context?: { readonly source: 'original' | 'variant'; readonly fallback?: boolean }
  ): Effect.Effect<AssetBody | null, DeliveryUnavailable>;
}

export const AssetReader = Context.Service<AssetReader>('wallpaperdb.asset.delivery.AssetReader');

export interface PictureAuthority {
  isAvailable(id: string): Effect.Effect<boolean, DeliveryUnavailable>;
}

export const PictureAuthority = Context.Service<PictureAuthority>(
  'wallpaperdb.asset.delivery.PictureAuthority'
);

/** Dimensions after applying source orientation, independent of stored catalog facts. */
export interface ImageGeometry {
  readonly width: number;
  readonly height: number;
  readonly requiresOrientation: boolean;
}

export interface ImageTransformer {
  /** Consumes and closes the byte source. Native work is bounded and reaped on interruption. */
  inspect(body: AssetBody): Effect.Effect<ImageGeometry, DeliveryUnavailable>;
  resize(
    body: AssetBody,
    options: ResizeOptions & { readonly mimeType: string }
  ): Effect.Effect<AssetBody, DeliveryUnavailable>;
}

export const ImageTransformer = Context.Service<ImageTransformer>(
  'wallpaperdb.asset.delivery.ImageTransformer'
);

export type AssetOutcome =
  | {
      readonly _tag: 'Found';
      readonly body: AssetBody;
      readonly mimeType: string;
      readonly fileSizeBytes?: number;
    }
  | { readonly _tag: 'NotFound' }
  | { readonly _tag: 'Rejected'; readonly reason: string };

export interface AssetDelivery {
  wallpaper(id: string, options?: ResizeOptions): Effect.Effect<AssetOutcome, DeliveryUnavailable>;
  picture(id: string): Effect.Effect<AssetOutcome, DeliveryUnavailable>;
}

export const AssetDelivery = Context.Service<AssetDelivery>(
  'wallpaperdb.asset.delivery.AssetDelivery'
);

export interface DeliveryLimits {
  readonly maxResizeWidth: number;
  readonly maxResizeHeight: number;
  readonly maxOutputPixels: number;
  readonly maxPictureBytes?: number;
}
