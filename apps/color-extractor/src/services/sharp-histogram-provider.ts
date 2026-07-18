import sharp from 'sharp';
import { inject, injectable } from 'tsyringe';
import { HsvEmbeddingStrategy, type IColorEmbeddingStrategy } from './hsv-embedding-strategy.js';
import { IMAGE_READER, type ImageHistogramProvider, type ImageReader } from './ports.js';

const TARGET_PIXELS = 10000;

@injectable()
export class SharpHistogramProvider implements ImageHistogramProvider {
  constructor(
    @inject(IMAGE_READER) private readonly imageReader: ImageReader,
    @inject(HsvEmbeddingStrategy) private readonly strategy: IColorEmbeddingStrategy
  ) {}

  async extractHistogram(bucket: string, key: string): Promise<number[]> {
    const imageBuffer = await this.imageReader.read(bucket, key);
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const aspectRatio = width / height;

    const targetH = Math.max(1, Math.round(Math.sqrt(TARGET_PIXELS / aspectRatio)));
    const targetW = Math.max(1, Math.round(targetH * aspectRatio));

    const rawPixels = await sharp(imageBuffer)
      .ensureAlpha()
      .resize(targetW, targetH, { fit: 'fill' })
      .raw()
      .toBuffer();

    return this.strategy.computeHistogram(new Uint8Array(rawPixels));
  }
}
