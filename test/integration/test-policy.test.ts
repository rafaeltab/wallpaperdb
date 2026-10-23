import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));

test.each([
	["valid assertion", "test('checks', () => expect(1).toBe(1));", 0],
	["missing assertion", "test('never checks', () => {});", 1],
	["focused test", "test.only('focused', () => expect(1).toBe(1));", 1],
])("infra runner policy handles %s", async (_name, source, status) => {
	const workspace = path.join(repository, "infra");
	const directory = await mkdtemp(
		path.join(workspace, "nats/init/.test-policy-"),
	);
	try {
		// Deliberately invalid runner inputs must not enter concurrent test lint.
		const fixtures = path.join(directory, "fixtures");
		await mkdir(fixtures);
		const file = path.join(fixtures, "behavior.test.ts");
		await writeFile(
			file,
			`import { expect, test } from 'vitest';\n${source}\n`,
		);
		const result = spawnSync(
			process.execPath,
			[
				path.join(workspace, "node_modules/vitest/vitest.mjs"),
				"run",
				file,
				"--maxWorkers=1",
				"--no-file-parallelism",
			],
			{ cwd: workspace, encoding: "utf8", timeout: 20_000 },
		);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stdout + result.stderr).toBe(status);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test.each([
	[
		"valid assertion",
		"test('checks its outcome', () => expect(2 + 2).toBe(4));",
		0,
		"1 passed",
	],
	[
		"missing assertion",
		"test('never checks its outcome', () => {});",
		1,
		"expected any number of assertion",
	],
	[
		"focused test",
		"test.only('focused', () => expect(2 + 2).toBe(4));",
		1,
		"only",
	],
])(
	"shared runner policy handles %s",
	async (_name, source, status, diagnostic) => {
		const root = await mkdtemp(
			path.join(repository, "node_modules/.test-policy-"),
		);
		try {
			await writeFile(
				path.join(root, "behavior.test.ts"),
				`import { expect, test } from 'vitest';\n${source}\n`,
			);
			await writeFile(
				path.join(root, "vitest.config.mjs"),
				`import { defineBaseConfig } from '@wallpaperdb/vitest-config';\nexport default defineBaseConfig({ test: { include: ['*.test.ts'] } });\n`,
			);
			const result = spawnSync(
				process.execPath,
				[
					path.join(repository, "node_modules/vitest/vitest.mjs"),
					"run",
					"--root",
					root,
					"--config",
					path.join(root, "vitest.config.mjs"),
					"--maxWorkers=1",
					"--no-file-parallelism",
				],
				{ encoding: "utf8", timeout: 20_000 },
			);
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(status);
			expect(result.stdout + result.stderr).toContain(diagnostic);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
