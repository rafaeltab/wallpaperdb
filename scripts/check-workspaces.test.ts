import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { checkWorkspaces } from "./check-workspaces.ts";
test("workspace audit checks membership, task graph and application dependencies", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-audit-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
	const write = (file: string, data: unknown) => {
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
	expect(
		checkWorkspaces(root).some((e) =>
			e.includes("shared must not depend on application api"),
		),
	).toBeTruthy();
	write("packages/shared/package.json", {
		name: "shared",
		scripts: { lint: "biome lint ." },
	});
	expect(checkWorkspaces(root)).toStrictEqual([]);
	write("packages/shared/src/index.ts", "export const value=1;");
	expect(
		checkWorkspaces(root).some((e) => e.includes("check-types")),
	).toBeTruthy();
	fs.rmSync(path.join(root, "packages/shared/package.json"));
	fs.rmSync(path.join(root, "packages/shared/src/index.ts"));
	write("packages/shared/src/index.js", "export const value=1;");
	expect(
		checkWorkspaces(root).some((e) => e.includes("owning package.json")),
	).toBeTruthy();
});
