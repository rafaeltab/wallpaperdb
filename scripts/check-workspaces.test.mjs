import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWorkspaces } from "./check-workspaces.mjs";
test("workspace audit checks membership, task graph and application dependencies", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-audit-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const write = (file, data) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(
			path.join(root, file),
			typeof data === "string" ? data : JSON.stringify(data),
		);
	};
	write("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
	write("package.json", { name: "root" });
	write("turbo.json", { tasks: { lint: {}, "check-types": {} } });
	write("apps/api/package.json", {
		name: "api",
		scripts: { lint: "biome lint .", "check-types": "tsc" },
	});
	write("packages/shared/package.json", {
		name: "shared",
		scripts: { lint: "biome lint ." },
		dependencies: { api: "workspace:*" },
	});
	assert.ok(
		checkWorkspaces(root).some((e) =>
			e.includes("shared must not depend on application api"),
		),
	);
	write("packages/shared/package.json", {
		name: "shared",
		scripts: { lint: "biome lint ." },
	});
	assert.deepEqual(checkWorkspaces(root), []);
	write("packages/shared/src/index.ts", "export const value=1;");
	assert.ok(checkWorkspaces(root).some((e) => e.includes("check-types")));
});
