---
name: database-schema
description: Drizzle ORM workflow for modifying the database schema in any service. Use when adding columns, creating tables, changing enums, or applying migrations.
---

# Database Schema

This only applies to services that use a relational database.

## Workflow

Schema changes always follow this sequence:

1. **Edit `src/db/schema.ts`** — define tables, columns, enums, and indexes in Drizzle ORM syntax
2. **Generate the migration** — Drizzle diffs the current schema against the last snapshot and writes a new SQL file to `drizzle/`
3. **Review the generated SQL** — open the new file in `drizzle/` and verify the SQL is exactly what you intended before applying
4. **Apply the migration** — run the migration against the target database

Never hand-write SQL migration files. Always generate them from the schema.

## Commands

All database commands are pnpm scripts scoped per service. They are **not yet in the Makefile** — run them directly:

```bash
# Generate a new migration from schema changes
pnpm --filter @wallpaperdb/<service> db:generate

# Push schema directly to DB without a migration file (dev/local only — never use in production)
pnpm --filter @wallpaperdb/<service> db:push

# Apply all pending migrations
pnpm --filter @wallpaperdb/<service> db:migrate

# Open Drizzle Studio (visual DB browser)
pnpm --filter @wallpaperdb/<service> db:studio
```

Replace `<service>` with the service name, e.g. `ingestor`.

## Configuration

Each service has a `drizzle.config.ts` at its root. It points to:

- `schema` — the Drizzle schema file (`./src/db/schema.ts`)
- `out` — the migrations output directory (`./drizzle`)
- `dialect` — `postgresql`
- `dbCredentials.url` — reads from `DATABASE_URL` environment variable

The `drizzle/` directory contains:
- `<sequence>_<name>.sql` — the generated SQL for each migration
- `meta/_journal.json` — migration history used by Drizzle Kit
- `meta/<sequence>_snapshot.json` — schema snapshot used for diffing

## Schema Conventions

Follow the patterns established in `apps/ingestor/src/db/schema.ts`:

- **Table IDs** use `text` primary keys in the format `<prefix>_<ulid>` (e.g. `wlpr_<ulid>`)
- **Enums** are defined with `pgEnum` at the top of the schema file and exported
- **Nullable columns** are fine — use them for fields that populate in later lifecycle stages
- **Conditional unique indexes** use `.where(sql\`...\`)` to enforce uniqueness only in specific states (see the content hash dedup index in ingestor as a reference)
- **Timestamps** use `timestamp(..., { withTimezone: true })` with `.defaultNow()`
- **Type exports** — always export `typeof table.$inferSelect` and `typeof table.$inferInsert` types for use in service code

## Infrastructure Requirement

Migrations require a running PostgreSQL instance. Start infrastructure before running `db:migrate` or `db:push`:

```bash
make infra-start
```
