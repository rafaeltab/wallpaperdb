import type { PictureCrop, PictureDecodedLimits, PictureEncodingPolicy } from '../index';

export type PictureJob =
  | { action: 'preview'; file: Blob; limits?: PictureDecodedLimits }
  | {
      action: 'process';
      file: Blob;
      crop: PictureCrop;
      policy: PictureEncodingPolicy;
      limits?: PictureDecodedLimits;
    };
export type PictureJobResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; message: string; unsupported?: boolean };
