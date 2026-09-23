import {
  type AddMethodsType,
  BaseTesterBuilder,
  type DockerTesterBuilder,
  type S3TesterBuilder,
  type NatsTesterBuilder,
  type PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export interface ContainerizedIngestorOptions {
  readonly image?: string;
}

/** Starts the deployed artifact using only infrastructure addresses and public configuration. */
export class ContainerizedIngestorTesterBuilder extends BaseTesterBuilder<
  'ContainerizedIngestor',
  [DockerTesterBuilder, PostgresTesterBuilder, S3TesterBuilder, NatsTesterBuilder]
> {
  readonly name = 'ContainerizedIngestor';
  constructor(private readonly options: ContainerizedIngestorOptions = {}) {
    super();
  }

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, PostgresTesterBuilder, S3TesterBuilder, NatsTesterBuilder]
    >,
  >(Base: TBase) {
    const image = this.options.image ?? 'wallpaperdb-ingestor:latest';
    return class extends Base {
      private application?: StartedTestContainer;
      withContainerizedApp() {
        this.addSetupHook(async () => {
          const postgres = this.getPostgres();
          const s3 = this.getS3();
          const nats = this.getNats();
          if (!postgres || !s3 || !nats)
            throw new Error('Ingestor requires PostgreSQL, S3, and NATS');
          this.application = await new GenericContainer(image)
            .withNetwork(this.getNetwork())
            .withEnvironment({
              NODE_ENV: 'test',
              PORT: '3001',
              DATABASE_URL: postgres.connectionStrings.networked,
              S3_ENDPOINT: s3.endpoints.networked,
              S3_ACCESS_KEY_ID: s3.options.accessKey,
              S3_SECRET_ACCESS_KEY: s3.options.secretKey,
              S3_BUCKET: 'wallpapers',
              S3_REGION: 'us-east-1',
              NATS_URL: nats.endpoints.networked,
              NATS_STREAM: 'WALLPAPER',
              REDIS_ENABLED: 'false',
              RECONCILIATION_INTERVAL_MS: '1000',
              S3_CLEANUP_INTERVAL_MS: '3600000',
            })
            .withExposedPorts(3001)
            .withWaitStrategy(
              Wait.forHttp('/ready', 3001).forStatusCode(200).withStartupTimeout(60000)
            )
            .start();
        });
        this.addDestroyHook(async () => {
          await this.application?.stop();
        });
        return this;
      }
      getBaseUrl(): string {
        if (!this.application) throw new Error('Ingestor has not started');
        return `http://${this.application.getHost()}:${this.application.getMappedPort(3001)}`;
      }
    };
  }
}
