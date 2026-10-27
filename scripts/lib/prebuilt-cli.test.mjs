import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
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
import { test } from "node:test";
import { runPrebuiltTests } from "./prebuilt-tests.mjs";

function project(t, coverage = {}) {
	const directory = mkdtempSync(join(tmpdir(), "prebuilt-cli-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const root = join(directory, "checkout");
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "node_modules/@vitest"), { recursive: true });
	writeFileSync(join(root, "package.json"), '{"type":"module"}');
	const require = createRequire(import.meta.url);
	for (const name of ["vitest", "@vitest/coverage-v8"])
		symlinkSync(
			dirname(require.resolve(`${name}/package.json`)),
			join(root, "node_modules", name),
			"dir",
		);
	writeFileSync(
		join(root, "vitest.config.ts"),
		`export default { test: { include: ['*.test.ts'], coverage: ${JSON.stringify({ include: ["src/**/*.ts"], exclude: [], reportsDirectory: "coverage/unit", reporter: ["json", "json-summary"], ...coverage })} } };\n`,
	);
	const source =
		"export function choose(value: boolean): number {\n  if (value) return 17;\n  return 31;\n}\nexport function never(): number {\n  return 43;\n}\n";
	writeFileSync(join(root, "src/choose.ts"), source);
	writeFileSync(
		join(root, "choose.test.ts"),
		"import { test, expect } from 'vitest';\nimport { choose } from './src/choose.js';\ntest('choose.test.ts', () => expect(choose(true)).toBe(17));\n",
	);
	const manifest = require.resolve("vitest/package.json");
	const vitest = join(
		dirname(manifest),
		JSON.parse(readFileSync(manifest, "utf8")).bin.vitest,
	);
	return { root, artifacts: join(directory, "artifacts"), source, vitest };
}

function argumentsFor(label, args) {
	return [
		...args,
		"--maxWorkers=1",
		"--no-file-parallelism",
		"--reporter=json",
		`--outputFile=${label}.json`,
	];
}

function original(paths, label, args) {
	return spawnSync(
		process.execPath,
		[paths.vitest, "run", ...argumentsFor(label, args)],
		{ cwd: paths.root, encoding: "utf8" },
	);
}

function passed(paths, label) {
	return JSON.parse(readFileSync(join(paths.root, `${label}.json`), "utf8"))
		.numPassedTests;
}

test("a test-name operand identical to its positional path remains a test name", async (t) => {
	const paths = project(t);
	const args = ["choose.test.ts", "--testNamePattern", "choose.test.ts"];
	const baseline = original(paths, "original", args);
	assert.equal(baseline.status, 0, baseline.stderr);
	assert.equal(passed(paths, "original"), 1);
	const result = await runPrebuiltTests({
		...paths,
		cwd: paths.root,
		args: argumentsFor("prebuilt", args),
	});
	assert.equal(result.status, 0);
	assert.equal(passed(paths, "prebuilt"), 1);
});

test("a separate false coverage operand disables coverage without adding a file filter", async (t) => {
	const paths = project(t, { enabled: true });
	const args = ["--coverage", "false"];
	const baseline = original(paths, "original", args);
	assert.equal(baseline.status, 0, baseline.stderr);
	assert.equal(passed(paths, "original"), 1);
	assert.equal(
		existsSync(join(paths.root, "coverage/unit/coverage-final.json")),
		false,
	);
	const result = await runPrebuiltTests({
		...paths,
		cwd: paths.root,
		args: argumentsFor("prebuilt", args),
	});
	assert.equal(result.status, 0);
	assert.equal(passed(paths, "prebuilt"), 1);
	assert.equal(
		existsSync(join(paths.root, "coverage/unit/coverage-final.json")),
		false,
	);
});

for (const [thresholds, status] of [
	[{ functions: 0 }, 0],
	[{ functions: 100 }, 1],
	[{ lines: 100 }, 1],
])
	test(`partial thresholds ${JSON.stringify(thresholds)} preserve Vitest's gate without adding other metrics`, async (t) => {
		const paths = project(t, { thresholds });
		const args = ["--coverage"];
		const baseline = original(paths, "original", args);
		assert.equal(baseline.status, status, baseline.stderr);
		assert.equal(passed(paths, "original"), 1);
		const result = await runPrebuiltTests({
			...paths,
			cwd: paths.root,
			args: argumentsFor("prebuilt", args),
		});
		assert.equal(passed(paths, "prebuilt"), 1);
		assert.equal(result.status, status);
	});

test("a staging syntax failure removes the previous generation's report and success metadata", async (t) => {
	const paths = project(t);
	const args = ["--coverage"];
	const report = join(paths.root, "coverage/unit/coverage-final.json");
	const metadata = join(paths.root, "coverage/unit/prebuilt-run.json");
	const source = join(paths.root, "src/choose.ts");
	const baseline = original(paths, "original-valid", args);
	assert.equal(baseline.status, 0, baseline.stderr);
	assert.equal(existsSync(report), true);
	writeFileSync(source, "export const choose = ;\n");
	const baselineFailure = original(paths, "original-invalid", args);
	assert.equal(baselineFailure.status, 1);
	assert.equal(existsSync(report), false);
	writeFileSync(source, paths.source);
	const first = await runPrebuiltTests({
		...paths,
		cwd: paths.root,
		args: argumentsFor("prebuilt-valid", args),
	});
	assert.equal(first.status, 0);
	assert.equal(existsSync(report), true);
	assert.equal(JSON.parse(readFileSync(metadata, "utf8")).status, 0);
	writeFileSync(source, "export const choose = ;\n");
	await assert.rejects(
		runPrebuiltTests({
			...paths,
			cwd: paths.root,
			args: argumentsFor("prebuilt-invalid", args),
		}),
		/TS1109|Expression expected/,
	);
	assert.equal(existsSync(report), false);
	assert.equal(existsSync(metadata), false);
});
