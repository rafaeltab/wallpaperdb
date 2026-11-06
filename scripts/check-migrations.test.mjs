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
