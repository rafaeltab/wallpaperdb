import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { checkMigrations } from "./check-migrations.ts";
test("migration metadata requires SQL, ordered journals and linked snapshots", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-audit-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, "meta"));
	const write = (file: string, data: unknown) =>
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
	expect(checkMigrations(root).some((e) => e.includes("SQL"))).toBeTruthy();
	write("0000_initial.sql", "create table example(id int);");
	expect(checkMigrations(root)).toStrictEqual([]);
	write("meta/_journal.json", {
		entries: [{ idx: 1, tag: "0000_initial", when: 1 }],
	});
	expect(checkMigrations(root).some((e) => e.includes("index"))).toBeTruthy();
});
