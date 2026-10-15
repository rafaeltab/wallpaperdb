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
export interface PictureSource extends PictureDimensions {
  preview: Blob;
  process: (crop: PictureCrop, policy: PictureEncodingPolicy, signal: AbortSignal) => Promise<Blob>;
  dispose: () => void;
}

export interface PictureSelection {
  file: File;
  expectedVersion: number | null;
  source: PictureSource | null;
  crop: PictureCrop | null;
  previewUrl: string | null;
}

export interface PictureEditorProfile {
  version: number;
  limits: PictureDecodedLimits;
}

export interface PictureEditorDependencies {
  ownership: ProfileQueryOwnership;
  availability: ProfileCommandAvailability;
  save: (command: PictureCommand) => Promise<PictureSaveResult>;
  refresh: () => Promise<{ version: number }>;
  notify: (message: string) => void;
  openSource: (
    file: File,
    signal: AbortSignal,
    limits: PictureDecodedLimits
  ) => Promise<PictureSource>;
  previews: { create: (preview: Blob) => string; release: (url: string) => void };
}

export type PictureCommand =
  | { action: 'upload'; picture: File; expectedVersion: number }
  | { action: 'remove'; expectedVersion: number };

export type PictureSaveResult =
  | { success: true }
  | { success: false; error: { message: string; versionConflict?: boolean } };

export interface PictureEditorSnapshot {
  open: boolean;
  selection: PictureSelection | null;
  processing: boolean;
  error: string | null;
  recovery: 'required' | 'review' | null;
}
import type {
  ProfileCommandAvailability,
  ProfileQueryOwnership,
} from '@/features/profile-management';
