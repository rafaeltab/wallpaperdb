import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import createPostgresClient, { type ParameterOrJSON, type Sql as PostgresType } from 'postgres';
import { type AddMethodsType, BaseTesterBuilder, type TesterInstance } from '../framework.js';
import type { CleanupTesterBuilder } from './CleanupTesterBuilder.js';
import type { DestroyTesterBuilder } from './DestroyTesterBuilder.js';
import type { DockerTesterBuilder } from './DockerTesterBuilder.js';
import type { SetupTesterBuilder } from './SetupTesterBuilder.js';

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
  connectionStrings: {
    networked: string;
    fromHost: string;
    fromHostDockerInternal: string;
  };
  database: string;
  options: PostgresOptions;
}

/**
 * Helper class providing namespaced PostgreSQL operations.
 * Manages a cached postgres.js client connection and provides query/cleanup helpers.
 */
class PostgresHelpers {
  private client: PostgresType | undefined;

  constructor(private tester: TesterInstance<PostgresTesterBuilder>) {}

  /**
   * Get the PostgreSQL configuration.
   * @throws Error if PostgreSQL not initialized
   */
  get config(): PostgresConfig {
    const config = this.tester._postgresConfig;
    if (!config) {
      throw new Error('PostgreSQL not initialized. Call withPostgres() and setup() first.');
    }
    return config;
  }

  /**
   * Get a cached postgres.js client connection.
   * Creates the connection on first access and reuses it.
   *
   * Uses the external connection string (host-accessible) for operations initiated from test code.
   * This ensures compatibility with Docker networks where internal aliases aren't resolvable from host.
   *
   * @returns postgres.js client
   *
   * @example
   * ```typescript
   * const client = tester.postgres.getClient();
   * const result = await client`SELECT * FROM users`;
   * ```
   */
  getClient(): PostgresType {
    if (!this.client) {
      this.client = createPostgresClient(this.config.connectionStrings.fromHost, {
        max: 10,
      });
    }
    return this.client;
  }

  /**
   * Execute a SQL query with optional parameters.
   * Provides a simpler interface than the tagged template syntax.
   *
   * @param sql - SQL query string
   * @param params - Optional query parameters
   * @returns Query results
   *
   * @example
   * ```typescript
   * const users = await tester.postgres.query('SELECT * FROM users WHERE id = $1', [userId]);
   * const allUsers = await tester.postgres.query('SELECT * FROM users');
   * ```
   */
  async query<T = unknown>(sql: string, params?: ParameterOrJSON<never>[]): Promise<T[]> {
    const client = this.getClient();
    if (params) {
      const result = await client.unsafe(sql, params);
      return Array.from(result) as T[];
    }
    const result = await client.unsafe(sql);
    return Array.from(result) as T[];
  }

  /**
   * Truncate a single table with CASCADE.
   * Useful for cleaning up test data between tests.
   *
   * @param tableName - Name of the table to truncate
   *
   * @example
   * ```typescript
   * await tester.postgres.truncateTable('wallpapers');
   * ```
   */
  async truncateTable(tableName: string): Promise<void> {
    await this.query(`TRUNCATE TABLE ${tableName} CASCADE`);
  }

  /**
   * Truncate all tables in the public schema.
   * This is a comprehensive cleanup operation.
   *
   * @example
   * ```typescript
   * await tester.postgres.truncateAllTables();
   * ```
   */
  async truncateAllTables(): Promise<void> {
    const tables = await this.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    if (tables.length > 0) {
      const tableNames = tables.map((t) => t.tablename).join(', ');
      await this.query(`TRUNCATE TABLE ${tableNames} CASCADE`);
    }
  }

  /**
   * Close the postgres.js client connection.
   * This is called automatically during the destroy phase.
   *
   * @example
   * ```typescript
   * await tester.postgres.close();
   * ```
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = undefined;
    }
  }
}

export class PostgresTesterBuilder extends BaseTesterBuilder<
  'postgres',
  [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
> {
  name = 'postgres' as const;

  addMethods<
    TBase extends AddMethodsType<
      [DockerTesterBuilder, SetupTesterBuilder, DestroyTesterBuilder, CleanupTesterBuilder]
    >,
  >(Base: TBase) {
    return class Postgres extends Base {
      /** @internal - internal config storage (renamed to avoid conflict) */
      _postgresConfig: PostgresConfig | undefined;

      /** @internal - cleanup tracking */
      _postgresCleanupTables: string[] = [];

      // Public: helper instance
      readonly postgres = new PostgresHelpers(this);
      /**
       * Configure and start a PostgreSQL container.
       *
       * @param configure - Optional configuration callback
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withPostgres(b =>
       *   b.withDatabase('test_db')
       *    .withUser('testuser')
       *    .withPassword('testpass')
       * );
       * ```
       */
      withPostgres(configure: (pg: PostgresBuilder) => PostgresBuilder = (a) => a) {
        const options = configure(new PostgresBuilder()).build();
        const { image, database, username, password, networkAlias } = options;

        this.addSetupHook(async () => {
          console.log('Starting PostgreSQL container...');

          // Check if network is available (properly typed now!)
          const dockerNetwork = this.docker?.network;

          let container = new PostgreSqlContainer(image)
            .withDatabase(database)
            .withUsername(username)
            .withPassword(password);

          if (dockerNetwork) {
            container = container.withNetwork(dockerNetwork).withNetworkAliases(networkAlias);
          }

          const started = await container.start();

          const connectionStrings = {
            networked: `postgresql://${username}:${password}@${networkAlias}:5432/${database}`,
            fromHost: started.getConnectionUri().replace('localhost', '127.0.0.1'),
            fromHostDockerInternal: `postgresql://${username}:${password}@host.docker.internal:${started.getPort()}/${database}`,
          };

          this._postgresConfig = {
            container: started,
            connectionStrings: connectionStrings,
            database: database,
            options: options,
          };

          console.log(
            `PostgreSQL started: ${connectionStrings.networked} (networked) ${connectionStrings.fromHost} (from host) ${connectionStrings.fromHostDockerInternal} (host.docker.internal)`
          );
        });

        this.addDestroyHook(async () => {
          await this.postgres.close(); // Close client before stopping container
          if (this._postgresConfig) {
            console.log('Stopping PostgreSQL container...');
            await this._postgresConfig.container.stop();
          }
        });

        return this;
      }

      /**
       * Enable automatic cleanup of specified tables in cleanup phase.
       * Tables are truncated when tester.cleanup() is called.
       *
       * @param tables - Array of table names to truncate
       * @returns this for chaining
       *
       * @example
       * ```typescript
       * tester.withPostgres()
       *       .withAutoCleanup(['wallpapers', 'users']);
       *
       * // In beforeEach:
       * await tester.cleanup(); // Truncates wallpapers and users tables
       * ```
       */
      withPostgresAutoCleanup(tables: string[]) {
        this._postgresCleanupTables = tables;
        this.addCleanupHook(async () => {
          for (const table of this._postgresCleanupTables) {
            await this.postgres.truncateTable(table);
          }
        });
        return this;
      }

      /**
       * Get PostgreSQL configuration.
       * Backward compatibility method - prefer using tester.postgres.config
       *
       * @returns PostgreSQL configuration object
       * @throws Error if PostgreSQL not initialized
       *
       * @example
       * ```typescript
       * const config = tester.getPostgres();
       * console.log(config.connectionString);
       * ```
       */
      getPostgres(): PostgresConfig {
        return this.postgres.config;
      }
    };
  }
}
