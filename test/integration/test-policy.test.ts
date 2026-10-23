import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));

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
