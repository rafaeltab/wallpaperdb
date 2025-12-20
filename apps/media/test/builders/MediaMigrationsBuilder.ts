import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AddMethodsType,
	BaseTesterBuilder,
	type PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import createPostgresClient from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Options for MediaMigrationsMixin
 */
export interface MediaMigrationsOptions {
	/** Path to migration SQL file (relative to workspace root) */
	migrationPath?: string;
}

/**
 * Mixin that applies Media service database migrations to PostgreSQL.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(MediaMigrationsTesterBuilder)
 *   .build();
 * ```
 */
export class MediaMigrationsTesterBuilder extends BaseTesterBuilder<
	"MediaMigrations",
	[PostgresTesterBuilder]
> {
	readonly name = "MediaMigrations" as const;
	private options: MediaMigrationsOptions;

	constructor(options: MediaMigrationsOptions = {}) {
		super();
		this.options = options;
	}

	addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(
		Base: TBase) {
		const migrationPath =
			this.options.migrationPath ??
			join(__dirname, "../../drizzle/0000_mute_the_professor.sql");

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
					console.log("[MediaMigrations] Running migration hook");
					const postgres = this.getPostgres();

					if (!postgres) {
						throw new Error(
							"PostgresTesterBuilder must be applied before MediaMigrationsTesterBuilder",
						);
					}

					console.log("Applying media service database migrations...");

					const sql = createPostgresClient(
						postgres.connectionStrings.fromHost,
						{ max: 1 },
					);

					try {
						const migrationSql = readFileSync(migrationPath, "utf-8");
						await sql.unsafe(migrationSql);
						console.log("Database migrations applied successfully");
					} finally {
						await sql.end();
					}
				});

				return this;
			}
		};
	}
}
