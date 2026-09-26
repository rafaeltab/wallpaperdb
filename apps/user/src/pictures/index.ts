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
