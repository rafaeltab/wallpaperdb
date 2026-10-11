export interface PictureDimensions {
  width: number;
  height: number;
}

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
