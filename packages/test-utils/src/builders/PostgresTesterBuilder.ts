import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type AddMethodsType, BaseTesterBuilder } from '../framework.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';

export interface PostgresOptions {
  image: string;
  database: string;
  username: string;
  password: string;
  networkAlias: string;
}

class PostgresBuilder {
  private image = 'postgres:16-alpine';
  private database = `test_db_${Date.now()}`;
  private username = 'test';
  private password = 'test';
  private networkAlias = 'postgres';

  withImage(image: string) {
    this.image = image;
    return this;
  }

  withDatabase(db: string) {
    this.database = db;
    return this;
  }

  withUser(username: string) {
    this.username = username;
    return this;
  }

  withPassword(password: string) {
    this.password = password;
    return this;
  }

  withNetworkAlias(alias: string) {
    this.networkAlias = alias;
    return this;
  }

  build(): PostgresOptions {
    return {
      image: this.image,
      database: this.database,
      username: this.username,
      password: this.password,
      networkAlias: this.networkAlias,
    };
  }
}

export interface PostgresConfig {
  container: StartedPostgreSqlContainer;
  connectionString: string;
  host: string;
  port: number;
  database: string;
  options: PostgresOptions;
}

export class PostgresTesterBuilder extends BaseTesterBuilder<'postgres', [DockerTesterBuilder]> {
  name = 'postgres' as const;

  addMethods<TBase extends AddMethodsType<[DockerTesterBuilder]>>(Base: TBase) {
    return class Postgres extends Base {
      postgres: PostgresConfig | undefined;
      withPostgres(configure: (pg: PostgresBuilder) => PostgresBuilder = (a) => a) {
        const options = configure(new PostgresBuilder()).build();
        const { image, database, username, password, networkAlias } = options;

        this.addSetupHook(async () => {
          console.log('Starting PostgreSQL container...');

          // Check if network is available (properly typed now!)
          const dockerNetwork = this.docker.network;

          let container = new PostgreSqlContainer(image)
            .withDatabase(database)
            .withUsername(username)
            .withPassword(password);

          if (dockerNetwork) {
            container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
          }

          const started = await container.start();

          // Build connection strings
          const host = dockerNetwork ? networkAlias : started.getHost();
          const port = dockerNetwork ? 5432 : started.getPort();

          const connectionString = dockerNetwork
            ? `postgresql://${username}:${password}@${host}:5432/${database}`
            : started.getConnectionUri();

          this.postgres = {
            container: started,
            connectionString: connectionString,
            host: host,
            port: port,
            database: database,
            options: options,
          };

          console.log(`PostgreSQL started: ${connectionString}`);
        });

        this.addDestroyHook(async () => {
          if (this.postgres) {
            console.log('Stopping PostgreSQL container...');
            await this.postgres.container.stop();
          }
        });

        return this;
      }

      getPostgres() {
        if (!this.postgres) {
          throw new Error('PostgreSQL not initialized. Call withPostgres() and setup() first.');
        }
        return this.postgres;
      }
    };
  }
}
