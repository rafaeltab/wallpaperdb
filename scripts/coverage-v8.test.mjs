import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vitest = join(require.resolve("vitest/package.json"), "..", "vitest.mjs");
const tsx = require.resolve("tsx/esm/api");
const loader = require.resolve("tsx");
const fixtures = fileURLToPath(
	new URL("./fixtures/coverage-v8/", import.meta.url),
);

function runFixture({
	subprocess = true,
	pool = "forks",
	missingProvenance = false,
	failure = false,
	constrainedHeap = false,
	nativeOnly = false,
	isolate = true,
} = {}) {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-coverage-v8-"));
	const source = join(directory, "subject.ts");
	cpSync(fixtures, directory, { recursive: true });
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ type: "module" }),
	);
	const reports = join(directory, "coverage");
	const config = join(directory, "vitest.config.mjs");
	writeFileSync(
		config,
		`export default {test: {
		isolate: ${isolate}, experimental: {viteModuleRunner: ${!nativeOnly}}, include: ['fixture.test.ts'], pool: ${JSON.stringify(pool)}, maxWorkers: 1,
		coverage: { enabled: true, provider: 'v8', autoAttachSubprocess: ${subprocess},
			include: ${JSON.stringify(nativeOnly ? ["native.ts"] : ["subject.ts", "native.ts"])}, reporter: ['json'], reportsDirectory: ${JSON.stringify(reports)} }
	}}`,
	);
	writeFileSync(
		join(directory, "thread.mjs"),
		`
		import { register } from ${JSON.stringify(tsx)};
		register();
		const { Subject } = await import('./subject.ts');
		if (new Subject('owned-').select('thread') !== 'owned-thread-only') throw Error('thread sentinel');
	`,
	);
	writeFileSync(
		join(directory, "child.mjs"),
		`
		import { Worker } from 'node:worker_threads';
		import { Subject } from './subject.ts';
		if (new Subject('owned-').select('child') !== 'owned-child-only') throw Error('child sentinel');
		await new Promise((resolve, reject) => {
			const worker = new Worker(new URL('./thread.mjs', import.meta.url));
			worker.once('error', reject);
			worker.once('exit', code => code ? reject(Error('worker exit '+code)) : resolve());
		});
	`,
	);
	writeFileSync(
		join(directory, "fixture.test.ts"),
		`
		import { test, expect } from ${JSON.stringify(join(require.resolve("vitest/package.json"), "..", "dist/index.js"))};
		import { spawnSync } from 'node:child_process';
		${nativeOnly ? "" : "import { Subject } from './subject.ts';"}
		import { nativeSelect } from './native.ts';
		test('executes distinct contexts', () => {
			${nativeOnly ? "" : "expect(new Subject('owned-').select('vite')).toBe('owned-vite-only');"}
			expect(nativeSelect(true)).toBe('native-executed');
			${
				subprocess
					? `
			const child = spawnSync(process.execPath, ['--import', ${JSON.stringify(loader)}, 'child.mjs'], {cwd: ${JSON.stringify(directory)}, encoding: 'utf8', timeout: 15000${missingProvenance ? ", env: {...process.env, NODE_OPTIONS: ''}" : constrainedHeap ? ", env: {...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --max-old-space-size=96'}" : ""}});
			expect(child.stderr, child.stdout).toBe('');
			expect(child.status).toBe(0);
			const native = spawnSync(process.execPath, ['--input-type=module', '-e', "import { nativeSelect } from './native.ts'; if(nativeSelect(true)!=='native-executed') throw Error('native sentinel')"], {cwd: ${JSON.stringify(directory)}, encoding: 'utf8', timeout: 15000});
			expect(native.status, native.stderr).toBe(0);
			`
					: ""
			}
			${failure ? "expect.fail('owned fixture failure');" : ""}
		});
	`,
	);
	try {
		const result = spawnSync(
			process.execPath,
			[vitest, "run", "--root", directory, "--config", config],
			{
				cwd: resolve("."),
				encoding: "utf8",
				timeout: 30000,
				env: { ...process.env, NODE_V8_COVERAGE: undefined },
			},
		);
		assert.ifError(result.error);
		const output = result.stdout + result.stderr;
		// Each fixture is gone even on failure; the provider must first reclaim
		// its collector state itself, before this test removes its outer directory.
		if (missingProvenance || failure) {
			assert.notEqual(result.status, 0, output);
			assert.match(
				output,
				missingProvenance
					? /Missing executed subprocess coverage source/
					: /owned fixture failure/,
			);
			assert.deepEqual(
				existsSync(join(reports, "tmp"))
					? readdirSync(join(reports, "tmp"), { recursive: true })
					: [],
				[],
			);
			assert.equal(existsSync(join(reports, ".tmp")), false);
			return;
		}
		assert.equal(result.status, 0, output);
		if (subprocess)
			assert.deepEqual(
				existsSync(join(reports, "tmp"))
					? readdirSync(join(reports, "tmp"), { recursive: true })
					: [],
				[],
			);
		const coverage = JSON.parse(
			readFileSync(join(reports, "coverage-final.json"), "utf8"),
		);
		return {
			coverage: coverage[source],
			nativeCoverage: coverage[join(directory, "native.ts")],
			nativeSource: readFileSync(join(directory, "native.ts"), "utf8"),
			source: readFileSync(source, "utf8"),
			output: result.stdout + result.stderr,
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function assertSentinel(
	coverage,
	source,
	sentinel,
	executed,
	hasBranch = true,
	count = executed ? 1 : 0,
) {
	assert.ok(
		coverage,
		"Executed source must be present in the real provider report",
	);
	const line =
		source.split("\n").findIndex((text) => text.includes(`"${sentinel}"`)) + 1;
	assert.ok(line > 0);
	const statements = Object.entries(coverage.statementMap).filter(
		([, location]) => location.start.line === line,
	);
	assert.ok(
		statements.length,
		`Missing statement for ${sentinel} at source line ${line}`,
	);
	for (const [id] of statements)
		assert.equal(coverage.s[id], count, `Source line ${line}: ${sentinel}`);
	if (!hasBranch) return;
	const branches = Object.entries(coverage.branchMap)
		.flatMap(([id, branch]) =>
			branch.locations.map((location, index) => ({
				location,
				count: coverage.b[id][index],
			})),
		)
		.filter(
			({ location }) =>
				location.start.line <= line && location.end.line >= line,
		);
	assert.ok(branches.length, `Missing branch attribution for ${sentinel}`);
	assert.ok(
		branches.some((branch) => branch.count === count),
		`Wrong branch count for ${sentinel}`,
	);
}

for (const pool of ["forks", "threads"]) {
	test(`built-in V8 maps Vite, tsx child and inherited thread source separately (${pool})`, () => {
		const { coverage, nativeCoverage, nativeSource, source, output } =
			runFixture({ pool });
		for (const sentinel of ["vite-only", "child-only", "thread-only"])
			assertSentinel(coverage, source, sentinel, true);
		assertSentinel(coverage, source, "never-executed", false);
		assertSentinel(
			nativeCoverage,
			nativeSource,
			"native-executed",
			true,
			true,
			2,
		);
		assertSentinel(nativeCoverage, nativeSource, "native-never", false, false);
		assert.doesNotMatch(output, /Failed to parse|Excluding it from coverage/);
	});
}

test("built-in V8 retains ordinary collection without subprocess attachment", () => {
	const { coverage, source } = runFixture({ subprocess: false });
	assertSentinel(coverage, source, "vite-only", true);
	for (const sentinel of ["child-only", "thread-only", "never-executed"])
		assertSentinel(coverage, source, sentinel, false);
});

test("missing inherited provenance fails the real report and reclaims collector state", () => {
	runFixture({ missingProvenance: true });
});

test("test failure reclaims auto-attached collector state", () => {
	runFixture({ failure: true });
});

test("worker stop and collection/start failures restore the inherited environment", () => {
	const directory = mkdtempSync(
		join(tmpdir(), "wallpaperdb-coverage-lifetime-"),
	);
	try {
		const script = join(directory, "lifetime.mjs");
		const provider = require.resolve("@vitest/coverage-v8");
		writeFileSync(
			script,
			`
			import assert from 'node:assert/strict';
			import { existsSync, rmSync, writeFileSync } from 'node:fs';
			import provider from ${JSON.stringify(provider)};
			process.env.NODE_OPTIONS = '--no-warnings';
			const before = {NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE};
			function restored(owned) {
				assert.deepEqual({NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE}, before);
				assert.equal(existsSync(owned), false);
			}
			// Stop before takeCoverage models cancellation of a worker's run.
			await provider.startCoverage({isolate:true, autoAttachSubprocess:true, reportsDirectory:${JSON.stringify(directory)}});
			let owned = process.env.NODE_V8_COVERAGE;
			assert.match(process.env.NODE_OPTIONS, /--no-warnings.*--require=/);
			await provider.stopCoverage({isolate:true});
			restored(owned);
			// A malformed native record must not strand source files or NODE_OPTIONS.
			await provider.startCoverage({isolate:true, autoAttachSubprocess:true, reportsDirectory:${JSON.stringify(directory)}});
			owned = process.env.NODE_V8_COVERAGE;
			writeFileSync(owned+'/coverage-1-1-0.json', '{invalid');
			await assert.rejects(provider.takeCoverage({coverageFilesDirectory:${JSON.stringify(directory)}}));
			restored(owned);
			await provider.stopCoverage({isolate:true});
			await provider.startCoverage({isolate:true, autoAttachSubprocess:true, reportsDirectory:${JSON.stringify(directory)}});
			owned = process.env.NODE_V8_COVERAGE;
			rmSync(owned, {recursive:true});
			await assert.rejects(provider.takeCoverage({coverageFilesDirectory:${JSON.stringify(directory)}}));
			restored(owned);
			await provider.stopCoverage({isolate:true});
			const blocked = ${JSON.stringify(join(directory, "blocked"))};
			writeFileSync(blocked, 'not a directory');
			await assert.rejects(provider.startCoverage({isolate:true, autoAttachSubprocess:true, reportsDirectory:blocked}));
			restored(blocked+'/tmp');
		`,
		);
		const result = spawnSync(process.execPath, [script], {
			encoding: "utf8",
			timeout: 10000,
			env: { ...process.env, NODE_V8_COVERAGE: undefined },
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("additional child heap options retain inherited source collection", () => {
	const { coverage, source } = runFixture({ constrainedHeap: true });
	assertSentinel(coverage, source, "child-only", true);
	assertSentinel(coverage, source, "thread-only", true);
	assertSentinel(coverage, source, "never-executed", false);
});

test("native Vitest execution without subprocess attachment keeps native source coordinates", () => {
	const { nativeCoverage, nativeSource } = runFixture({
		subprocess: false,
		nativeOnly: true,
	});
	assertSentinel(nativeCoverage, nativeSource, "native-executed", true);
	assertSentinel(nativeCoverage, nativeSource, "native-never", false, false);
});

for (const pool of ["forks", "threads"]) {
	test(`reused Vitest workers reclaim source sidecars on isolate teardown (${pool})`, () => {
		const { coverage, source } = runFixture({ isolate: false, pool });
		assertSentinel(coverage, source, "child-only", true);
		assertSentinel(coverage, source, "never-executed", false);
	});
}
