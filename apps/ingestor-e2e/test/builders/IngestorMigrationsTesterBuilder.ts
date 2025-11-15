import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    type AddMethodsType,
    BaseTesterBuilder,
    type PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Options for IngestorMigrationsMixin
 */
export interface IngestorMigrationsOptions {
    /** Path to migration SQL file (relative to workspace root) */
    migrationPath?: string;
}

/**
 * Mixin that applies Ingestor database migrations to PostgreSQL (E2E version).
 *
 * @example
 * ```typescript
 * const tester = await createDefaultTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(IngestorMigrationsTesterBuilder)
 *   .build();
 * ```
 */
export class IngestorMigrationsTesterBuilder extends BaseTesterBuilder<
    "IngestorMigrations",
    [PostgresTesterBuilder]
> {
    readonly name = "IngestorMigrations" as const;
    private options: IngestorMigrationsOptions;

    constructor(options: IngestorMigrationsOptions = {}) {
        super();
        this.options = options;
    }

    addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(
        Base: TBase,
    ) {
        const migrationPath =
            this.options.migrationPath ??
            join(__dirname, "../../../ingestor/drizzle/0000_left_starjammers.sql");

        return class extends Base {
            private _migrationsApplied = false;

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
                    console.log("[IngestorMigrations] Running migration hook");
                    const postgres = this.getPostgres();

                    if (!postgres) {
                        throw new Error(
                            "PostgresTesterBuilder must be applied before IngestorMigrationsTesterBuilder",
                        );
                    }

                    console.log("Applying ingestor database migrations...");

                    // Use externalConnectionString for host-to-container communication
                    // postgres.connectionString uses network alias which isn't accessible from host
                    const pool = new Pool({
                        connectionString: postgres.externalConnectionString,
                    });

                    try {
                        const migrationSql = readFileSync(migrationPath, "utf-8");
                        console.log("Read migrations, applying...");
                        await pool.query(migrationSql);
                        console.log("Database migrations applied successfully");
                    } finally {
                        await pool.end();
                    }
                });

                return this;
            }
        };
    }
}
