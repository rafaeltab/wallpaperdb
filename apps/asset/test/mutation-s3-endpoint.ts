export interface MutationS3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Setup owns these values for one native execution. Ordinary tests never set them.
export const mutationS3Endpoint: {
  config?: MutationS3Config;
  helperClient?: S3Client;
  upload?: (bucket: string, key: string, bytes: Buffer) => Promise<void>;
  dispose?: () => Promise<void>;
  observeApplication?: (
    clients: readonly S3Client[],
    failed: boolean,
    complete: boolean
  ) => Promise<void>;
} = {};
import type { S3Client } from '@aws-sdk/client-s3';
