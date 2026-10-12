export interface PictureDimensions {
  width: number;
  height: number;
}

/** GIF composition uses User's advertised decoded resource bounds. */
export interface PictureDecodedLimits {
  readonly maxPixels: number;
  readonly maxDecodedBytes: number;
}

export const defaultPictureDecodedLimits: PictureDecodedLimits = {
  maxPixels: 16_000_000,
  maxDecodedBytes: 64 * 1024 * 1024,
};

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
