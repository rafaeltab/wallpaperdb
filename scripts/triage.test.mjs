import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const checker = new URL("./check-triage.mjs", import.meta.url).pathname;

function check(t, labels, status = "Planned", options = {}) {
	const directory = mkdtempSync(path.join(os.tmpdir(), "triage-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const gh = path.join(directory, "gh");
	writeFileSync(
		gh,
		`#!${process.execPath}
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["issue", "view", "499", "--json", "labels,projectItems"]);
if (process.env.TRIAGE_TEST_ERROR) {
  console.error("GitHub unavailable");
  process.exit(1);
}
console.log(process.env.TRIAGE_TEST_SNAPSHOT);
`,
	);
	chmodSync(gh, 0o700);
	return spawnSync(process.execPath, [checker, "499"], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${directory}${path.delimiter}${process.env.PATH}`,
			TRIAGE_TEST_ERROR: options.error ? "1" : "",
			TRIAGE_TEST_SNAPSHOT: JSON.stringify({
				labels: labels.map((name) => ({ name })),
				projectItems: status
					? [
							{
								title: options.project ?? "WallpaperDB",
								status: { name: status },
							},
						]
					: [],
			}),
		},
	});
}

test("completed triage requires exactly one state label", (t) => {
	for (const labels of [
		["bug", "testability"],
		["bug", "ready-for-agent", "ready-for-human"],
	]) {
		const result = check(t, labels);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /exactly one triage state/);
	}
});

test("agent readiness requires a planned or later project status", (t) => {
	for (const status of ["Backlog", "Todo", "Planning", undefined]) {
		const result = check(t, ["ready-for-agent"], status ?? null);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /ready-for-agent requires/);
	}
	const otherProject = check(t, ["ready-for-agent"], "Planned", {
		project: "Other project",
	});
	assert.equal(otherProject.status, 1, otherProject.stderr);
});

test("valid agent readiness accepts later lifecycle states", (t) => {
	for (const status of [
		"Planned",
		"In Progress",
		"In Review",
		"Done",
		"Canary",
		"Released",
	]) {
		const result = check(t, ["bug", "testability", "ready-for-agent"], status);
		assert.equal(result.status, 0, result.stderr);
	}
});

test("human attention and other triage states can precede planning", (t) => {
	for (const label of [
		"ready-for-human",
		"needs-info",
		"needs-triage",
		"wontfix",
	]) {
		const result = check(t, [label], "Todo");
		assert.equal(result.status, 0, result.stderr);
	}
});

test("GitHub read failures cannot pass the check", (t) => {
	const result = check(t, ["ready-for-agent"], "Planned", { error: true });
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /GitHub unavailable/);
});
