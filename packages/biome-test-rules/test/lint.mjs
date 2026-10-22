import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const biome = join(
	dirname(require.resolve("@biomejs/biome/package.json")),
	"bin/biome",
);

export function lint(
	source,
	files = {},
	filename = "example.test.ts",
	reporter = "json",
) {
	const directory = mkdtempSync(join(tmpdir(), "biome-test-rules-"));
	try {
		const config = JSON.parse(
			readFileSync(join(workspace, "test-correctness.json"), "utf8"),
		);
		config.linter = { rules: { preset: "none" } };
		config.plugins = config.plugins.map((plugin) => ({
			...plugin,
			path: join(workspace, plugin.path),
		}));
		writeFileSync(join(directory, "biome.json"), JSON.stringify(config));
		symlinkSync(
			join(workspace, "node_modules"),
			join(directory, "node_modules"),
		);
		mkdirSync(dirname(join(directory, filename)), { recursive: true });
		writeFileSync(join(directory, filename), source);
		for (const [path, content] of Object.entries(files))
			writeFileSync(join(directory, path), content);
		const result = spawnSync(
			process.execPath,
			[
				biome,
				"lint",
				...(reporter === "json" ? ["--reporter=json"] : []),
				filename,
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		assert.equal(result.error, undefined);
		assert.ok(result.status === 0 || result.status === 1, result.stderr);
		if (reporter !== "json") return result.stdout + result.stderr;
		assert.ok(result.stdout, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.ok(
			!report.diagnostics.some((d) => /Rule .* errored:/.test(d.message)),
			JSON.stringify(report.diagnostics),
		);
		return report.diagnostics;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
