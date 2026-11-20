import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { repositoryRoot } from "../src/repository-root.mjs";

test.each([0, 7])(
	"attempt records bind configuration and actual child exit %s",
	async (code) => {
		const root = repositoryRoot();
		const directory = await mkdtemp(join(tmpdir(), "attempt-record-"));
		const config = join(directory, "vitest.config.mjs");
		const source =
			"export default { test: { include: ['control.test.js'] } };\n";
		try {
			await writeFile(config, source);
			const run = spawnSync(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`
import {beginAttempt} from ${JSON.stringify(pathToFileURL(join(root, "packages/coverage-runtime/dist/artifacts.mjs")).href)};
beginAttempt(${JSON.stringify(directory)}, ${JSON.stringify(root)}, {id:'control',mode:'candidate',strategy:'compiled-native',config:${JSON.stringify(config)},sourceConfig:${JSON.stringify(config)}});
process.exitCode=${code};
`,
				],
				{ encoding: "utf8", env: { ...process.env }, timeout: 30000 },
			);
			expect(run.status, run.stdout + run.stderr).toBe(code);
			const latest = JSON.parse(
				await readFile(join(directory, "latest.json"), "utf8"),
			);
			const provenance = JSON.parse(
				await readFile(join(latest.directory, "provenance.json"), "utf8"),
			);
			const exit = JSON.parse(
				await readFile(join(latest.directory, "exit.json"), "utf8"),
			);
			expect(provenance).toMatchObject({
				id: "control",
				config,
				sourceConfig: config,
			});
			expect(provenance.configs[config]).toBe(
				createHash("sha256").update(source).digest("hex"),
			);
			expect(exit.code).toBe(code);
			expect(exit.implementationChangedDuringRun).toBe(false);
			expect(exit.endVersion).toStrictEqual(provenance.startVersion);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
