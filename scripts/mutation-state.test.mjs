import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	mutationContext,
	restoreBaseline,
	publishBaseline,
} from "./lib/mutation-state.mjs";

function fixture(t) {
	const dir = mkdtempSync(join(tmpdir(), "mutation-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const root = join(dir, "repo");
	mkdirSync(root);
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	const put = (file, content) => {
		mkdirSync(join(root, file, ".."), { recursive: true });
		writeFileSync(join(root, file), content);
	};
	put(".gitignore", "node_modules\nreports\n");
	put("pnpm-lock.yaml", "lockfileVersion: 9\n");
	put(
		"packages/demo/package.json",
		JSON.stringify({
			name: "@wallpaperdb/demo",
			dependencies: { "@wallpaperdb/dep": "workspace:*" },
		}),
	);
	put(
		"packages/dep/package.json",
		JSON.stringify({ name: "@wallpaperdb/dep" }),
	);
	put("packages/demo/src/index.ts", "export const value = true;");
	put("packages/demo/test/index.test.ts", 'test("value", () => {});');
	put("packages/demo/test/helper.ts", "export const fixture = 1;");
	put("packages/dep/src/index.ts", "export const dependency = 1;");
	git("add", ".");
	git("commit", "-qm", "fixture");
	const config = {
		vitest: { configFile: "vitest.config.ts" },
		environmentKeys: ["MUTATION_FIXTURE"],
	};
	return {
		root,
		dir,
		put,
		git,
		config,
		context: () => mutationContext(root, "packages/demo", "unit", config),
	};
}
function report() {
	return {
		schemaVersion: "1.0",
		projectRoot: "/old/worktree/packages/demo",
		files: {
			"src/index.ts": {
				source: "export const value = true;",
				language: "typescript",
				mutants: [
					{
						id: "0",
						mutatorName: "BooleanLiteral",
						replacement: "false",
						location: {
							start: { line: 1, column: 22 },
							end: { line: 1, column: 26 },
						},
						status: "Killed",
						killedBy: ["0"],
						coveredBy: ["0"],
						static: true,
					},
				],
			},
		},
		testFiles: {
			"test/index.test.ts": {
				source: 'test("value", () => {});',
				tests: [{ id: "0", name: "value" }],
			},
		},
	};
}
test("a new worktree restores portable state and concurrent publishers cannot truncate it", (t) => {
	const f = fixture(t),
		first = f.context();
	publishBaseline(first, report(), { complete: true });
	const secondRoot = join(f.dir, "second");
	f.git("worktree", "add", "--detach", secondRoot, "HEAD");
	const second = mutationContext(secondRoot, "packages/demo", "unit", f.config);
	assert.equal(second.key, first.key);
	assert.equal(second.cacheDirectory, first.cacheDirectory);
	const restored = restoreBaseline(second);
	assert.equal(restored.report.projectRoot, join(secondRoot, "packages/demo"));
	assert.equal(restored.report.files["src/index.ts"].mutants.length, 1);
	publishBaseline(second, { ...report(), files: {} }, { complete: false });
	assert.equal(
		restoreBaseline(first).report.files["src/index.ts"].mutants.length,
		1,
		"keep fuller compatible progress",
	);
	assert.equal(
		restoreBaseline(
			mutationContext(f.root, "packages/demo", "integration", f.config),
		),
		null,
		"suite separation",
	);
});
test("source/test edits use Stryker diffs; helpers, dependencies and toolchain invalidate reuse", (t) => {
	const f = fixture(t),
		before = f.context();
	publishBaseline(before, report(), { complete: true });
	f.put("packages/demo/test/index.test.ts", 'test("changed", () => {});');
	assert.equal(f.context().key, before.key);
	assert.equal(
		restoreBaseline(f.context()).report.files["src/index.ts"].mutants.length,
		0,
		"static results cannot survive changed test inputs",
	);
	f.put("packages/demo/src/index.ts", "export const value = false;");
	assert.equal(f.context().key, before.key);
	for (const path of [
		"packages/demo/test/helper.ts",
		"packages/dep/src/index.ts",
		"pnpm-lock.yaml",
	]) {
		const key = f.context().key;
		f.put(path, `${readFileSync(join(f.root, path), "utf8")}\n// changed`);
		assert.notEqual(f.context().key, key, path);
	}
});
test("declared environment changes invalidate reuse without persisting values", (t) => {
	const f = fixture(t);
	const previous = process.env.MUTATION_FIXTURE;
	t.after(() => {
		if (previous === undefined) delete process.env.MUTATION_FIXTURE;
		else process.env.MUTATION_FIXTURE = previous;
	});
	process.env.MUTATION_FIXTURE = "private-test-value";
	const first = f.context();
	const file = publishBaseline(first, report(), { complete: true });
	assert.ok(!readFileSync(file, "utf8").includes("private-test-value"));
	process.env.MUTATION_FIXTURE = "different";
	assert.notEqual(f.context().key, first.key);
});
test("invalid reports and zero-test survivors are rejected", (t) => {
	const f = fixture(t),
		context = f.context();
	const bad = report();
	bad.files["../outside.ts"] = bad.files["src/index.ts"];
	assert.throws(
		() => publishBaseline(context, bad, { complete: true }),
		/path/i,
	);
	const falseSurvivor = report();
	Object.assign(falseSurvivor.files["src/index.ts"].mutants[0], {
		status: "Survived",
		testsCompleted: 0,
	});
	assert.throws(
		() => publishBaseline(context, falseSurvivor, { complete: true }),
		/zero tests/i,
	);
});
