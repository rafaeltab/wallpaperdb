import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("rebuilding identical output preserves the watched file, while a source change updates it", () => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "profile-markdown-build-"),
	);
	const script = fileURLToPath(new URL("../build.mjs", import.meta.url));
	const compile = () => {
		const result = spawnSync(process.execPath, [script], {
			cwd: root,
			encoding: "utf8",
			timeout: 5000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
	};
	try {
		fs.mkdirSync(path.join(root, "src"));
		const source = path.join(root, "src/index.ts");
		const output = path.join(root, "dist/index.js");
		fs.writeFileSync(source, 'export const marker = "first";\n');
		compile();
		expect(fs.readFileSync(output, "utf8")).toContain('"first"');
		const original = fs.statSync(output, { bigint: true });
		compile();
		expect(fs.statSync(output, { bigint: true }).mtimeNs).toBe(
			original.mtimeNs,
		);
		fs.writeFileSync(source, 'export const marker = "second";\n');
		compile();
		expect(fs.readFileSync(output, "utf8")).toContain('"second"');
		expect(fs.readFileSync(output, "utf8")).not.toContain('"first"');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
