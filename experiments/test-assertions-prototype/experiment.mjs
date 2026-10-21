import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { controls, header, source } from "./controls.mjs";
import { eslintChecks } from "./static-checks.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = path.resolve(here, "../..");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, data) =>
	fs.writeFileSync(
		file,
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
	);

function command(
	executable,
	args,
	cwd,
	artifact,
	allowed = [0],
	environment = {},
) {
	const start = performance.now();
	let status = 0;
	let output;
	try {
		output = execFileSync(executable, args, {
			cwd,
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...environment },
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		status = error.status;
		output = error.stdout ?? "";
		write(`${artifact}.stderr`, error.stderr ?? "");
		if (!allowed.includes(status))
			throw new Error(
				`Command failed (${status}): ${executable} ${args.join(" ")}\n${output}\n${error.stderr ?? ""}`,
			);
	}
	write(artifact, output);
	return { ms: Math.round(performance.now() - start), status };
}

function runtime(config, cwd, artifact, requireAssertions, filters = []) {
	const output = `${artifact}.json`;
	const timing = command(
		path.join(cwd, "node_modules/.bin/vitest"),
		[
			"run",
			"--config",
			config,
			"--maxWorkers=1",
			"--no-file-parallelism",
			"--reporter=json",
			"--outputFile",
			output,
			...filters,
		],
		cwd,
		`${artifact}.log`,
		[0, 1],
		{ ASSERTIONS_415_REQUIRE: String(requireAssertions) },
	);
	const result = read(output);
	assert.equal(
		result.numTotalTests > 0,
		true,
		"Empty Vitest run is not evidence",
	);
	assert.deepEqual(
		result.unhandledErrors ?? [],
		[],
		"Unexpected unhandled errors",
	);
	for (const file of result.testResults)
		assert.ok(
			file.assertionResults.length,
			`Collection failure: ${file.name}\n${file.message}`,
		);
	const tests = result.testResults.flatMap((file) =>
		file.assertionResults.map((test) => ({
			name: test.fullName,
			status: test.status,
			failures: test.failureMessages,
		})),
	);
	return { ...timing, count: tests.length, tests };
}

function biomeChecks(files, scratch, artifacts) {
	const config = path.join(scratch, "biome.json");
	write(config, {
		root: true,
		vcs: { enabled: false },
		files: { includes: ["**"] },
		linter: {
			enabled: true,
			rules: {
				recommended: false,
				nursery: { noFloatingPromises: "error" },
				suspicious: { noMisplacedAssertion: "warn", noSelfCompare: "error" },
			},
		},
	});
	const output = path.join(artifacts, "biome.json");
	const timing = command(
		path.join(here, "node_modules/.bin/biome"),
		[
			"lint",
			"--config-path",
			config,
			"--reporter=json",
			"--max-diagnostics=none",
			...files,
		],
		scratch,
		output,
		[0, 1],
	);
	const result = read(output);
	assert.equal(
		result.summary.unchanged,
		files.length,
		"Biome did not process every selected file",
	);
	assert.equal(result.summary.skipped, 0, "Biome skipped selected files");
	return {
		...timing,
		diagnostics: result.diagnostics.map((item) => ({
			file: path.resolve(scratch, item.location.path.file),
			rule: item.category,
			span: item.location.span,
			message: item.description,
		})),
	};
}

export async function runExperiment({ controlsOnly }) {
	const scratch = fs.mkdtempSync(path.join(here, ".prototype-run-"));
	const artifacts = fs.mkdtempSync(
		path.join(os.tmpdir(), "wallpaperdb-assertions-415-"),
	);
	console.error(`Prototype #415 evidence: ${artifacts}`);
	const controlsDir = path.join(scratch, "controls");
	const runtimeDir = path.join(scratch, "runtime");
	fs.mkdirSync(controlsDir);
	fs.mkdirSync(runtimeDir);
	try {
		for (const control of controls)
			write(path.join(controlsDir, `${control.id}.test.ts`), source(control));
		write(
			path.join(runtimeDir, "controls.test.ts"),
			`${header}\n${controls.map((control) => source(control).slice(header.length)).join("\n")}`,
		);
		write(
			path.join(scratch, "setup.ts"),
			`import { expect } from 'vitest';\nexpect.extend({ toBePrototypeName(actual) { return { pass: actual === 'Ada', message: () => 'Expected Ada' }; } });\n`,
		);
		write(
			path.join(runtimeDir, "hook.test.ts"),
			`import { beforeEach, expect, it } from 'vitest';\nbeforeEach(() => expect('Ada'.length).toBe(3));\nit('hook-only-assertion', () => {});\n`,
		);
		write(
			path.join(runtimeDir, "global-concurrent.test.ts"),
			`import { expect, it } from 'vitest';\nlet release: () => void;\nconst gate = new Promise<void>(resolve => { release = resolve; });\nit.concurrent('global-without-assertion', async () => { await gate; });\nit.concurrent('global-assertion-donor', async () => { expect('Ada'.length).toBe(3); release(); });\n`,
		);
		fs.mkdirSync(path.join(scratch, "setup-only"));
		write(
			path.join(scratch, "setup-only", "setup.test.ts"),
			`import { it } from 'vitest';\nit('setup-only', () => {});\n`,
		);
		const config = path.join(scratch, "vitest.config.ts");
		write(
			config,
			`import { defineConfig } from 'vitest/config';\nexport default defineConfig({test:{projects:[{resolve:{dedupe:['vitest']},test:{name:'behavior',expect:{requireAssertions:process.env.ASSERTIONS_415_REQUIRE==='true'},server:{deps:{inline:['@effect/vitest']}},include:[${JSON.stringify(`${runtimeDir}/*.test.ts`)}],setupFiles:[${JSON.stringify(path.join(scratch, "setup.ts"))}],testTimeout:1000}},{test:{name:'setup-only',include:[${JSON.stringify(`${scratch}/setup-only/*.test.ts`)}],expect:{requireAssertions:false}}}]}});\n`,
		);
		const baseline = runtime(
			config,
			here,
			path.join(artifacts, "controls-baseline"),
			false,
		);
		const enforced = runtime(
			config,
			here,
			path.join(artifacts, "controls-enforced"),
			true,
		);
		// Type-aware lint needs real files and an explicit project, not lintText guesses.
		const realFiles = [
			"apps/user/test/profile-capability.unit.test.ts",
			"apps/user/test/helpers/profiles.ts",
			"apps/web/test/components/profile/profile-inline-field.dom.test.tsx",
			"apps/web/test/hooks/useCountdown.dom.test.ts",
			"apps/web/test/setup.ts",
		].map((file) => path.join(repo, file));
		const files = [
			...controls.map((control) =>
				path.join(controlsDir, `${control.id}.test.ts`),
			),
			path.join(here, "helpers.ts"),
			...(controlsOnly ? [] : realFiles),
		];
		const project = path.join(scratch, "tsconfig.json");
		write(project, {
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				strict: true,
				skipLibCheck: true,
				jsx: "react-jsx",
				baseUrl: path.join(repo, "apps/web"),
				paths: { "@/*": ["src/*"] },
			},
			files,
		});
		const biome = biomeChecks(files, scratch, artifacts);
		const eslint = await eslintChecks(files, { root: repo, project });
		assert.deepEqual(
			eslint.diagnostics.filter((item) => item.fatal),
			[],
			"Parser failures are not findings",
		);
		write(path.join(artifacts, "eslint.json"), eslint);
		const rows = controls.map((control) => ({
			id: control.id,
			valid: control.valid,
			baseline: baseline.tests.find((test) => test.name === control.id)?.status,
			enforced: enforced.tests.find((test) => test.name === control.id)?.status,
			biome: biome.diagnostics
				.filter(
					(item) =>
						path.resolve(repo, item.file) ===
						path.join(controlsDir, `${control.id}.test.ts`),
				)
				.map((item) => item.rule),
			eslint: eslint.diagnostics
				.filter(
					(item) =>
						item.file === path.join(controlsDir, `${control.id}.test.ts`),
				)
				.map((item) => item.rule),
		}));
		const report = {
			versions: {
				node: process.version,
				vitest: "5.0.2",
				biome: "2.3.10",
				eslint: "9.39.5",
				typescriptEslint: "8.72.0",
				vitestEslint: "1.6.27",
			},
			artifacts,
			controls: rows,
			runtime: { baseline, enforced },
			static: { biome, eslint },
			real: [],
		};
		if (!controlsOnly) {
			for (const [workspace, filters] of [
				["user", ["test/profile-capability.unit.test.ts"]],
				[
					"web",
					[
						"test/components/profile/profile-inline-field.dom.test.tsx",
						"test/hooks/useCountdown.dom.test.ts",
					],
				],
			]) {
				const cwd = path.join(repo, "apps", workspace);
				console.error(`Preparing and measuring ${workspace} suite`);
				const preparation = command(
					"make",
					["test-focused", `PACKAGE=${workspace}`, `ARGS=${filters.join(" ")}`],
					repo,
					path.join(artifacts, `${workspace}-preparation.log`),
				);
				const realConfig = path.join(scratch, `${workspace}.config.ts`);
				write(
					realConfig,
					`import original from ${JSON.stringify(path.join(cwd, "vitest.config.ts"))};\nconst requireAssertions=process.env.ASSERTIONS_415_REQUIRE==='true';\nexport default {...original,test:{...original.test,expect:{requireAssertions},...(original.test.projects?{projects:original.test.projects.map(project=>({...project,test:{...project.test,expect:{requireAssertions}}}))}:{})}};\n`,
				);
				const runs = [];
				for (let repeat = 0; repeat < 3; repeat++) {
					for (const required of repeat % 2 ? [true, false] : [false, true]) {
						runs.push({
							required,
							...runtime(
								realConfig,
								cwd,
								path.join(artifacts, `${workspace}-${repeat}-${required}`),
								required,
								filters,
							),
						});
					}
				}
				report.real.push({ workspace, preparation, runs });
			}
		}
		write(path.join(artifacts, "report.json"), report);
		return report;
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}
