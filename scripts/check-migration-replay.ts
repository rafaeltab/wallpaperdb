import type { Generators } from "./lib/agent-types.ts";
interface Column {
	name: string;
}
interface Snapshot {
	tables: Record<
		string,
		{ name: string; schema: string; columns: Record<string, Column> }
	>;
}
interface DrizzleApi {
	generateDrizzleJson(schema: Record<string, unknown>): Snapshot;
	generateMigration(previous: Snapshot, next: Snapshot): Promise<string[]>;
}
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { checkMigrations, checkSchemaDump } from "./check-migrations.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const name = `wallpaperdb-migration-replay-${randomUUID()}`;
const docker = (
	args: string[],
	options: Omit<ExecFileSyncOptions, "encoding"> = {},
) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		timeout: 60_000,
		...options,
	});
try {
	docker([
		"run",
		"--detach",
		"--rm",
		"--name",
		name,
		"-e",
		"POSTGRES_USER=test",
		"-e",
		"POSTGRES_PASSWORD=test",
		"postgres:16-alpine",
	]);
	const deadline = Date.now() + 30_000;
	while (true) {
		try {
			docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "test"], {
				timeout: 2000,
			});
			break;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await setTimeout(100);
		}
	}
	const definitions: Generators[string] = JSON.parse(
		fs.readFileSync(path.join(root, "generated.config.json"), "utf8"),
	).migrations;
	for (const [index, [workspace, { outputs }]] of Object.entries(
		definitions,
	).entries()) {
		const directory = path.join(root, workspace, outputs[0]);
		const errors = checkMigrations(directory);
		if (errors.length) throw new Error(errors.join("\n"));
		const database = `migration_replay_${index}`;
		docker([
			"exec",
			name,
			"createdb",
			"-h",
			"127.0.0.1",
			"-U",
			"test",
			database,
		]);
		const sql = (input: string, selectedDatabase = database) =>
			docker(
				[
					"exec",
					"-i",
					name,
					"psql",
					"-h",
					"127.0.0.1",
					"-X",
					"-qAt",
					"-v",
					"ON_ERROR_STOP=1",
					"-U",
					"test",
					"-d",
					selectedDatabase,
				],
				{ input },
			);
		const journal: { entries: { idx: number; tag: string }[] } = JSON.parse(
			fs.readFileSync(path.join(directory, "meta/_journal.json"), "utf8"),
		);
		const workspaceRequire = createRequire(
			path.join(root, workspace, "package.json"),
		);
		const { generateDrizzleJson, generateMigration }: DrizzleApi =
			workspaceRequire("drizzle-kit/api");
		let snapshot = generateDrizzleJson({});
		for (const entry of journal.entries)
			sql(
				`BEGIN;\n${fs.readFileSync(path.join(directory, `${entry.tag}.sql`), "utf8")}\nCOMMIT;`,
			);
		if (journal.entries.length) {
			const last = journal.entries.at(-1)!.idx;
			snapshot = JSON.parse(
				fs.readFileSync(
					path.join(
						directory,
						"meta",
						`${String(last).padStart(4, "0")}_snapshot.json`,
					),
					"utf8",
				),
			);
			const columns: {
				schema: string;
				table: string;
				column: string;
				ordinal: number;
			}[] = JSON.parse(
				sql(
					`SELECT coalesce(json_agg(json_build_object('schema', table_schema, 'table', table_name, 'column', column_name, 'ordinal', ordinal_position)), '[]') FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema');`,
				),
			);
			// Snapshot property order follows schema source order, while ALTER TABLE
			// appends physical columns. Compare schema semantics without that ordering.
			const ordinals = new Map(
				columns.map((column) => [
					`${column.schema}.${column.table}.${column.column}`,
					column.ordinal,
				]),
			);
			for (const table of Object.values(snapshot.tables)) {
				const ordinal = (column: Column) =>
					ordinals.get(
						`${table.schema || "public"}.${table.name}.${column.name}`,
					) ?? Number.NaN;
				table.columns = Object.fromEntries(
					Object.entries(table.columns).sort(
						([, left], [, right]) => ordinal(left) - ordinal(right),
					),
				);
			}
		}
		const reference = `snapshot_reference_${index}`;
		docker([
			"exec",
			name,
			"createdb",
			"-h",
			"127.0.0.1",
			"-U",
			"test",
			reference,
		]);
		sql(
			(await generateMigration(generateDrizzleJson({}), snapshot)).join("\n"),
			reference,
		);
		const dump = (selectedDatabase: string) =>
			docker([
				"exec",
				name,
				"pg_dump",
				"--schema-only",
				"--no-owner",
				"--no-privileges",
				"-h",
				"127.0.0.1",
				"-U",
				"test",
				"-d",
				selectedDatabase,
			]);
		const differences = checkSchemaDump(dump(reference), dump(database));
		if (differences.length)
			throw new Error(`${workspace}: ${differences.join("\n")}`);
		console.log(
			`${workspace}: ${journal.entries.length} migrations replayed; PostgreSQL schema matches snapshot.`,
		);
	}
} finally {
	docker(["rm", "--force", name]);
}
