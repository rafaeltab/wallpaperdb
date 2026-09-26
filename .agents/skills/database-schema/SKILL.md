---
name: database-schema
description: Drizzle migration workflow. Use when changing a relational schema or applying migrations.
---

# Database schema

1. Read the service's `drizzle.config.ts` to find its schema and migration directory.
2. Edit the schema, then generate the migration. Never hand-write migration files.
3. Review the generated SQL and snapshots before applying them.
4. Apply the migration against the intended database. Verify the behavior and relevant persistence constraints.

```sh
make run PACKAGE=<service> SCRIPT=db:generate
make migrate PACKAGE=<service>
```

Migrations need a running database. Use `make infra-start` for local infrastructure and check the service's generated environment before applying. Direct schema push is for disposable development databases only, never production.

The schema and configuration are the source for column conventions and migration paths. Use the [persistence guidelines](../../../docs/coding-standards/adapters.md#persistence-adapters) for requirements that apply beyond the current implementation.
