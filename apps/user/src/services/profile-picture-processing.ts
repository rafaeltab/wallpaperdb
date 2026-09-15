import sharp from 'sharp';

export class ProfilePictureTooLargeError extends Error {}

export interface PictureLimits {
  maxBytes: number;
  maxPixels: number;
  maxDecodedBytes: number;
}

export interface ProcessedPicture {
  bytes: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

export async function processProfilePicture(
  input: Buffer,
  limits: PictureLimits
): Promise<ProcessedPicture> {
  if (input.length > limits.maxBytes) throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  const result = await sharp(input, {
    limitInputPixels: limits.maxPixels,
    failOn: 'warning',
    sequentialRead: true,
  })
    .rotate()
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: result.data,
    mimeType: 'image/webp',
    width: result.info.width,
    height: result.info.height,
  };
}
