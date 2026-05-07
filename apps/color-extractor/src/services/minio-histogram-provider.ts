import { GetObjectCommand } from '@aws-sdk/client-s3';
import { inject, injectable } from 'tsyringe';
import sharp from 'sharp';
import type { Readable } from 'node:stream';
import { MinioConnection } from '../connections/minio.js';
import { HsvEmbeddingStrategy, type IColorEmbeddingStrategy } from './hsv-embedding-strategy.js';

export interface IImageHistogramProvider {
  extractHistogram(bucket: string, key: string): Promise<number[]>;
}

const TARGET_PIXELS = 10000;

@injectable()
export class MinioHistogramProvider implements IImageHistogramProvider {
  constructor(
    @inject(MinioConnection) private readonly minio: MinioConnection,
    @inject(HsvEmbeddingStrategy) private readonly strategy: IColorEmbeddingStrategy
  ) {}

  async extractHistogram(bucket: string, key: string): Promise<number[]> {
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.minio.getClient().send(getCommand);

    if (!response.Body) {
      throw new Error(`Failed to download image: ${bucket}/${key}`);
    }

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const imageBuffer = Buffer.concat(chunks);

    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width ?? 1;
    const height = metadata.height ?? 1;
    const aspectRatio = width / height;

    const targetH = Math.round(Math.sqrt(TARGET_PIXELS / aspectRatio));
    const targetW = Math.round(targetH * aspectRatio);

    const rawPixels = await sharp(imageBuffer)
      .ensureAlpha()
      .resize(targetW, targetH, { fit: 'fill' })
      .raw()
      .toBuffer();

    return this.strategy.computeHistogram(new Uint8Array(rawPixels));
  }
}
