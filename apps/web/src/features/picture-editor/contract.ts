import type {
  ProfileCommandAvailability,
  ProfileQueryOwnership,
} from '@/features/profile-management';

export interface PictureDimensions {
  width: number;
  height: number;
}

/** GIF composition uses User's advertised decoded resource bounds. */
export interface PictureDecodedLimits {
  readonly maxPixels: number;
  readonly maxDecodedBytes: number;
}

// Match Ingestor's image source limit, independently of User's processed upload limit.
export const pictureGifSourceByteLimit = 50 * 1024 * 1024;

/** Coordinates are in the oriented source, independent of preview/display size. */
export interface PictureCrop {
  x: number;
  y: number;
  size: number;
  zoom: number;
  maxZoom: number;
  lowResolution: boolean;
}

export interface PictureEncodingPolicy {
  output: PictureDimensions & { mimeType: 'image/webp'; colorSpace: 'srgb' };
  maxOutputBytes: number;
  animation: { available: boolean };
  encoding: { staticQuality: number; animationQuality: number };
}

/** The editing session owns a decoded source until replacement or closure. */
export interface PictureSource<Bytes> extends PictureDimensions {
  preview: Bytes;
  process: (
    crop: PictureCrop,
    policy: PictureEncodingPolicy,
    signal: AbortSignal
  ) => Promise<Bytes>;
  dispose: () => void;
}

export interface PictureSelection<Input, Bytes> {
  file: Input;
  expectedVersion: number | null;
  source: PictureSource<Bytes> | null;
  crop: PictureCrop | null;
  previewUrl: string | null;
}

export interface PictureEditorProfile {
  version: number;
  limits: PictureDecodedLimits;
}

export interface PictureEditorDependencies<Input, Bytes> {
  createOperation: () => { signal: AbortSignal; abort: () => void };
  ownership: ProfileQueryOwnership;
  availability: ProfileCommandAvailability;
  save: (command: PictureCommand<Bytes>) => Promise<PictureSaveResult>;
  refresh: () => Promise<{ version: number }>;
  notify: (message: string) => void;
  openSource: (
    file: Input,
    signal: AbortSignal,
    limits: PictureDecodedLimits
  ) => Promise<PictureSource<Bytes>>;
  previews: { create: (preview: Bytes) => string; release: (url: string) => void };
}

export type PictureCommand<Bytes> =
  | { action: 'upload'; picture: Bytes; expectedVersion: number }
  | { action: 'remove'; expectedVersion: number };

export type PictureSaveResult =
  | { success: true }
  | { success: false; error: { message: string; versionConflict?: boolean } };

export interface PictureEditorSnapshot<Input, Bytes> {
  open: boolean;
  removeVersion: number | null;
  selection: PictureSelection<Input, Bytes> | null;
  processing: boolean;
  error: string | null;
  recovery: 'required' | 'review' | null;
}

export interface PictureFile {
  name: string;
  type: string;
  size: number;
}
