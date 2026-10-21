import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const checker = new URL("./check-pr-history.mjs", import.meta.url).pathname;
function fixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "wallpaperdb-pr-history-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	function git(...args) {
		const result = spawnSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
			},
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	}
	git("init", "-b", "main");
	git("config", "user.name", "History test");
	git("config", "user.email", "history@example.invalid");
	function commit(file) {
		writeFileSync(join(cwd, file), file);
		git("add", "--", file);
		git("-c", "commit.gpgSign=false", "commit", "-m", file);
	}
	commit("base");
	git("checkout", "-b", "feature");
	commit("feature");
	function check(base = "main") {
		return spawnSync(process.execPath, [checker, base, "feature"], {
			cwd,
			encoding: "utf8",
		});
	}
	return { git, commit, check };
}

test("linear PR history remains valid when main advances independently", (t) => {
	const f = fixture(t);
	f.git("checkout", "main");
	f.commit("independent");
	const result = f.check();
	assert.equal(result.status, 0, result.stderr);
});

test("a conflict-resolution merge fails the rebase-only history check", (t) => {
	const f = fixture(t);
	f.git("checkout", "main");
	f.commit("independent");
	f.git("checkout", "feature");
	f.git("-c", "commit.gpgSign=false", "merge", "main", "--no-edit");
	const result = f.check();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /merge commit/);
});

test("already-landed contents fail even when the original commits differ", (t) => {
	const f = fixture(t);
	const head = f.git("rev-parse", "feature");
	f.git("checkout", "main");
	f.git("-c", "commit.gpgSign=false", "cherry-pick", "-x", head);
	const result = f.check();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /already match/);
});

test("already-landed patches fail after the base gains unrelated changes", (t) => {
	const f = fixture(t);
	const head = f.git("rev-parse", "feature");
	f.git("checkout", "main");
	f.git("-c", "commit.gpgSign=false", "cherry-pick", "-x", head);
	f.commit("independent");
	const result = f.check();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /already match|already landed/);
});
