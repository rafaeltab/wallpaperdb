import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
test("native children and workers measure original TypeScript hits and real zero controls", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "native-coverage-"));
	try {
		await symlink(resolve(root, "node_modules"), directory + "/node_modules");
		await writeFile(directory + "/package.json", '{"type":"module"}');
		const source =
			"export function executed(flag: boolean) {\n if(flag) return 1;\n return 0;\n}\nexport function untouched() { return 2; }\n";
		const original = directory + "/original.ts";
		await writeFile(original, source);
		const compiled = ts.transpileModule(source, {
			fileName: original,
			compilerOptions: {
				target: ts.ScriptTarget.ES2024,
				module: ts.ModuleKind.ESNext,
				sourceMap: true,
				inlineSources: true,
			},
		});
		const map = JSON.parse(compiled.sourceMapText);
		map.sources = [original];
		map.sourceRoot = "";
		await writeFile(directory + "/original.js", compiled.outputText);
		await writeFile(directory + "/original.js.map", JSON.stringify(map));
		await writeFile(
			directory + "/child.mjs",
			"import {executed} from './original.js'; executed(true);",
		);
		await writeFile(
			directory + "/control.test.js",
			`import {test} from 'vitest'; import {spawn} from 'node:child_process'; import {Worker} from 'node:worker_threads';
const done=p=>new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('exit '+code)));});
test('descendants',async()=>{await done(spawn(process.execPath,['child.mjs'],{stdio:'inherit'}));await done(new Worker(new URL('./child.mjs',import.meta.url)));});`,
		);
		await writeFile(
			directory + "/vitest.config.mjs",
			`export default {test:{include:['control.test.js'],experimental:{viteModuleRunner:false,nodeLoader:true},coverage:{provider:'v8',enabled:true,autoAttachSubprocess:true,include:['original.js'],reporter:['json'],reportsDirectory:'coverage'}}};`,
		);
		const run = spawnSync(
			process.execPath,
			[resolve(root, "node_modules/vitest/vitest.mjs"), "run"],
			{
				cwd: directory,
				encoding: "utf8",
				env: { ...process.env, NODE_OPTIONS: "" },
				timeout: 60000,
			},
		);
		assert.equal(run.status, 0, run.stdout + run.stderr);
		const report = JSON.parse(
			await readFile(directory + "/coverage/coverage-final.json", "utf8"),
		);
		assert.deepEqual(Object.keys(report), [original]);
		const file = report[original];
		assert.deepEqual(Object.values(file.f), [2, 0]);
		const branch = Object.keys(file.branchMap).find(
			(id) => file.branchMap[id].type === "if",
		);
		assert.deepEqual(file.b[branch], [2, 0]);
		assert.ok(Object.values(file.s).includes(0));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const mode of ["manual", "automock", "spy"])
	for (const actual of [false, true])
		test(`production native hook preserves ${mode} original-source ${actual ? "positive" : "zero"} identity`, async () => {
			const directory = await mkdtemp(resolve(tmpdir(), "native-mock-"));
			try {
				await symlink(
					resolve(root, "node_modules"),
					directory + "/node_modules",
				);
				await writeFile(directory + "/package.json", '{"type":"module"}');
				const source =
					'export function executed() {\n return "actual";\n}\nexport function untouched() {\n return "zero";\n}\n';
				const original = directory + "/original.ts";
				await writeFile(original, source);
				const compiled = ts.transpileModule(source, {
					fileName: original,
					compilerOptions: {
						target: ts.ScriptTarget.ES2024,
						module: ts.ModuleKind.ESNext,
						sourceMap: true,
						inlineSources: true,
					},
				});
				const map = JSON.parse(compiled.sourceMapText);
				map.sources = [original];
				map.sourceRoot = "";
				await writeFile(directory + "/original.js", compiled.outputText);
				await writeFile(directory + "/original.js.map", JSON.stringify(map));
				const mocking =
					mode === "manual"
						? `,()=>({executed:()=>"mocked",untouched:()=>"unused"})`
						: mode === "spy"
							? `,{spy:true}`
							: "";
				const expectation =
					mode === "manual"
						? '"mocked"'
						: mode === "spy"
							? '"actual"'
							: "undefined";
				await writeFile(
					directory + "/control.test.js",
					`import {test,expect,vi} from 'vitest';vi.mock('./original.js'${mocking});import {executed} from './original.js';test('mock',async()=>{expect(executed()).toBe(${expectation});${actual ? `const real=await vi.importActual('./original.js');expect(real.executed()).toBe('actual');` : ""}});`,
				);
				await writeFile(
					directory + "/vitest.config.mjs",
					`export default {test:{include:['control.test.js'],experimental:{viteModuleRunner:false,nodeLoader:true},coverage:{provider:'v8',enabled:true,include:['original.js'],reporter:['json'],reportsDirectory:'coverage'}}};`,
				);
				const sources = directory + "/sources";
				const run = spawnSync(
					process.execPath,
					[resolve(root, "node_modules/vitest/vitest.mjs"), "run"],
					{
						cwd: directory,
						encoding: "utf8",
						timeout: 60000,
						env: {
							...process.env,
							WALLPAPERDB_COVERAGE_NATIVE_SOURCES: sources,
							NODE_OPTIONS: `--import=${resolve(root, "scripts/coverage-runtime/native-hook.mjs")}`,
						},
					},
				);
				assert.equal(run.status, 0, run.stdout + run.stderr);
				const report = JSON.parse(
					await readFile(directory + "/coverage/coverage-final.json", "utf8"),
				);
				assert.ok(report[original], "original TypeScript source missing");
				assert.ok(
					Object.keys(report).every(
						(path) => path === original || path.startsWith(sources + "/"),
					),
					"unrelated source attributed to mock",
				);
				assert.ok(
					Object.keys(report).some((path) => path.startsWith(sources + "/")),
					"generated plumbing must retain its own identity",
				);
				const file = report[original];
				const counts = (name) =>
					Object.entries(file.fnMap)
						.filter(([, fn]) => fn.name === name)
						.map(([id]) => file.f[id]);
				assert.deepEqual(counts("executed"), [
					mode === "spy" ? (actual ? 2 : 1) : actual ? 1 : 0,
				]);
				assert.deepEqual(counts("untouched"), [0]);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
