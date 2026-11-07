import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "vitest";

const repository = fileURLToPath(new URL("../", import.meta.url));
test("PostgreSQL replay rejects SQL-only schema drift and accepts the matching snapshot", (t) => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "migration-replay-contract-"),
	);
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, "scripts"));
	fs.mkdirSync(path.join(root, "apps/fixture/drizzle/meta"), {
		recursive: true,
	});
	for (const name of ["check-migrations.ts", "check-migration-replay.ts"])
		fs.copyFileSync(
			path.join(repository, "scripts", name),
			path.join(root, "scripts", name),
		);
	fs.writeFileSync(path.join(root, "apps/fixture/package.json"), "{}");
	fs.symlinkSync(
		path.join(repository, "apps/asset/node_modules"),
		path.join(root, "apps/fixture/node_modules"),
		"dir",
	);
	const initial = JSON.parse(
		fs.readFileSync(
			path.join(repository, "apps/asset/drizzle/meta/_journal.json"),
			"utf8",
		),
	).entries[0];
	fs.writeFileSync(
		path.join(root, "apps/fixture/drizzle/meta/_journal.json"),
		JSON.stringify({ entries: [initial] }),
	);
	const assetRequire = createRequire(
		path.join(repository, "apps/asset/package.json"),
	);
	const { pgView, text } = assetRequire("drizzle-orm/pg-core");
	const { sql: sqlExpression } = assetRequire("drizzle-orm");
	const { generateDrizzleJson } = assetRequire("drizzle-kit/api");
	const summary = pgView("variant_summary", { id: text("id") }).as(
		sqlExpression`SELECT id FROM variants`,
	);
	const snapshot = JSON.parse(
		fs.readFileSync(
			path.join(repository, "apps/asset/drizzle/meta/0000_snapshot.json"),
			"utf8",
		),
	);
	snapshot.views = generateDrizzleJson({ summary }).views;
	fs.writeFileSync(
		path.join(root, "apps/fixture/drizzle/meta/0000_snapshot.json"),
		JSON.stringify(snapshot),
	);
	const viewSql = "CREATE VIEW variant_summary AS SELECT id FROM variants;";
	fs.writeFileSync(
		path.join(root, "generated.config.json"),
		JSON.stringify({
			migrations: { "apps/fixture": { outputs: ["drizzle"] } },
		}),
	);
	const sql = fs.readFileSync(
		path.join(repository, "apps/asset/drizzle", `${initial.tag}.sql`),
		"utf8",
	);
	const reordered = sql.replace(
		'"width" integer NOT NULL,\n\t"height" integer NOT NULL,',
		'"height" integer NOT NULL,\n\t"width" integer NOT NULL,',
	);
	expect(reordered).not.toBe(sql);
	for (const [label, migration, expectedStatus, viewDefinition = viewSql] of [
		["matching", sql, 0],
		["matching with different physical column order", reordered, 0],
		["type", sql.replace('"width" integer', '"width" text'), 1],
		["missing column", `${sql}\nALTER TABLE variants DROP COLUMN width;`, 1],
		[
			"nullability",
			`${sql}\nALTER TABLE variants ALTER COLUMN width DROP NOT NULL;`,
			1,
		],
		[
			"changed view",
			sql,
			1,
			"CREATE VIEW variant_summary AS SELECT storage_key AS id FROM variants;",
		],
		["missing view", sql, 1, ""],
		[
			"residual column",
			`${sql}\nALTER TABLE variants ADD COLUMN unexpected text;`,
			1,
		],
		[
			"missing primary/foreign keys and default",
			sql
				.replaceAll("PRIMARY KEY ", "")
				.replaceAll(" DEFAULT now()", "")
				.replace(/ALTER TABLE[\s\S]*$/, ""),
			1,
		],
		[
			"residual index",
			`${sql}\nCREATE INDEX unexpected ON variants(width);`,
			1,
		],
	]) {
		fs.writeFileSync(
			path.join(root, "apps/fixture/drizzle", `${initial.tag}.sql`),
			`${migration}\n${viewDefinition}`,
		);
		const result = spawnSync(
			process.execPath,
			[path.join(root, "scripts/check-migration-replay.ts")],
			{ encoding: "utf8", timeout: 90_000 },
		);
		expect(result.error, result.error?.message).toBe(undefined);
		expect(result.status, `${label}: ${result.stdout}\n${result.stderr}`).toBe(
			expectedStatus,
		);
		if (expectedStatus)
			expect(result.stderr).toMatch(/schema differs from snapshot/);
	}
});
