import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { inject, injectable } from 'tsyringe';
import { S3Connection } from '../connections/s3.js';
import type { ImageReader } from './ports.js';

@injectable()
export class S3ImageReader implements ImageReader {
  constructor(@inject(S3Connection) private readonly s3: S3Connection) {}

  async read(bucket: string, key: string): Promise<Buffer> {
    const response = await this.s3
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
