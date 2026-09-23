import { fileURLToPath } from 'node:url';
import {
  type AddMethodsType,
  BaseTesterBuilder,
  type PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export interface IngestorMigrationsOptions {
  readonly migrationsFolder?: string;
}

/** Applies every checked-in SQL migration without importing application code. */
export class IngestorMigrationsTesterBuilder extends BaseTesterBuilder<
  'IngestorMigrations',
  [PostgresTesterBuilder]
> {
  readonly name = 'IngestorMigrations';
  constructor(private readonly options: IngestorMigrationsOptions = {}) {
    super();
  }
  addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(Base: TBase) {
    const migrationsFolder =
      this.options.migrationsFolder ??
      fileURLToPath(new URL('../../../ingestor/drizzle', import.meta.url));
    return class extends Base {
      withMigrations() {
        this.addSetupHook(async () => {
          const postgres = this.getPostgres();
          if (!postgres) throw new Error('PostgreSQL must start before migrations');
          const pool = new Pool({ connectionString: postgres.connectionStrings.fromHost });
          try {
            await migrate(drizzle(pool), { migrationsFolder });
          } finally {
            await pool.end();
          }
        });
        return this;
      }
    };
  }
}
