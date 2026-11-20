import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { repositoryRoot } from "../src/repository-root.mjs";
import { reportInput } from "../src/report-input.mjs";

test("deployed bundles credit owned TypeScript and exclude foreign sources after remapping", async () => {
	const tooling = repositoryRoot();
	const root = await mkdtemp(join(tmpdir(), "bundle-selection-"));
	const workspace = "apps/service";
	const mirror = join(root, ".coverage-runtime/build", workspace);
	const output = join(root, "output");
	const original = join(root, workspace, "src/entry.ts");
	try {
		await symlink(join(tooling, "node_modules"), join(root, "node_modules"));
		await writeFile(join(root, "package.json"), '{"type":"module"}');
		await mkdir(output);
		await mkdir(join(mirror, "dist"), { recursive: true });
		for (const [source, target] of [
			[original, join(mirror, "dist/entry.mjs")],
			[
				join(root, "packages/shared/src/foreign.ts"),
				join(mirror, "dist/foreign.mjs"),
			],
		]) {
			const code =
				"export function executed() { return 1; }\nexport function untouched() { return 0; }\n";
			await mkdir(dirname(source), { recursive: true });
			await writeFile(source, code);
			const compiled = ts.transpileModule(code, {
				fileName: source,
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ES2024,
					sourceMap: true,
					inlineSources: true,
				},
			});
			const map = JSON.parse(compiled.sourceMapText || "null");
			map.sources = [source];
			map.sourceRoot = "";
			await writeFile(
				target,
				compiled.outputText.replace(
					/sourceMappingURL=.*/,
					`sourceMappingURL=${basename(target)}.map`,
				),
			);
			await writeFile(`${target}.map`, JSON.stringify(map));
		}
		await writeFile(
			join(root, "policy.mjs"),
			`export const estimates={};export const sourceViteWorkspaces=[];export const builtArtifactWorkspaces=['${workspace}'];`,
		);
		await writeFile(
			join(mirror, "vitest.config.mjs"),
			"export default {test:{include:['control.test.js'],coverage:{provider:'v8',include:['src/**/*.ts'],reporter:['json']}}};",
		);
		await writeFile(
			join(mirror, "control.test.js"),
			"import {test,expect} from 'vitest';import {executed} from './dist/entry.mjs';import {executed as foreign} from './dist/foreign.mjs';test('bundled calls',()=>{expect(executed()).toBe(1);expect(foreign()).toBe(1);});",
		);
		const run = spawnSync(
			process.execPath,
			[
				join(tooling, "node_modules/vitest/vitest.mjs"),
				"run",
				"--coverage",
				"--config",
				join(tooling, "packages/coverage-runtime/dist/vitest.config.mjs"),
			],
			{
				cwd: mirror,
				encoding: "utf8",
				timeout: 60000,
				env: {
					...process.env,
					NODE_OPTIONS: "",
					WALLPAPERDB_COVERAGE_REPO_ROOT: root,
					WALLPAPERDB_COVERAGE_CONFIGURATION: join(root, "policy.mjs"),
					WALLPAPERDB_COVERAGE_WORKSPACE: workspace,
					WALLPAPERDB_COVERAGE_REPO_STRATEGY: "compiled-native",
					WALLPAPERDB_COVERAGE_REPO_CONFIG: join(mirror, "vitest.config.mjs"),
					WALLPAPERDB_COVERAGE_REPO_OUTPUT: output,
				},
			},
		);
		expect(run.status, run.stdout + run.stderr).toBe(0);
		const { original: report } = await reportInput(
			JSON.parse(
				await readFile(join(output, "coverage/coverage-final.json"), "utf8"),
			),
			root,
			workspace,
		);
		expect(Object.keys(report)).toStrictEqual([original]);
		expect(Object.values(report[original].f)).toStrictEqual([1, 0]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
