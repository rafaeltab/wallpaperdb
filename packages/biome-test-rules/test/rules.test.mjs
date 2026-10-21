import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const biome = join(
	dirname(require.resolve("@biomejs/biome/package.json")),
	"bin/biome",
);

function lint(source, files = {}) {
	const directory = mkdtempSync(join(tmpdir(), "biome-test-rules-"));
	try {
		const config = JSON.parse(
			readFileSync(join(workspace, "test-correctness.json"), "utf8"),
		);
		config.plugins = config.plugins.map((path) => join(workspace, path));
		writeFileSync(join(directory, "biome.json"), JSON.stringify(config));
		symlinkSync(
			join(workspace, "node_modules"),
			join(directory, "node_modules"),
		);
		writeFileSync(join(directory, "example.test.ts"), source);
		for (const [path, content] of Object.entries(files))
			writeFileSync(join(directory, path), content);
		const result = spawnSync(
			process.execPath,
			[biome, "lint", "--reporter=json", "example.test.ts"],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		assert.equal(result.error, undefined);
		assert.ok(result.status === 0 || result.status === 1, result.stderr);
		const report = JSON.parse(result.stdout);
		return report.diagnostics;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("incomplete expect calls fail, including accidental two-argument assertions", () => {
	for (const source of ["expect(1);", "expect(1, 2);", "expect(1).not;"])
		assert.ok(
			lint(`import { expect } from 'vitest'; ${source}`).some((d) =>
				d.message.includes("Complete the assertion"),
			),
			source,
		);
	for (const source of [
		"expect(1, 'reason').toBe(1);",
		"expect(1).not.toBe(2);",
	])
		assert.deepEqual(
			lint(`import { expect } from 'vitest'; ${source}`),
			[],
			source,
		);
});
