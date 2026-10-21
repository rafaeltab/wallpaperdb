import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AddMethodsType,
  BaseTesterBuilder,
  type PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import createPostgresClient from 'postgres';
import { createTestLogger } from '@wallpaperdb/test-logger';

const logger = createTestLogger('AssetMigrationsBuilder');

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Options for AssetMigrationsMixin
 */
export interface AssetMigrationsOptions {
  /** Path to migration SQL file (relative to workspace root) */
  migrationPath?: string;
}

/**
 * Mixin that applies Asset service database migrations to PostgreSQL.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(AssetMigrationsTesterBuilder)
 *   .build();
 * ```
 */
export class AssetMigrationsTesterBuilder extends BaseTesterBuilder<
  'AssetMigrations',
  [PostgresTesterBuilder]
> {
  readonly name = 'AssetMigrations' as const;
  private options: AssetMigrationsOptions;

  constructor(options: AssetMigrationsOptions = {}) {
    super();
    this.options = options;
  }

  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    const migrationDirectory = join(__dirname, '../../drizzle');
    const migrationPaths = this.options.migrationPath
      ? [this.options.migrationPath]
      : readdirSync(migrationDirectory)
          .filter((path) => path.endsWith('.sql'))
          .sort()
          .map((path) => join(migrationDirectory, path));

    return class extends Base {
      _migrationsApplied = false;

      /**
       * Enable automatic database migration during setup.
       * Migrations are idempotent and safe to call multiple times.
       */
      withMigrations() {
        if (this._migrationsApplied) {
          return this; // Already registered
        }
        this._migrationsApplied = true;

        this.addSetupHook(async () => {
          logger.debug('[AssetMigrations] Running migration hook');
          const postgres = this.getPostgres();

          if (!postgres) {
            throw new Error(
              'PostgresTesterBuilder must be applied before AssetMigrationsTesterBuilder'
            );
          }

          logger.debug('Applying asset service database migrations...');

          const sql = createPostgresClient(postgres.connectionStrings.fromHost, { max: 1 });

          try {
            for (const migrationPath of migrationPaths) {
              await sql.unsafe(readFileSync(migrationPath, 'utf-8'));
            }
            logger.debug('Database migrations applied successfully');
          } finally {
            await sql.end();
          }
        });

        return this;
      }
    };
  }
}
