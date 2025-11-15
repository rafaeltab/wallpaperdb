import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
    BaseTesterBuilder,
    type PostgresTesterBuilder,
    type AddMethodsType,
    DestroyTesterBuilder,
} from "@wallpaperdb/test-utils";
import * as schema from "../../src/db/schema.js";

const { Pool } = pg;

/**
 * Extends PostgresTesterBuilder with Drizzle ORM support for the Ingestor service.
 * Provides a getDrizzle() method that returns a configured Drizzle instance.
 *
 * @example
 * ```typescript
 * const tester = await createTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .with(IngestorDrizzleTesterBuilder)
 *   .build();
 *
 * const db = tester.postgres.getDrizzle();
 * await db.insert(wallpapers).values({...});
 * ```
 */
export class IngestorDrizzleTesterBuilder extends BaseTesterBuilder<
    "IngestorDrizzle",
    [PostgresTesterBuilder, DestroyTesterBuilder]
> {
    readonly name = "IngestorDrizzle" as const;

    addMethods<TBase extends AddMethodsType<[PostgresTesterBuilder]>>(
        Base: TBase,
    ) {
        return class extends Base {
            private _drizzleInstance: NodePgDatabase<typeof schema> | undefined;
            private _drizzlePool: pg.Pool | undefined;

            /**
             * Get a cached Drizzle ORM instance for the Ingestor schema.
             * Creates the instance on first access and reuses it.
             *
             * @returns Drizzle ORM instance with Ingestor schema
             *
             * @example
             * ```typescript
             * const db = tester.postgres.getDrizzle();
             * await db.insert(wallpapers).values({ id: 'wlpr_123', ... });
             * const records = await db.query.wallpapers.findMany();
             * ```
             */
            getDrizzle(): NodePgDatabase<typeof schema> {
                const postgres = this.getPostgres();

                if (!this._drizzleInstance) {
                    // Create a node-postgres pool (not postgres.js)
                    this._drizzlePool = new Pool({
                        connectionString: postgres.externalConnectionString,
                        max: 10,
                    });

                    this._drizzleInstance = drizzle(this._drizzlePool, { schema });

                    this.addDestroyHook(async () => {
                        if (this._drizzlePool) {
                            this._drizzlePool.end();

                            this._drizzlePool = undefined;
                            this._drizzleInstance = undefined;
                        }
                    });
                }

                return this._drizzleInstance;
            }
        };
    }
}
