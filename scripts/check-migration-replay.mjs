import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkMigrations, checkSchemaColumns } from "./check-migrations.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const name = `wallpaperdb-migration-replay-${randomUUID()}`;
const docker = (args, options = {}) =>
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
	const definitions = JSON.parse(
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
		const sql = (input) =>
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
					database,
				],
				{ input },
			);
		const journal = JSON.parse(
			fs.readFileSync(path.join(directory, "meta/_journal.json"), "utf8"),
		);
		for (const entry of journal.entries)
			sql(
				`BEGIN;\n${fs.readFileSync(path.join(directory, `${entry.tag}.sql`), "utf8")}\nCOMMIT;`,
			);
		if (journal.entries.length) {
			const last = journal.entries.at(-1).idx;
			const snapshot = JSON.parse(
				fs.readFileSync(
					path.join(
						directory,
						"meta",
						`${String(last).padStart(4, "0")}_snapshot.json`,
					),
					"utf8",
				),
			);
			const columns = JSON.parse(
				sql(
					`SELECT coalesce(json_agg(json_build_object('schema', table_schema, 'table', table_name, 'column', column_name, 'notNull', is_nullable = 'NO')), '[]') FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema');`,
				),
			);
			const differences = checkSchemaColumns(snapshot, columns);
			if (differences.length)
				throw new Error(`${workspace}: ${differences.join("\n")}`);
		}
		console.log(
			`${workspace}: ${journal.entries.length} migrations replayed; snapshot columns and nullability verified.`,
		);
	}
} finally {
	docker(["rm", "--force", name]);
}
