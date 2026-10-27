import assert from "node:assert/strict";
import {
	existsSync,
	closeSync,
	mkdtempSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { runPrebuiltTests } from "./prebuilt-tests.mjs";
import {
	auditNodeCoverage,
	collectNodeCoverage,
	stageNodeTree,
} from "./prebuilt-node.mjs";

function project(t) {
	const directory = mkdtempSync(join(tmpdir(), "prebuilt-node-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const root = join(directory, "checkout");
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "package.json"), '{"type":"module"}');
	return { root, artifacts: join(directory, "artifacts") };
}

test("native collection retains the Docker lease descriptor through the test launch", (t) => {
	const paths = project(t);
	const lease = join(paths.root, "lease");
	writeFileSync(lease, "owned-lease");
	const descriptor = openSync(lease, "r");
	const previous = process.env.WALLPAPERDB_DOCKER_LEASE_FD;
	process.env.WALLPAPERDB_DOCKER_LEASE_FD = String(descriptor);
	t.after(() => {
		if (previous === undefined) delete process.env.WALLPAPERDB_DOCKER_LEASE_FD;
		else process.env.WALLPAPERDB_DOCKER_LEASE_FD = previous;
		closeSync(descriptor);
	});
	const result = collectNodeCoverage({
		cwd: paths.root,
		reports: join(paths.artifacts, "reports"),
		coverage: { src: [join(paths.root, "src")], include: [], exclude: [] },
		args: [
			"--input-type=module",
			"-e",
			"import { readFileSync } from 'node:fs'; if (readFileSync(Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD), 'utf8') !== 'owned-lease') throw Error('lease lost');",
		],
	});
	assert.equal(result.status, 0, result.stderr);
});

test("staging emits current source with exact external maps and fresh owned output", (t) => {
	const paths = project(t);
	const source =
		"export function choose(value: boolean): number {\n  if (value) return 17;\n  return 31;\n}\n";
	writeFileSync(join(paths.root, "src/choose.ts"), source);
	const first = stageNodeTree(paths);
	const output = join(first.tree, "src/choose.js");
	assert.match(readFileSync(output, "utf8"), /return 17/);
	const map = JSON.parse(readFileSync(`${output}.map`, "utf8"));
	assert.deepEqual(map.sourcesContent, [source]);
	assert.equal(
		resolve(map.sourceRoot, map.sources[0]),
		join(paths.root, "src/choose.ts"),
	);
	assert.equal(readFileSync(join(first.tree, "src/choose.ts"), "utf8"), source);
	writeFileSync(join(paths.root, "src/choose.ts"), source.replace("17", "19"));
	writeFileSync(
		join(paths.root, "src/untracked.ts"),
		"export const added = 23;\n",
	);
	const second = stageNodeTree(paths);
	assert.notEqual(first.tree, second.tree);
	assert.match(
		readFileSync(join(second.tree, "src/choose.js"), "utf8"),
		/return 19/,
	);
	assert.match(
		readFileSync(join(second.tree, "src/untracked.js"), "utf8"),
		/23/,
	);
	assert.match(readFileSync(output, "utf8"), /return 17/);
});

test("stock c8 collects native children and nested workers without losing zero-hit inventory", (t) => {
	const paths = project(t);
	for (const name of ["child", "nested", "worker", "nested-worker", "never"]) {
		writeFileSync(
			join(paths.root, `src/${name}.ts`),
			[
				"export function choose(value: boolean): number {",
				"  if (value) return 17;",
				"  return 31;",
				"}",
				"export function unused(): number {",
				"  return 43;",
				"}",
				"",
			].join("\n"),
		);
	}
	writeFileSync(
		join(paths.root, "nested.ts"),
		"import { choose } from './src/nested.js';\nif (choose(true) !== 17) throw Error('nested');\n",
	);
	writeFileSync(
		join(paths.root, "child.ts"),
		[
			"import { execFileSync } from 'node:child_process';",
			"import { fileURLToPath } from 'node:url';",
			"import { choose } from './src/child.js';",
			"if (choose(true) !== 17) throw Error('child');",
			"execFileSync(process.execPath, [fileURLToPath(new URL('./nested.js', import.meta.url))]);",
		].join("\n"),
	);
	writeFileSync(
		join(paths.root, "nested-worker.ts"),
		"import { choose } from './src/nested-worker.mjs';\nif (choose(true) !== 17) throw Error('nested worker');\n",
	);
	writeFileSync(
		join(paths.root, "worker.ts"),
		[
			"import { Worker } from 'node:worker_threads';",
			"import { once } from 'node:events';",
			"import { choose } from './src/worker.js';",
			"if (choose(true) !== 17) throw Error('worker');",
			"const [code] = await once(new Worker(new URL('./nested-worker.js', import.meta.url)), 'exit');",
			"if (code !== 0) throw Error('nested worker exit');",
		].join("\n"),
	);
	writeFileSync(
		join(paths.root, "run.ts"),
		[
			"import { execFileSync } from 'node:child_process';",
			"import { Worker } from 'node:worker_threads';",
			"import { fileURLToPath } from 'node:url';",
			"import { once } from 'node:events';",
			"execFileSync(process.execPath, [fileURLToPath(new URL('./child.js', import.meta.url))]);",
			"const [code] = await once(new Worker(new URL('./worker.js', import.meta.url)), 'exit');",
			"if (code !== 0) throw Error('worker exit');",
		].join("\n"),
	);
	const stage = stageNodeTree({
		...paths,
		aliases: { "src/nested-worker.mjs": "src/nested-worker.js" },
	});
	assert.equal(
		readFileSync(join(stage.tree, "src/nested-worker.mjs"), "utf8"),
		readFileSync(join(stage.tree, "src/nested-worker.js"), "utf8"),
	);
	const reports = join(paths.artifacts, "reports");
	const result = collectNodeCoverage({
		cwd: stage.tree,
		args: [join(stage.tree, "run.js")],
		reports,
		coverage: {
			src: [join(stage.tree, "src")],
			include: ["src/**/*.{js,mjs}"],
			exclude: [],
		},
	});
	assert.equal(result.status, 0, result.stderr);
	const coverage = JSON.parse(
		readFileSync(join(reports, "coverage-final.json"), "utf8"),
	);
	assert.deepEqual(
		Object.keys(coverage).sort(),
		["child", "nested", "nested-worker", "never", "worker"]
			.map((name) => join(paths.root, `src/${name}.ts`))
			.sort(),
	);
	for (const name of ["child", "nested", "worker", "nested-worker"]) {
		const file = coverage[join(paths.root, `src/${name}.ts`)];
		const statementHits = (line) =>
			Object.entries(file.statementMap)
				.filter(([, span]) => span.start.line === line)
				.map(([key]) => file.s[key]);
		assert.deepEqual(statementHits(2), [1], name);
		assert.deepEqual(statementHits(3), [0], name);
		assert.deepEqual(statementHits(6), [0], name);
		assert.ok(
			Object.values(file.b).some((counts) => counts.includes(0)),
			name,
		);
	}
	const never = coverage[join(paths.root, "src/never.ts")];
	for (const metric of ["s", "f", "b"]) {
		const counts = Object.values(never[metric]).flat();
		assert.ok(counts.length > 0, metric);
		assert.ok(
			counts.every((count) => count === 0),
			metric,
		);
	}
	const observed = new Set();
	for (const name of readdirSync(join(reports, "raw"))) {
		const raw = JSON.parse(readFileSync(join(reports, "raw", name), "utf8"));
		for (const script of raw.result ?? []) {
			if (!script.url.startsWith("file:")) continue;
			const path = fileURLToPath(script.url);
			if (!path.startsWith(join(stage.tree, "src"))) continue;
			observed.add(path);
			const length = Math.max(
				...script.functions.flatMap((fn) =>
					fn.ranges.map((range) => range.endOffset),
				),
			);
			assert.equal(length, readFileSync(path, "utf8").length, script.url);
			const cached = raw["source-map-cache"][script.url].data;
			const disk = JSON.parse(readFileSync(`${path}.map`, "utf8"));
			assert.deepEqual(cached.sourcesContent, disk.sourcesContent);
			assert.equal(cached.mappings, disk.mappings);
		}
	}
	assert.equal(observed.size, 4);
	assert.doesNotThrow(() => auditNodeCoverage(stage, reports));
	const script = join(stage.tree, "src/child.js");
	writeFileSync(script, readFileSync(script, "utf8").replace("17", "19"));
	assert.throws(
		() => auditNodeCoverage(stage, reports),
		/Changed emitted file/,
	);
});

test("staging rejects two inputs that would execute different code at the same output URL", (t) => {
	const paths = project(t);
	writeFileSync(
		join(paths.root, "src/choose.ts"),
		"export const chosen: number = 17;\n",
	);
	writeFileSync(
		join(paths.root, "src/choose.js"),
		"export const chosen = 31;\n",
	);
	assert.throws(() => stageNodeTree(paths), /Conflicting output/);
});

test("native JSON import adaptation preserves the exact original TypeScript map content", (t) => {
	const paths = project(t);
	const source =
		"import value from './value.json';\nif (value.answer !== 17) throw Error('wrong JSON');\n";
	writeFileSync(join(paths.root, "src/read.ts"), source);
	writeFileSync(join(paths.root, "src/value.json"), '{"answer":17}');
	const stage = stageNodeTree(paths);
	const result = spawnSync(
		process.execPath,
		[join(stage.tree, "src/read.js")],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		JSON.parse(readFileSync(join(stage.tree, "src/read.js.map"), "utf8"))
			.sourcesContent,
		[source],
	);
});

test("compilation retains runtime compiler settings inherited from the workspace tsconfig", (t) => {
	const paths = project(t);
	writeFileSync(
		join(paths.root, "tsconfig.base.json"),
		'{"compilerOptions":{"useDefineForClassFields":false}}',
	);
	writeFileSync(
		join(paths.root, "tsconfig.json"),
		'{"extends":"./tsconfig.base.json"}',
	);
	writeFileSync(
		join(paths.root, "src/fields.ts"),
		"const observed: number[] = [];\nclass Base { set value(value: number) { observed.push(value); } }\nclass Child extends Base { value = 17; }\nnew Child();\nif (observed.join(',') !== '17') throw Error('class field policy lost');\n",
	);
	const stage = stageNodeTree(paths);
	const result = spawnSync(
		process.execPath,
		[join(stage.tree, "src/fields.js")],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});

test("normal native Vitest wiring keeps original path and name selection and publishes original-source reports", async (t) => {
	const paths = project(t);
	const require = createRequire(import.meta.url);
	mkdirSync(join(paths.root, "node_modules"));
	symlinkSync(
		realpathSync(join(dirname(require.resolve("vitest/package.json")))),
		join(paths.root, "node_modules/vitest"),
		"dir",
	);
	writeFileSync(
		join(paths.root, "vitest.config.ts"),
		"export default { test: { include: ['*.test.ts'], coverage: { include: ['src/**/*.ts'], exclude: [], reportsDirectory: 'coverage/unit', reporter: ['json', 'lcov', 'json-summary'] } } };\n",
	);
	writeFileSync(
		join(paths.root, "src/choose.ts"),
		"export function choose(value: boolean): number {\n  if (value) return 17;\n  return 31;\n}\n",
	);
	writeFileSync(
		join(paths.root, "src/never.ts"),
		"export function never(): number { return 43; }\n",
	);
	writeFileSync(
		join(paths.root, "choose.test.ts"),
		"import { test, expect } from 'vitest';\nimport { choose } from './src/choose.js';\ntest('selected.ts', () => expect(choose(true)).toBe(17));\ntest('unselected', () => { throw Error('name filter lost'); });\n",
	);
	writeFileSync(
		join(paths.root, "other.test.ts"),
		"import { test } from 'vitest';\ntest('selected', () => { throw Error('path filter lost'); });\n",
	);
	const result = await runPrebuiltTests({
		...paths,
		cwd: paths.root,
		args: [
			"--root",
			paths.root,
			join(paths.root, "choose.test.ts"),
			"--testNamePattern",
			"selected.ts",
			"--coverage",
			"--maxWorkers=1",
			"--no-file-parallelism",
			"--reporter=json",
			"--outputFile",
			"results.json",
		],
	});
	assert.equal(result.status, 0);
	assert.equal(
		JSON.parse(readFileSync(join(paths.root, "results.json"), "utf8"))
			.numPassedTests,
		1,
	);
	const coverage = JSON.parse(
		readFileSync(join(paths.root, "coverage/unit/coverage-final.json"), "utf8"),
	);
	assert.deepEqual(Object.keys(coverage).sort(), [
		join(paths.root, "src/choose.ts"),
		join(paths.root, "src/never.ts"),
	]);
	assert.match(
		readFileSync(join(paths.root, "coverage/unit/lcov.info"), "utf8"),
		/^SF:src\/choose.ts$/m,
	);
	assert.ok(
		Object.values(coverage[join(paths.root, "src/choose.ts")].s).some(
			(count) => count > 0,
		),
	);
	writeFileSync(
		join(paths.root, "src/choose.ts"),
		"export function choose(): number { return 19; }\n",
	);
	const failed = await runPrebuiltTests({
		...paths,
		cwd: paths.root,
		args: [
			"choose.test.ts",
			"--testNamePattern",
			"selected.ts",
			"--coverage",
			"--maxWorkers=1",
		],
	});
	assert.equal(failed.status, 1);
	assert.equal(
		existsSync(join(paths.root, "coverage/unit/coverage-final.json")),
		false,
	);
});

for (const [name, body, variant] of [
	[
		"autospy",
		"vi.mock('./src/choose.js', { spy: true });\nimport { choose } from './src/choose.js';\ntest('native autospy', () => { expect(choose(true)).toBe(17); expect(choose).toHaveBeenCalledOnce(); });",
		"autospy",
	],
	[
		"mixed autospy and actual",
		"vi.mock('./src/choose.js', { spy: true });\nimport { choose } from './src/choose.js';\ntest('mixed forms', async () => { const actual = await vi.importActual('./src/choose.js'); expect(actual.choose(true)).toBe(17); expect(choose(false)).toBe(31); expect(choose).toHaveBeenCalledOnce(); });",
		"autospy",
	],
	[
		"full manual replacement",
		"const mocks = vi.hoisted(() => ({ choose: vi.fn(() => 19), unused: vi.fn(() => 23) }));\nvi.mock('./src/choose.js', () => mocks);\nimport { choose, unused } from './src/choose.js';\ntest('manual replacement', () => { expect(choose).toBe(mocks.choose); expect(unused).toBe(mocks.unused); expect(choose(true)).toBe(19); expect(unused()).toBe(23); expect(choose).toHaveBeenCalledOnce(); });",
		"manual",
	],
])
	test(`${name} fails collection qualification instead of publishing ambiguous coverage`, async (t) => {
		const paths = project(t);
		const require = createRequire(import.meta.url);
		mkdirSync(join(paths.root, "node_modules"));
		symlinkSync(
			dirname(require.resolve("vitest/package.json")),
			join(paths.root, "node_modules/vitest"),
			"dir",
		);
		writeFileSync(
			join(paths.root, "vitest.config.ts"),
			"export default { test: { include: ['*.test.ts'], coverage: { include: ['src/**/*.ts'], exclude: [], reportsDirectory: 'coverage/unit', reporter: ['json'] } } };\n",
		);
		writeFileSync(
			join(paths.root, "src/choose.ts"),
			"type Padding = { readonly ignored: number };\nexport function choose(value: boolean): number {\n  if (value) return 17;\n  return 31;\n}\nexport function unused(): number {\n return 43;\n}\n",
		);
		writeFileSync(
			join(paths.root, "choose.test.ts"),
			`import { test, expect, vi } from 'vitest';\n${body}\n`,
		);
		await assert.rejects(
			runPrebuiltTests({
				...paths,
				cwd: paths.root,
				args: ["--coverage", "--maxWorkers=1"],
			}),
			(error) => {
				assert.match(
					error.message,
					new RegExp(`Transformed module URL: .*mock=${variant}`),
				);
				return true;
			},
		);
		assert.equal(
			existsSync(join(paths.root, "coverage/unit/coverage-final.json")),
			false,
		);
	});
