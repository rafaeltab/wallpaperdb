import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("CLI cold run, reusable baseline, changed test invalidation and portable import", (t) => {
	const root = mkdtempSync(join(tmpdir(), "mutation-cli-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workspace = join(root, "packages/demo");
	const put = (file, value) => {
		mkdirSync(join(root, file, ".."), { recursive: true });
		writeFileSync(join(root, file), value);
	};
	put(".gitignore", "node_modules\nreports\n.stryker-tmp\n");
	put(
		"packages/demo/package.json",
		'{"name":"@wallpaperdb/demo","type":"module"}',
	);
	put(
		"packages/demo/src/index.js",
		"export function allowed(n) { return n >= 3; }",
	);
	put(
		"packages/demo/test/index.test.js",
		"import {it,expect} from 'vitest'; import {allowed} from '../src/index.js'; it('boundary', () => {expect(allowed(3)).toBe(true); expect(allowed(2)).toBe(false);});",
	);
	put("packages/demo/vitest.config.js", "export default {test:{}};");
	put(
		"packages/demo/mutation.config.json",
		JSON.stringify({
			suites: {
				unit: { vitest: { configFile: "vitest.config.js", related: false } },
			},
		}),
	);
	symlinkSync(
		fileURLToPath(new URL("./node_modules", import.meta.url)),
		join(workspace, "node_modules"),
	);
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-q");
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"commit",
		"-qm",
		"fixture",
	);
	let activeRoot = root;
	const run = (...args) => {
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL("./mutation.mjs", import.meta.url)),
				"--package",
				"demo",
				"--scope",
				"all",
				"--budget",
				"30",
				"--offline",
				...args,
			],
			{ cwd: activeRoot, encoding: "utf8", timeout: 45_000 },
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return JSON.parse(
			readFileSync(
				join(activeRoot, "packages/demo/reports/mutation/unit/summary.json"),
			),
		);
	};
	const cold = run();
	assert.ok(cold.executed > 0);
	assert.equal(cold.outcome, "completed");
	const warm = run();
	assert.equal(warm.executed, 0);
	assert.equal(warm.completed, cold.completed);
	const second = mkdtempSync(join(tmpdir(), "mutation-new-worktree-"));
	t.after(() => rmSync(second, { recursive: true, force: true }));
	git("worktree", "add", "--detach", second, "HEAD");
	symlinkSync(
		fileURLToPath(new URL("./node_modules", import.meta.url)),
		join(second, "packages/demo/node_modules"),
	);
	activeRoot = second;
	assert.equal(
		run().executed,
		0,
		"a newly created worktree uses the shared baseline",
	);
	assert.equal(
		run("--scope", "changed", "--base", "HEAD").outcome,
		"no-changes",
	);
	activeRoot = root;

	const checkpoint = readFileSync(
		join(workspace, "reports/mutation/unit/checkpoint.json"),
	);
	rmSync(join(root, ".git/mutation"), { recursive: true });
	put("import.json", checkpoint);
	assert.equal(run("--baseline", join(root, "import.json")).executed, 0);
	put(
		"packages/demo/test/index.test.js",
		"import {it,expect} from 'vitest'; import {allowed} from '../src/index.js'; it('boundary', () => expect(allowed(3)).toBe(true));",
	);
	assert.ok(run().executed > 0, "changed assertions must be retested");
	assert.equal(
		run("--scope", "changed", "--base", "HEAD").scope,
		"all",
		"test changes select the full mutation scope",
	);
	put(
		"packages/demo/src/index.js",
		`export function allowed(n) { return n > 0 ? ${Array(80).fill("1").join("+")} : 0; }`,
	);
	put(
		"packages/demo/test/index.test.js",
		"import {it,expect} from 'vitest'; import {allowed} from '../src/index.js'; it('boundary', async () => {await new Promise(r => setTimeout(r, 25)); expect(allowed(1)).toBe(80); expect(allowed(0)).toBe(0);});",
	);
	const partial = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("./mutation.mjs", import.meta.url)),
			"--package",
			"demo",
			"--scope",
			"all",
			"--budget",
			"2",
			"--offline",
		],
		{ cwd: root, encoding: "utf8", timeout: 20_000 },
	);
	assert.equal(partial.status, 2, partial.stdout + partial.stderr);
	const interrupted = JSON.parse(
		readFileSync(join(workspace, "reports/mutation/unit/summary.json")),
	);
	assert.equal(interrupted.outcome, "budget-exhausted");
	assert.ok(
		interrupted.completed > 0 && interrupted.completed < interrupted.total,
		JSON.stringify(interrupted),
	);
	assert.equal(interrupted.checkpointSaved, true);
	const resumed = run();
	assert.ok(
		resumed.executed < resumed.total,
		"resume must reuse the interrupted checkpoint",
	);
	assert.equal(resumed.completed, resumed.total);
	put(
		"packages/demo/test/index.test.js",
		"import {it} from 'vitest'; throw Object.create(null); it('unreachable', () => {});",
	);
	const failure = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("./mutation.mjs", import.meta.url)),
			"--package",
			"demo",
			"--scope",
			"all",
			"--budget",
			"30",
			"--offline",
		],
		{ cwd: root, encoding: "utf8", timeout: 45_000 },
	);
	assert.equal(failure.status, 1, failure.stdout + failure.stderr);
	const failed = JSON.parse(
		readFileSync(join(workspace, "reports/mutation/unit/summary.json")),
	);
	assert.equal(failed.outcome, "failed");
	assert.equal(failed.checkpointSaved, false);
});
