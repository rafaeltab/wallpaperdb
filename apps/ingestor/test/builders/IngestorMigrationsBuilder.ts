import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import createPostgresClient from "postgres";
import {
	BaseTesterBuilder,
	type PostgresTesterBuilder,
	type AddMethodsType,
} from "@wallpaperdb/test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Options for IngestorMigrationsMixin
 */
export interface IngestorMigrationsOptions {
	/** Path to migration SQL file (relative to workspace root) */
	migrationPath?: string;
}

/**
 * Mixin that applies Ingestor database migrations to PostgreSQL.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
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
			join(__dirname, "../../drizzle/0000_left_starjammers.sql");

		return class extends Base {
			override async setup(): Promise<void> {
				await super.setup();

				const postgres = this.getPostgres();

				if (!postgres) {
					throw new Error(
						"PostgresTesterBuilder must be applied before IngestorMigrationsTesterBuilder",
					);
				}

				console.log("Applying ingestor database migrations...");

				const sql = createPostgresClient(postgres.connectionString, { max: 1 });

				try {
					const migrationSql = readFileSync(migrationPath, "utf-8");
					await sql.unsafe(migrationSql);
					console.log("Database migrations applied successfully");
				} finally {
					await sql.end();
				}
			}
		};
	}
}
