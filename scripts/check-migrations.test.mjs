import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkMigrations } from "./check-migrations.mjs";
test("migration metadata requires SQL, ordered journals and linked snapshots", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-audit-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, "meta"));
	const write = (file, data) =>
		fs.writeFileSync(
			path.join(root, file),
			typeof data === "string" ? data : JSON.stringify(data),
		);
	write("meta/_journal.json", {
		entries: [{ idx: 0, tag: "0000_initial", when: 1 }],
	});
	write("meta/0000_snapshot.json", {
		id: "first",
		prevId: "00000000-0000-0000-0000-000000000000",
	});
	assert.ok(checkMigrations(root).some((e) => e.includes("SQL")));
	write("0000_initial.sql", "create table example(id int);");
	assert.deepEqual(checkMigrations(root), []);
	write("meta/_journal.json", {
		entries: [{ idx: 1, tag: "0000_initial", when: 1 }],
	});
	assert.ok(checkMigrations(root).some((e) => e.includes("index")));
});

import { checkSchemaColumns } from "./check-migrations.mjs";
test("replayed columns retain snapshot nullability and membership", () => {
	const snapshot = {
		tables: {
			"public.example": {
				schema: "",
				name: "example",
				columns: { id: { name: "id", notNull: true } },
			},
		},
	};
	assert.deepEqual(
		checkSchemaColumns(snapshot, [
			{ schema: "public", table: "example", column: "id", notNull: true },
		]),
		[],
	);
	assert.ok(
		checkSchemaColumns(snapshot, [
			{ schema: "public", table: "example", column: "id", notNull: false },
		]).length,
	);
	assert.ok(checkSchemaColumns(snapshot, []).length);
	assert.ok(
		checkSchemaColumns(snapshot, [
			{ schema: "public", table: "example", column: "id", notNull: true },
			{
				schema: "public",
				table: "example",
				column: "unexpected",
				notNull: false,
			},
		]).length,
	);
});
