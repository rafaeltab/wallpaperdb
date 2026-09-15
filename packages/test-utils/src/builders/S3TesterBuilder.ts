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
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import { dockerStartSemaphore } from '../utils/semaphore.js';
import type { CleanupTesterBuilder } from './CleanupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';
import { createTestLogger } from '@wallpaperdb/test-logger';

const logger = createTestLogger('S3TesterBuilder');

export interface S3Options {
  image: string;
  accessKey: string;
  secretKey: string;
  networkAlias: string;
}

class S3Builder {
  image = 'chrislusf/seaweedfs:4.47';
  accessKey = 'storageadmin';
  secretKey = 'storageadmin';
  networkAlias = 's3';

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

  build(): S3Options {
    return {
      image: this.image,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      networkAlias: this.networkAlias,
    };
  }
}

export interface S3Config {
  container: StartedTestContainer;
  endpoints: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
    directIp: string;
  };
  options: S3Options;
  buckets: string[];
}

/**
 * Helper class providing namespaced S3 operations against SeaweedFS.
 * Manages a cached S3Client and provides object storage helpers.
 */
class S3Helpers {
  s3Client: S3Client | undefined;
  tester: TesterInstance<S3TesterBuilder>;

  constructor(tester: TesterInstance<S3TesterBuilder>) {
    this.tester = tester;
  }

  /**
   * Get the S3 configuration.
   * @throws Error if S3 not initialized
   */
  get config(): S3Config {
    const config = this.tester._s3Config;
    if (!config) {
      throw new Error('S3 not initialized. Call withS3() and setup() first.');
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
   * const client = tester.s3.getS3Client();
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
   * Upload an object to S3.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @param body - Buffer or string to upload
   *
   * @example
   * ```typescript
   * const image = await tester.fixtures.images.validJpeg();
   * await tester.s3.uploadObject('test-bucket', 'test.jpg', image);
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
   * Delete a single object from S3.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   *
   * @example
   * ```typescript
   * await tester.s3.deleteObject('test-bucket', 'test.jpg');
   * ```
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Check if an object exists in S3.
   *
   * @param bucket - Bucket name
   * @param key - Object key
   * @returns true if object exists, false otherwise
   *
   * @example
   * ```typescript
   * const exists = await tester.s3.objectExists('test-bucket', 'test.jpg');
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
   * const keys = await tester.s3.listObjects('test-bucket');
   * const images = await tester.s3.listObjects('test-bucket', 'images/');
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
   * await tester.s3.cleanupBuckets();
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

export class S3TesterBuilder extends BaseTesterBuilder<
  's3',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
> {
  name = 's3' as const;

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
    >,
  >(Base: TBase) {
    const desiredBuckets: string[] = [];

    return class S3 extends Base {
      // Private: internal config storage
      _s3Config: S3Config | undefined;

      // Public: helper instance
      readonly s3 = new S3Helpers(this);
      /**
       * Add a bucket to be created during setup.
       * Can be called multiple times to create multiple buckets.
       *
       * @param name - Bucket name
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withS3()
       *       .withS3Bucket('uploads')
       *       .withS3Bucket('backups');
       * ```
       */
      withS3Bucket(name: string) {
        desiredBuckets.push(name);
        return this;
      }

      /**
       * Configure and start a SeaweedFS S3 container.
       * Custom images must support the SeaweedFS mini command.
       *
       * @param configure - Optional configuration callback
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withS3(b =>
       *   b.withAccessKey('custom_key')
       *    .withSecretKey('custom_secret')
       * );
       * ```
       */
      withS3(configure: (s3: S3Builder) => S3Builder = (a) => a) {
        const options = configure(new S3Builder()).build();
        const { image, accessKey, secretKey, networkAlias } = options;

        this.addSetupHook(async () => {
          // Use semaphore to limit concurrent container starts
          await dockerStartSemaphore.run(async () => {
            logger.debug('Starting SeaweedFS S3 container...');

            let container = new GenericContainer(image)
              .withEnvironment({
                AWS_ACCESS_KEY_ID: accessKey,
                AWS_SECRET_ACCESS_KEY: secretKey,
              })
              .withCommand([
                'mini',
                '-dir=/data',
                '-ip=127.0.0.1',
                '-ip.bind=0.0.0.0',
                '-s3.port=9000',
                '-s3.autoCreateBucket=false',
                '-s3.allowDeleteBucketNotEmpty=false',
                '-s3.port.iceberg=0',
                '-s3.port.lance=0',
                '-admin.ui=false',
                '-webdav=false',
                '-master.telemetry=false',
              ])
              .withExposedPorts(9000)
              .withStartupTimeout(90000)
              // The HTTP endpoint alone does not ensure that the filer and volumes
              // are ready for S3 writes. Mini logs this after all components start.
              .withWaitStrategy(
                Wait.forAll([
                  Wait.forLogMessage('All enabled components are running and ready to use:'),
                  Wait.forHttp('/healthz', 9000),
                ])
              );

            const dockerNetwork = this.docker.network;
            if (dockerNetwork) {
              container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
            }

            const started = await container.start();

            const ip = started.getIpAddress(dockerNetwork?.getName() ?? 'bridge');
            const port = started.getMappedPort(9000);
            const endpoints = {
              networked: `http://${networkAlias}:9000`,
              fromHost: `http://${started.getHost()}:${port}`,
              fromHostDockerInternal: `http://host.docker.internal:${port}`,
              directIp: `http://${ip}:9000`,
            };

            this._s3Config = {
              container: started,
              endpoints: endpoints,
              options: options,
              buckets: [],
            };

            logger.debug(
              {
                networked: endpoints.networked,
                fromHost: endpoints.fromHost,
                fromHostDockerInternal: endpoints.fromHostDockerInternal,
                directIp: endpoints.directIp,
              },
              'SeaweedFS S3 started'
            );
          });

          // Create buckets outside semaphore - these don't strain Docker daemon
          if (desiredBuckets.length > 0 && this._s3Config) {
            // Create buckets using the helper's S3 client
            for (const bucket of desiredBuckets) {
              try {
                await this.s3.getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
                logger.debug({ bucket }, 'Created S3 bucket');
                this._s3Config.buckets.push(bucket);
              } catch (error) {
                if ((error as Error).name !== 'BucketAlreadyOwnedByYou') {
                  throw error;
                }
              }
            }
          }
        });

        this.addDestroyHook(async () => {
          if (this._s3Config) {
            logger.debug('Stopping SeaweedFS S3 container...');
            await this._s3Config.container.stop();
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
       * tester.withS3()
       *       .withS3Bucket('test-bucket')
       *       .withS3AutoCleanup();
       *
       * // In beforeEach:
       * await tester.cleanup(); // Deletes all objects from all buckets
       * ```
       */
      withS3AutoCleanup() {
        this.addCleanupHook(async () => {
          await this.s3.cleanupBuckets();
        });
        return this;
      }

      /**
       * Get S3 configuration.
       * Also available through tester.s3.config.
       *
       * @returns S3 configuration object
       * @throws Error if S3 not initialized
       *
       * @example
       * ```typescript
       * const config = tester.getS3();
       * console.log(config.endpoints.fromHost);
       * ```
       */
      getS3(): S3Config {
        return this.s3.config;
      }
    };
  }
}
