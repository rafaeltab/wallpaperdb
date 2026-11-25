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
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { transformWithEsbuild } from "vite";
import { expect, test } from "vitest";
import { repositoryRoot } from "../src/repository-root.mjs";
import { reportInput } from "../src/report-input.mjs";

test.each([
	{ mode: "mirror", execution: "module" },
	{ mode: "producer", execution: "module" },
	{ mode: "mirror", execution: "child" },
	{ mode: "producer", execution: "child" },
	{ mode: "mirror", execution: "both" },
])(
	"$execution with $mode bundles reports logical hits and zeros once",
	async ({ mode, execution }) => {
		const tooling = repositoryRoot();
		const root = await mkdtemp(join(tmpdir(), "bundle-selection-"));
		const workspace = "apps/service";
		const mirror = join(root, ".coverage-runtime/build", workspace);
		const output = join(root, "output");
		const built = join(
			mode === "mirror" ? mirror : join(root, workspace),
			"dist",
		);
		const original = join(root, workspace, "src/entry.ts");
		try {
			await symlink(join(tooling, "node_modules"), join(root, "node_modules"));
			await writeFile(join(root, "package.json"), '{"type":"module"}');
			await mkdir(output);
			await mkdir(mirror, { recursive: true });
			await mkdir(built, { recursive: true });
			for (const [source, target] of [
				[original, join(built, "entry.mjs")],
				[
					join(root, workspace, "src/unimported.ts"),
					join(built, "unimported.mjs"),
				],
				[
					join(root, "packages/shared/src/foreign.ts"),
					join(built, "foreign.mjs"),
				],
			]) {
				const code =
					"export function executed(flag: boolean): number { return flag ? 1 : 2; }\nexport function untouched(flag: boolean): number { return flag ? 0 : 3; } export function nearby(): number { return 4; }\n";
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
				const local = join(
					mirror,
					"src",
					basename(source).replace(".ts", ".js"),
				);
				await mkdir(dirname(local), { recursive: true });
				const localMap = JSON.parse(compiled.sourceMapText || "null");
				localMap.sources = [source];
				localMap.sourceRoot = "";
				await writeFile(local, compiled.outputText);
				await writeFile(`${local}.map`, JSON.stringify(localMap));
				const bundled = await transformWithEsbuild(code, source, {
					loader: "ts",
					sourcemap: true,
					target: "esnext",
				});
				const map = bundled.map;
				map.sources = [source];
				await writeFile(
					target,
					`${bundled.code}\n//# sourceMappingURL=${basename(target)}.map`,
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
			const call =
				execution === "module"
					? `import {executed} from ${JSON.stringify(pathToFileURL(join(mirror, "src/entry.js")).href)};test('module call',()=>expect(executed(true)).toBe(1));`
					: `import {spawnSync} from 'node:child_process';test('deployed child call',()=>{const child=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(`import {executed} from ${JSON.stringify(pathToFileURL(join(built, "entry.mjs")).href)}; if(executed(true)!==1) throw new Error('bad result');`)}],{encoding:'utf8'});expect(child.status,child.stderr).toBe(0);});`;
			await writeFile(
				join(mirror, "control.test.js"),
				`import {test,expect} from 'vitest';${call}${execution === "both" ? `import {executed as direct} from ${JSON.stringify(pathToFileURL(join(mirror, "src/entry.js")).href)};test("direct",()=>expect(direct(true)).toBe(1));` : ""}`,
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
						NODE_OPTIONS: `--import=${join(tooling, "packages/coverage-runtime/dist/native-hook.mjs")}`,
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
			expect(Object.keys(report).sort()).toStrictEqual(
				[original, join(root, workspace, "src/unimported.ts")].sort(),
			);
			expect(Object.values(report[original].f)).toStrictEqual([
				execution === "both" ? 2 : 1,
				0,
				0,
			]);
			expect(
				Object.values(report[original].branchMap).map((branch) => branch.type),
			).toStrictEqual(["cond-expr", "cond-expr"]);
			expect(Object.values(report[original].b)).toStrictEqual([
				[execution === "both" ? 2 : 1, 0],
				[0, 0],
			]);
			expect(
				Object.values(report[join(root, workspace, "src/unimported.ts")].f),
			).toStrictEqual([0, 0, 0]);
			expect(
				Object.values(report[join(root, workspace, "src/unimported.ts")].b),
			).toStrictEqual([
				[0, 0],
				[0, 0],
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
