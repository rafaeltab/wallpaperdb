import type { PictureCrop, PictureEncodingPolicy } from '../index';

export type PictureJob =
  | { action: 'preview'; file: Blob }
  | { action: 'process'; file: Blob; crop: PictureCrop; policy: PictureEncodingPolicy };
export type PictureJobResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; message: string; unsupported?: boolean };
