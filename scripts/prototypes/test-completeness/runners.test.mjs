import assert from "node:assert/strict";
import {
	globSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	command,
	graph,
	readJson,
	rel,
	scan,
	typeMembers,
	taskArguments,
	vitestFiles,
} from "./collect.mjs";
import { executeVitest } from "./pilot.mjs";
import { evaluate } from "./policy.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const reporter = fileURLToPath(
	new URL("./vitest-reporter.mjs", import.meta.url),
);

function fixture(t) {
	const root = mkdtempSync(resolve(tmpdir(), "completeness-runners-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	function write(path, content) {
		mkdirSync(resolve(root, path, ".."), { recursive: true });
		writeFileSync(
			resolve(root, path),
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
	symlinkSync(
		resolve(repository, "node_modules"),
		resolve(root, "node_modules"),
		"dir",
	);
	write("package.json", {
		name: "control-root",
		private: true,
		packageManager: "pnpm@10.18.3",
	});
	write("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
	write(
		"pnpm-lock.yaml",
		"lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/control: {}\n",
	);
	write(".gitignore", "node_modules/\n.turbo/\nreceipt.json\n");
	write(
		".github/workflows/ci.yml",
		"jobs:\n  test:\n    steps:\n      - run: |\n          make test-unit\n          make test-integration\n          make test-e2e\n          make check-types\n",
	);
	write("turbo.json", {
		tasks: {
			"test:unit": {
				outputs: ["receipt.json"],
				passThroughEnv: ["COMPLETENESS_NONCE", "COMPLETENESS_RECEIPT"],
			},
			"test:integration": {},
			"test:e2e": {},
			"check-types": {},
		},
	});
	write(
		"Makefile",
		"test-unit:\n\t@node_modules/.bin/turbo run test:unit $(TURBO_FLAGS)\ntest-integration:\n\t@node_modules/.bin/turbo run test:integration $(TURBO_FLAGS)\ntest-e2e:\n\t@node_modules/.bin/turbo run test:e2e $(TURBO_FLAGS)\ncheck-types:\n\t@node_modules/.bin/turbo run check-types $(TURBO_FLAGS)\n",
	);
	const packageJson = {
		name: "@wallpaperdb/control",
		type: "module",
		scripts: { "test:unit": "vitest run", "check-types": "tsc --noEmit" },
	};
	write("apps/control/package.json", packageJson);
	symlinkSync(
		resolve(repository, "apps/web-e2e/node_modules"),
		resolve(root, "apps/control/node_modules"),
		"dir",
	);
	write(
		"apps/control/vitest.config.ts",
		`import { defineConfig } from 'vitest/config'; export default defineConfig({test:{projects:[{test:{name:'unit',include:['test/*.test.ts']}},{test:{name:'other',include:['extra/*.test.ts']}},{test:{name:'setup-only',include:[]}}]}});`,
	);
	write("apps/control/tsconfig.json", {
		compilerOptions: {
			noEmit: true,
			skipLibCheck: true,
			module: "ESNext",
			moduleResolution: "bundler",
			types: [],
		},
		include: ["test/**/*.ts", "extra/**/*.ts"],
	});
	write("apps/control/test/helper.ts", "export const value = 1;");
	write("apps/control/test/data.json", { fixture: true });
	const normal = `import { test, expect } from 'vitest'; import { value } from './helper'; test('works', () => expect(value).toBe(1));`;
	write("apps/control/test/normal.test.ts", normal);
	assert.equal(command("git", ["init", "-q"], root).status, 0);
	assert.equal(command("git", ["add", "."], root).status, 0);
	const suite = {
		id: "control",
		cwd: "apps/control",
		task: "@wallpaperdb/control#test:unit",
	};
	let index = 0;
	function observe(execute = true) {
		const { tasks } = graph(root);
		const files = vitestFiles(root, suite, [], root, index++).files;
		const task = tasks.get(suite.task);
		const ciFiles = task
			? vitestFiles(root, suite, taskArguments(task.command), root, index++)
					.files
			: [];
		const typed = typeMembers(root, "apps/control/tsconfig.json", false);
		const input = {
			files: [],
			findings: [],
			suites: [
				{ ...suite, role: "expected", files, ciFiles, inGraph: Boolean(task) },
			],
			executions: execute
				? [executeVitest(root, suite, [], root, index++)]
				: [],
		};
		for (const path of globSync("apps/control/{test,extra}/**/*.ts", {
			cwd: root,
		})) {
			const source = readFileSync(resolve(root, path), "utf8");
			const scanned = scan(path, source);
			input.findings.push(...scanned.findings);
			input.files.push({
				path,
				role:
					/\.(test|spec)\.ts$/.test(path) || scanned.hasTests
						? "test"
						: "helper",
				typedBy: typed.has(path) ? [typed.get(path)] : [],
				discovered: files.filter((f) => f.endsWith(`::${path}`)),
			});
		}
		return {
			input,
			...evaluate(input),
			statuses: input.executions.map((r) => r.status),
		};
	}
	return { root, write, suite, packageJson, observe, normal };
}

test("actual Vitest processes detect focus, skips, empty files and env-dependent skips; deliberate empty selections pass", async (t) => {
	const f = fixture(t);
	const valid = f.observe();
	assert.deepEqual(valid.failures, []);
	assert.deepEqual(valid.statuses, [0]);
	f.write(
		"apps/control/test/focus-lint.test.ts",
		`import { test } from 'vitest'; test.only('focus', () => {});`,
	);
	const lint = command(
		resolve(repository, "scripts/node_modules/.bin/biome"),
		[
			"lint",
			"--only=suspicious/noFocusedTests",
			"--error-on-warnings",
			"test/focus-lint.test.ts",
		],
		resolve(f.root, f.suite.cwd),
	);
	assert.notEqual(lint.status, 0);
	assert.match(lint.stdout + lint.stderr, /noFocusedTests/);
	rmSync(resolve(f.root, "apps/control/test/focus-lint.test.ts"));
	for (const [name, source, code, runnerFails] of [
		["focus", `test.only('focus', () => {});`, "focused", true],
		["static skip", `test.skip('disabled', () => {});`, "runtime-skip", false],
		["todo", `test.todo('later');`, "runtime-skip", false],
		[
			"skipIf",
			`test.skipIf(process.env.PROTOTYPE_SKIP === 'yes')('environment', () => {});`,
			"runtime-skip",
			false,
		],
		[
			"runIf",
			`test.runIf(process.env.PROTOTYPE_SKIP !== 'yes')('environment', () => {});`,
			"runtime-skip",
			false,
		],
		[
			"runtime skip",
			`test('runtime', ctx => { if (process.env.PROTOTYPE_SKIP === 'yes') ctx.skip(); });`,
			"runtime-skip",
			false,
		],
		["empty file", `export const helper = 1;`, "empty-file", true],
	]) {
		await t.test(name, () => {
			f.suite.env = { PROTOTYPE_SKIP: "yes" };
			f.write(
				"apps/control/test/normal.test.ts",
				`import { test } from 'vitest'; ${source}`,
			);
			const result = f.observe();
			assert.ok(
				result.failures.some((f) => f.code === code),
				JSON.stringify(result),
			);
			assert.equal(result.statuses[0] !== 0, runnerFails);
		});
	}
	f.write(
		"apps/control/test/normal.test.ts",
		`import { test } from 'vitest'; test.skipIf(process.env.PROTOTYPE_SKIP === 'yes')('environment', () => {});`,
	);
	f.suite.env = { PROTOTYPE_SKIP: "no" };
	assert.deepEqual(f.observe().failures, []);
	const empty = executeVitest(
		f.root,
		{
			...f.suite,
			role: "selection",
			reason: "Explicit changed-file selection",
		},
		["does-not-exist"],
		f.root,
		"empty-selection",
	);
	assert.equal(empty.status, 0, empty.diagnostic);
	assert.deepEqual(
		evaluate({ files: [], suites: [], findings: [], executions: [empty] })
			.failures,
		[],
	);
});

test("real discovery, Turbo plans and compiler membership reject misplaced, CI-omitted, empty and untyped controls", (t) => {
	const f = fixture(t);
	assert.deepEqual(f.observe(false).failures, []);
	f.write(
		"apps/control/extra/hidden.test.ts",
		f.normal.replace("'./helper'", "'../test/helper'"),
	);
	const partial = executeVitest(
		f.root,
		f.suite,
		["test/normal.test.ts"],
		f.root,
		"partial-run",
	);
	partial.expectedFiles = vitestFiles(
		f.root,
		f.suite,
		[],
		f.root,
		"full-discovery",
	).files;
	assert.ok(
		evaluate({
			files: [],
			suites: [],
			findings: [],
			executions: [partial],
		}).failures.some((f) => f.code === "unexecuted"),
	);
	f.packageJson.scripts["test:unit"] = "vitest run --project=unit";
	f.write("apps/control/package.json", f.packageJson);
	assert.ok(f.observe(false).failures.some((f) => f.code === "ci-omission"));
	f.write("apps/control/test/misplaced.spec.ts", f.normal);
	assert.ok(f.observe(false).failures.some((f) => f.code === "undiscovered"));
	f.write("apps/control/tsconfig.json", {
		compilerOptions: { noLib: true, types: [] },
		files: ["test/helper.ts"],
	});
	assert.ok(f.observe(false).failures.some((f) => f.code === "untyped"));
	f.write(
		".github/workflows/ci.yml",
		"jobs:\n  test:\n    steps:\n      - run: make test-integration\n",
	);
	assert.ok(f.observe(false).failures.some((f) => f.code === "ci-task"));
	f.write(
		"apps/control/vitest.config.ts",
		`import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['absent/*.test.ts']}});`,
	);
	const empty = f.observe(false);
	assert.ok(empty.failures.some((f) => f.code === "empty-suite"));
	assert.notEqual(
		executeVitest(f.root, f.suite, [], f.root, "empty-expected").status,
		0,
	);
});

test("a real Turbo cache replay cannot satisfy the current execution receipt", (t) => {
	const f = fixture(t);
	f.packageJson.scripts["test:unit"] =
		`vitest run --allowOnly=false --maxWorkers=1 --reporter ${reporter}`;
	f.write("apps/control/package.json", f.packageJson);
	const receiptPath = resolve(f.root, "apps/control/receipt.json");
	const run = (nonce) =>
		command("make", ["--silent", "test-unit"], f.root, {
			COMPLETENESS_NONCE: nonce,
			COMPLETENESS_RECEIPT: receiptPath,
			TURBO_TOKEN: "",
			TURBO_TEAM: "",
		});
	const first = run("first");
	assert.equal(first.status, 0, first.stdout + first.stderr);
	rmSync(receiptPath);
	const cached = run("second");
	assert.equal(cached.status, 0, cached.stdout + cached.stderr);
	assert.match(cached.stdout, /cache hit/);
	const receipt = readJson(receiptPath);
	const input = {
		files: [],
		suites: [],
		findings: [],
		executions: [
			{
				...receipt,
				id: "cached",
				expectedNonce: "second",
				expectedFiles: [],
				files: receipt.files.map((file) => ({
					...file,
					key: `${file.project}::${rel(f.root, file.path)}`,
				})),
			},
		],
	};
	assert.ok(evaluate(input).failures.some((f) => f.code === "stale-report"));
	const fresh = executeVitest(f.root, f.suite, [], f.root, "fresh-after-cache");
	assert.equal(fresh.status, 0, fresh.diagnostic);
	assert.equal(fresh.nonce, fresh.expectedNonce);
});

test("Playwright focus, runtime skips, setup projects and empty-run flags use the actual runner without a browser service", (t) => {
	const f = fixture(t);
	f.write(
		"apps/control/playwright.config.ts",
		`import { defineConfig } from '@playwright/test'; export default defineConfig({testDir:'./specs',forbidOnly:true,projects:[{name:'setup',testMatch:/.*\\.setup\\.ts/},{name:'checks',testMatch:/.*\\.spec\\.ts/,dependencies:['setup']}],reporter:'json'});`,
	);
	f.write(
		"apps/control/specs/session.setup.ts",
		`import { test } from '@playwright/test'; test('setup without a browser', () => {});`,
	);
	const writeSpec = (source) =>
		f.write(
			"apps/control/specs/basic.spec.ts",
			`import { test, expect } from '@playwright/test'; ${source}`,
		);
	const run = (args = [], env = {}) => {
		const result = command(
			resolve(f.root, f.suite.cwd, "node_modules/.bin/playwright"),
			["test", "--reporter=json", ...args],
			resolve(f.root, f.suite.cwd),
			env,
		);
		return { ...result, report: JSON.parse(result.stdout) };
	};
	writeSpec(`test('valid', () => expect(1).toBe(1));`);
	const valid = run();
	assert.equal(valid.status, 0, valid.stdout + valid.stderr);
	assert.equal(valid.report.stats.expected, 2);
	writeSpec(`test.only('focus', () => {});`);
	assert.notEqual(run().status, 0);
	writeSpec(
		`test('environment', () => { test.skip(process.env.PROTOTYPE_SKIP === 'yes', 'control'); });`,
	);
	assert.equal(run([], { PROTOTYPE_SKIP: "yes" }).report.stats.skipped, 1);
	assert.equal(run([], { PROTOTYPE_SKIP: "no" }).report.stats.skipped, 0);
	assert.notEqual(run(["does-not-exist"]).status, 0);
	assert.equal(run(["does-not-exist", "--pass-with-no-tests"]).status, 0);
});
