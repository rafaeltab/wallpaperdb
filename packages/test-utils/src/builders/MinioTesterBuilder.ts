import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import { dockerStartSemaphore } from '../utils/semaphore.js';
import type { CleanupTesterBuilder } from './CleanupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';

export interface MinioOptions {
  image: string;
  accessKey: string;
  secretKey: string;
  networkAlias: string;
}

class MinioBuilder {
  private image = 'minio/minio:latest';
  private accessKey = 'minioadmin';
  private secretKey = 'minioadmin';
  private networkAlias = 'minio';

  withImage(image: string) {
    this.image = image;
    return this;
  }

  withAccessKey(key: string) {
    this.accessKey = key;
    return this;
  }

  withSecretKey(key: string) {
    this.secretKey = key;
    return this;
  }

  withNetworkAlias(alias: string) {
    this.networkAlias = alias;
    return this;
  }

  build(): MinioOptions {
    return {
      image: this.image,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      networkAlias: this.networkAlias,
    };
  }
}

export interface MinioConfig {
  container: StartedMinioContainer;
  endpoints: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
  };
  options: MinioOptions;
  buckets: string[];
}

/**
 * Helper class providing namespaced MinIO/S3 operations.
 * Manages a cached S3Client and provides object storage helpers.
 */
class MinioHelpers {
  private s3Client: S3Client | undefined;

  constructor(private tester: TesterInstance<MinioTesterBuilder>) {}

  /**
   * Get the MinIO configuration.
   * @throws Error if MinIO not initialized
   */
  get config(): MinioConfig {
    const config = this.tester._minioConfig;
    if (!config) {
      throw new Error('MinIO not initialized. Call withMinio() and setup() first.');
    }
    return config;
  }

  /**
   * Get a cached S3Client instance.
   * Creates the client on first access and reuses it.
   *
   * Uses the external endpoint (host-accessible) for operations initiated from test code.
   * This ensures compatibility with Docker networks where internal aliases aren't resolvable from host.
   *
   * @returns AWS SDK S3Client
   *
   * @example
   * ```typescript
   * const client = tester.minio.getS3Client();
   * await client.send(new GetObjectCommand({ Bucket: 'test', Key: 'file.jpg' }));
   * ```
   */
  getS3Client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        endpoint: this.config.endpoints.fromHost,
        region: 'us-east-1',
        credentials: {
          accessKeyId: this.config.options.accessKey,
          secretAccessKey: this.config.options.secretKey,
        },
        forcePathStyle: true,
      });
    }
    return this.s3Client;
  }

  /**
   * Upload an object to S3/MinIO.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @param body - Buffer or string to upload
   *
   * @example
   * ```typescript
   * const image = await tester.fixtures.images.validJpeg();
   * await tester.minio.uploadObject('test-bucket', 'test.jpg', image);
   * ```
   */
  async uploadObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    additional: Partial<PutObjectCommandInput> = {}
  ): Promise<void> {
    await this.getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ...additional,
      })
    );
  }

  /**
   * Delete a single object from S3/MinIO.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   *
   * @example
   * ```typescript
   * await tester.minio.deleteObject('test-bucket', 'test.jpg');
   * ```
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Check if an object exists in S3/MinIO.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @returns true if object exists, false otherwise
   *
   * @example
   * ```typescript
   * const exists = await tester.minio.objectExists('test-bucket', 'test.jpg');
   * expect(exists).toBe(true);
   * ```
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error != null &&
        'name' in error &&
        error.name === 'NotFound'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all objects in a bucket with optional prefix filter.
   *
   * @param bucket - Bucket name
   * @param prefix - Optional key prefix filter
   * @returns Array of object keys
   *
   * @example
   * ```typescript
   * const keys = await tester.minio.listObjects('test-bucket');
   * const images = await tester.minio.listObjects('test-bucket', 'images/');
   * ```
   */
  async listObjects(bucket: string, prefix?: string): Promise<string[]> {
    const response = await this.getS3Client().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
    );
    // biome-ignore lint/style/noNonNullAssertion: AWS SDK guarantees Key exists in Contents
    return response.Contents?.map((obj) => obj.Key!) ?? [];
  }

  /**
   * Delete all objects from all configured buckets.
   * Useful for cleanup between tests.
   *
   * @example
   * ```typescript
   * await tester.minio.cleanupBuckets();
   * ```
   */
  async cleanupBuckets(): Promise<void> {
    for (const bucket of this.config.buckets) {
      const keys = await this.listObjects(bucket);
      if (keys.length > 0) {
        await this.getS3Client().send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          })
        );
      }
    }
  }
}

export class MinioTesterBuilder extends BaseTesterBuilder<
  'minio',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
> {
  name = 'minio' as const;

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
    >,
  >(Base: TBase) {
    const desiredBuckets: string[] = [];

    return class Minio extends Base {
      // Private: internal config storage
      _minioConfig: MinioConfig | undefined;

      // Public: helper instance
      readonly minio = new MinioHelpers(this);
      /**
       * Add a bucket to be created during setup.
       * Can be called multiple times to create multiple buckets.
       *
       * @param name - Bucket name
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withMinio()
       *       .withMinioBucket('uploads')
       *       .withMinioBucket('backups');
       * ```
       */
      withMinioBucket(name: string) {
        desiredBuckets.push(name);
        return this;
      }

      /**
       * Configure and start a MinIO container.
       *
       * @param configure - Optional configuration callback
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withMinio(b =>
       *   b.withAccessKey('custom_key')
       *    .withSecretKey('custom_secret')
       * );
       * ```
       */
      withMinio(configure: (minio: MinioBuilder) => MinioBuilder = (a) => a) {
        const options = configure(new MinioBuilder()).build();
        const { image, accessKey, secretKey, networkAlias } = options;

        this.addSetupHook(async () => {
          // Use semaphore to limit concurrent container starts
          await dockerStartSemaphore.run(async () => {
            console.log('Starting MinIO container...');

            let container = new MinioContainer(image);

            container.withPassword(secretKey);
            container.withUsername(accessKey);

            // Longer timeout when using Docker networks - health check may be slower
            container.withStartupTimeout(90000);

            const dockerNetwork = this.docker.network;
            if (dockerNetwork) {
              container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
            }

            const started = await container.start();
            const endpoints = {
              networked: `http://${networkAlias}:9000`,
              fromHost: `http://${started.getHost()}:${started.getPort()}`.replace(
                'localhost',
                '127.0.0.1'
              ),
              fromHostDockerInternal: `http://host.docker.internal:${started.getPort()}`,
            };

            this._minioConfig = {
              container: started,
              endpoints: endpoints,
              options: options,
              buckets: [],
            };

            console.log(
              `MinIO started: ${endpoints.networked} (networked) ${endpoints.fromHost} (from host) ${endpoints.fromHostDockerInternal} (host.docker.internal)`
            );
          });

          // Create buckets outside semaphore - these don't strain Docker daemon
          if (desiredBuckets.length > 0 && this._minioConfig) {
            // Create buckets using the helper's S3 client
            for (const bucket of desiredBuckets) {
              try {
                await this.minio.getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
                console.log(`Created S3 bucket: ${bucket}`);
                this._minioConfig.buckets.push(bucket);
              } catch (error) {
                if ((error as Error).name !== 'BucketAlreadyOwnedByYou') {
                  throw error;
                }
              }
            }
          }
        });

        this.addDestroyHook(async () => {
          if (this._minioConfig) {
            console.log('Stopping MinIO container...');
            await this._minioConfig.container.stop();
          }
        });

        return this;
      }

      /**
       * Enable automatic cleanup of all buckets in cleanup phase.
       * All objects are deleted when tester.cleanup() is called.
       *
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withMinio()
       *       .withMinioBucket('test-bucket')
       *       .withAutoCleanup();
       *
       * // In beforeEach:
       * await tester.cleanup(); // Deletes all objects from all buckets
       * ```
       */
      withMinioAutoCleanup() {
        this.addCleanupHook(async () => {
          await this.minio.cleanupBuckets();
        });
        return this;
      }

      /**
       * Get MinIO configuration.
       * Backward compatibility method - prefer using tester.minio.config
       *
       * @returns MinIO configuration object
       * @throws Error if MinIO not initialized
       *
       * @example
       * ```typescript
       * const config = tester.getMinio();
       * console.log(config.endpoint);
       * ```
       */
      getMinio(): MinioConfig {
        return this.minio.config;
      }
    };
  }
}
