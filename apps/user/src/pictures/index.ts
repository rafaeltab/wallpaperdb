import { Context, Effect, Schema } from 'effect';

export class PictureUnavailable extends Schema.TaggedError<PictureUnavailable>()(
  'PictureUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}

export interface PictureLimits {
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly maxDecodedBytes: number;
}

export interface ProcessedPicture {
  readonly bytes: Buffer;
  readonly mimeType: 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface PictureRejection {
  readonly _tag: 'Rejected';
  readonly reason: 'invalid-picture' | 'picture-too-large' | 'picture-source-rejected';
  readonly message: string;
}

/** Decodes bounded still images, strips source metadata, and stops native work on interruption. */
export interface PictureCodec {
  process(
    bytes: Buffer
  ): Effect.Effect<
    { readonly _tag: 'Processed'; readonly picture: ProcessedPicture } | PictureRejection,
    PictureUnavailable
  >;
}
export const PictureCodec = Context.Service<PictureCodec>('wallpaperdb.user.pictures.PictureCodec');

/** Downloads only trusted HTTPS destinations with bounded redirects, bytes and total duration. */
export interface PictureSource {
  download(
    url: string
  ): Effect.Effect<
    { readonly _tag: 'Downloaded'; readonly bytes: Buffer } | PictureRejection,
    PictureUnavailable
  >;
}
export const PictureSource = Context.Service<PictureSource>(
  'wallpaperdb.user.pictures.PictureSource'
);

export interface StoredPicture {
  readonly id: string;
  readonly profileId: string;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly mimeType: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly expiresAt: Date | null;
}
export interface PictureCursor {
  readonly id: string;
  readonly expiresAt: Date | null;
}
export interface PictureImport {
  readonly profileId: string;
  readonly sourceUrl: string;
  readonly leaseToken: string;
  /** Number of attempts preceding this claim, for first-retry backoff. */
  readonly attempts: number;
}
/** Candidates are durable before PUT. Upload claims serialize with adoption and
 * deletion, and become adoptable only after completion. Deletion claims mark an
 * unreferenced expired candidate permanently unavailable before external DELETE.
 * No transaction spans an external resource. Import completion/retry is fenced. */
export interface PictureStore {
  createCandidate(
    input: StoredPicture & { readonly createdAt: Date }
  ): Effect.Effect<void, PictureUnavailable>;
  beginUpload(id: string, now: Date): Effect.Effect<boolean, PictureUnavailable>;
  finishUpload(id: string, now: Date): Effect.Effect<boolean, PictureUnavailable>;
  available(id: string): Effect.Effect<boolean, PictureUnavailable>;
  expired(
    now: Date,
    cursor?: PictureCursor
  ): Effect.Effect<readonly StoredPicture[], PictureUnavailable>;
  claimDeletion(id: string, now: Date): Effect.Effect<StoredPicture | null, PictureUnavailable>;
  finishDeletion(id: string): Effect.Effect<boolean, PictureUnavailable>;
  dueImports(now: Date): Effect.Effect<readonly string[], PictureUnavailable>;
  claimImport(
    profileId: string,
    now: Date,
    leaseDurationMs: number
  ): Effect.Effect<PictureImport | null, PictureUnavailable>;
  settleImport(
    job: PictureImport,
    permanent: boolean,
    nextAttemptAt: Date
  ): Effect.Effect<void, PictureUnavailable>;
}
export const PictureStore = Context.Service<PictureStore>('wallpaperdb.user.pictures.PictureStore');

/** Object keys are immutable. Writes and deletes are abortable and bounded by
 * ten seconds; failures may be ambiguous and must preserve durable evidence. */
export interface PictureObjects {
  put(asset: StoredPicture, bytes: Buffer): Effect.Effect<void, PictureUnavailable>;
  delete(asset: StoredPicture): Effect.Effect<void, PictureUnavailable>;
}
export const PictureObjects = Context.Service<PictureObjects>(
  'wallpaperdb.user.pictures.PictureObjects'
);
