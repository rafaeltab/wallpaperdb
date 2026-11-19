import { pathToFileURL } from "node:url";
import { reportSchema } from "../src/json.mjs";
import { expect } from "vitest";
import {
	repositoryConfiguration,
	repositoryRoot,
} from "../src/repository-root.mjs";
const { estimates } = await repositoryConfiguration();
import { hash, writeReceipt, mergeReceipts } from "../src/receipts.mjs";
import { reportInput } from "../src/report-input.mjs";
import { auditReports as audit } from "../src/report-audit.mjs";
const auditReports: typeof audit = (inputs, root) =>
	audit(inputs, root, estimates);
import { publishReports } from "../src/publish-reports.mjs";
import { test } from "vitest";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import ts from "typescript";
const root = repositoryRoot();
test("native children and workers measure original TypeScript hits and real zero controls", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "native-coverage-"));
	try {
		await symlink(resolve(root, "node_modules"), `${directory}/node_modules`);
		await writeFile(`${directory}/package.json`, '{"type":"module"}');
		const source =
			"export function executed(flag: boolean) {\n if(flag) return 1;\n return 0;\n}\nexport function untouched() { return 2; }\n";
		const original = `${directory}/original.ts`;
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
		const map = JSON.parse(compiled.sourceMapText || "null");
		map.sources = [original];
		map.sourceRoot = "";
		await writeFile(`${directory}/original.js`, compiled.outputText);
		await writeFile(`${directory}/original.js.map`, JSON.stringify(map));
		await writeFile(
			`${directory}/child.mjs`,
			"import {executed} from './original.js'; executed(true);",
		);
		await writeFile(
			`${directory}/control.test.js`,
			`import {test} from 'vitest'; import {spawn} from 'node:child_process'; import {Worker} from 'node:worker_threads';
const done=p=>new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('exit '+code)));});
test('descendants',async()=>{await done(spawn(process.execPath,['child.mjs'],{stdio:'inherit'}));await done(new Worker(new URL('./child.mjs',import.meta.url)));});`,
		);
		await writeFile(
			`${directory}/vitest.config.mjs`,
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
		expect(run.status, run.stdout + run.stderr).toBe(0);
		const report = reportSchema.parse(
			JSON.parse(
				await readFile(`${directory}/coverage/coverage-final.json`, "utf8"),
			),
		);
		expect(Object.keys(report)).toStrictEqual([original]);
		const file = report[original];
		expect(Object.values(file.f)).toStrictEqual([2, 0]);
		const branch = Object.keys(file.branchMap).find(
			(id) => file.branchMap[id].type === "if",
		);
		if (!branch) throw new Error("Missing measured branch");
		expect(file.b[branch]).toStrictEqual([2, 0]);
		expect(Object.values(file.s).includes(0)).toBeTruthy();
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
					`${directory}/node_modules`,
				);
				await writeFile(`${directory}/package.json`, '{"type":"module"}');
				const source =
					'export function executed() {\n return "actual";\n}\nexport function untouched() {\n return "zero";\n}\n';
				const original = `${directory}/original.ts`;
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
				const map = JSON.parse(compiled.sourceMapText || "null");
				map.sources = [original];
				map.sourceRoot = "";
				await writeFile(`${directory}/original.js`, compiled.outputText);
				await writeFile(`${directory}/original.js.map`, JSON.stringify(map));
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
					`${directory}/control.test.js`,
					`import {test,expect,vi} from 'vitest';vi${"."}mock('./original.js'${mocking});import {executed} from './original.js';test('mock',async()=>{expect(executed()).toBe(${expectation});${actual ? `const real=await vi.importActual('./original.js');expect(real.executed()).toBe('actual');` : ""}});`,
				);
				await writeFile(
					`${directory}/vitest.config.mjs`,
					`export default {test:{include:['control.test.js'],experimental:{viteModuleRunner:false,nodeLoader:true},coverage:{provider:'v8',enabled:true,include:['original.js'],reporter:['json'],reportsDirectory:'coverage'}}};`,
				);
				const sources = `${directory}/.coverage-runtime/native-sources-control`;
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
							NODE_OPTIONS: `--import=${resolve(root, "packages/coverage-runtime/dist/native-hook.mjs")}`,
						},
					},
				);
				expect(run.status, run.stdout + run.stderr).toBe(0);
				const report = reportSchema.parse(
					JSON.parse(
						await readFile(`${directory}/coverage/coverage-final.json`, "utf8"),
					),
				);
				expect(
					report[original],
					"original TypeScript source missing",
				).toBeTruthy();
				expect(
					Object.keys(report).every(
						(path) => path === original || path.startsWith(`${sources}/`),
					),
					"unrelated source attributed to mock",
				).toBeTruthy();
				expect(
					Object.keys(report).some((path) => path.startsWith(`${sources}/`)),
					"generated plumbing must retain its own identity",
				).toBeTruthy();
				const partition = await reportInput(report, directory, ".");
				expect(partition.original[original]).toStrictEqual(report[original]);
				expect(
					Object.values(partition.generated).some((entry) =>
						Object.values(entry.coverage.s).some((count) => count > 0),
					),
				).toBeTruthy();
				expect(
					{
						...partition.original,
						...Object.fromEntries(
							Object.entries(partition.generated).map(([path, entry]) => [
								path,
								entry.coverage,
							]),
						),
					},
					"raw source inventory/maps/counters preserved",
				).toStrictEqual(report);
				const replay = await reportInput(
					report,
					directory,
					".",
					partition.generated,
				);
				expect(replay).toStrictEqual(partition);
				const audited = auditReports(
					[{ id: "mock", data: partition.original }],
					directory,
				);
				await publishReports(audited.reports[0].data, `${directory}/published`);
				const published = JSON.parse(
					await readFile(`${directory}/published/coverage-final.json`, "utf8"),
				);
				expect(published).toStrictEqual(partition.original);
				await writeFile(
					`${directory}/.gitignore`,
					"node_modules\n.coverage-runtime/\npublished/\n",
				);
				for (const args of [
					["init", "-q"],
					["add", "."],
					[
						"-c",
						"user.name=Test",
						"-c",
						"user.email=test@example.invalid",
						"commit",
						"-qm",
						"fixture",
					],
				])
					execFileSync("git", args, { cwd: directory });
				const row = { id: "mock-control", workspace: ".", coverage: true };
				await writeReceipt(
					`${directory}/.coverage-runtime/receipts`,
					directory,
					row,
					report,
					partition.original,
					{ [original]: hash(source) },
					[],
					partition.generated,
				);
				await mergeReceipts(
					directory,
					[row],
					`${directory}/.coverage-runtime/receipts`,
					`${directory}/.coverage-runtime/output`,
				);
				const receiptOutput = JSON.parse(
					await readFile(
						`${directory}/.coverage-runtime/output/coverage-final.json`,
						"utf8",
					),
				);
				expect(
					receiptOutput,
					"production receipt merge preserves original positives and zeros",
				).toStrictEqual(partition.original);
				const file = report[original];
				const counts = (name: string) =>
					Object.entries(file.fnMap)
						.filter(([, fn]) => fn.name === name)
						.map(([id]) => file.f[id]);
				expect(counts("executed")).toStrictEqual([
					mode === "spy" ? (actual ? 2 : 1) : actual ? 1 : 0,
				]);
				expect(counts("untouched")).toStrictEqual([0]);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});

test("isolated container descendants load the compiled hook with an explicit repository root", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "container-hook-root-"));
	const {
		containerExecution,
	}: typeof import("../src/container-execution.mjs") = await import(
		pathToFileURL(
			resolve(root, "packages/coverage-runtime/dist/container-execution.mjs"),
		).href
	);
	class ContainerConfiguration {
		environment: NodeJS.ProcessEnv = {};
		withBindMounts() {
			return this;
		}
		withEnvironment(environment: Record<string, string>) {
			this.environment = environment;
			return this;
		}
	}
	const previous = process.env.NODE_V8_COVERAGE;
	try {
		process.env.NODE_V8_COVERAGE = resolve(directory, "v8");
		const configured = containerExecution(new ContainerConfiguration());
		if (previous === undefined) delete process.env.NODE_V8_COVERAGE;
		else process.env.NODE_V8_COVERAGE = previous;
		const run = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import {repositoryRoot} from ${JSON.stringify(pathToFileURL(resolve(root, "packages/coverage-runtime/dist/repository-root.mjs")).href)}; console.log(repositoryRoot());`,
			],
			{ cwd: directory, encoding: "utf8", env: configured.environment },
		);
		expect(run.status, run.stderr).toBe(0);
		expect(run.stdout.trim()).toBe(root.replace(/\/$/, ""));
	} finally {
		if (previous === undefined) delete process.env.NODE_V8_COVERAGE;
		else process.env.NODE_V8_COVERAGE = previous;
		await rm(directory, { recursive: true, force: true });
	}
});
