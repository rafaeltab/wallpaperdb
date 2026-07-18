import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { inject, injectable } from 'tsyringe';
import { MinioConnection } from '../connections/minio.js';
import type { ImageReader } from './ports.js';

@injectable()
export class MinioImageReader implements ImageReader {
  constructor(@inject(MinioConnection) private readonly minio: MinioConnection) {}

  async read(bucket: string, key: string): Promise<Buffer> {
    const response = await this.minio
      .getClient()
      .send(new GetObjectCommand({ Bucket: bucket, Key: key }));

    if (!response.Body) {
      throw new Error(`Failed to download image: ${bucket}/${key}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
