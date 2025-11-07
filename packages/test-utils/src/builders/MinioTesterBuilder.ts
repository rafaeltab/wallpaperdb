import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { AddMethodsType, BaseTesterBuilder } from '../framework.js';
import { DockerTesterBuilder } from './DockerTesterBuilder.js';

export interface MinioOptions {
    image: string;
    accessKey: string;
    secretKey: string;
    networkAlias: string;
}

class MinioBuilder {
    private image: string = 'minio/minio:latest';
    private accessKey: string = 'minioadmin';
    private secretKey: string = 'minioadmin';
    private networkAlias: string = 'minio';

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
        }
    }
}

export interface MinioConfig {
    container: StartedMinioContainer;
    endpoint: string;
    options: MinioOptions;
    buckets: string[];
}

export class MinioTesterBuilder extends BaseTesterBuilder<'minio', [DockerTesterBuilder]> {
    name = 'minio' as const;

    addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
        let desiredBuckets: string[] = [];

        return class Minio extends Base {
            minio: MinioConfig | undefined;
            withMinioBucket(name: string) {
                desiredBuckets.push(name);
                return this;
            }

            withMinio(configure: (minio: MinioBuilder) => MinioBuilder = (a) => a) {
                const options = configure(new MinioBuilder()).build();
                const {
                    image,
                    accessKey,
                    secretKey,
                    networkAlias,
                } = options;

                this.addSetupHook(async () => {
                    console.log('Starting MinIO container...');

                    let container = new MinioContainer(image);

                    container.withPassword(secretKey);
                    container.withUsername(accessKey);

                    const dockerNetwork = this.docker.network;
                    if (dockerNetwork) {
                        container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
                    }

                    const started = await container.start();

                    const host = dockerNetwork ? networkAlias : started.getHost();
                    const port = dockerNetwork ? 9000 : started.getPort();

                    const endpoint = `http://${host}:${port}`;

                    this.minio = {
                        container: started,
                        endpoint: endpoint,
                        options: options,
                        buckets: [],
                    };

                    if (desiredBuckets.length > 0) {
                        // Create bucket if specified
                        const s3Client = new S3Client({
                            endpoint: this.minio.endpoint,
                            region: 'us-east-1',
                            credentials: {
                                accessKeyId: this.minio.options.accessKey,
                                secretAccessKey: this.minio.options.secretKey,
                            },
                            forcePathStyle: true,
                        });

                        for (const bucket of desiredBuckets) {

                            try {
                                await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
                                console.log(`Created S3 bucket: ${bucket}`);
                                this.minio.buckets.push(bucket);
                            } catch (error) {
                                if ((error as Error).name !== 'BucketAlreadyOwnedByYou') {
                                    throw error;
                                }
                            }
                        }
                    }


                    console.log(`MinIO started: ${endpoint}`);
                });

                this.addDestroyHook(async () => {
                    if (this.minio) {
                        console.log('Stopping MinIO container...');
                        await this.minio.container.stop();
                    }
                });

                return this;
            }

            getMinio() {
                if (!this.minio) {
                    throw new Error('MinIO not initialized. Call withMinio() and setup() first.');
                }
                return this.minio;
            }
        };
    }
}
