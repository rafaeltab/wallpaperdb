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
  encoding: { staticQuality: number };
}

/** UI owns this decoded source and must dispose it when its editing session ends. */
export interface PictureSource extends PictureDimensions {
  preview: Blob;
  process: (crop: PictureCrop, policy: PictureEncodingPolicy, signal: AbortSignal) => Promise<Blob>;
  dispose: () => void;
}
