import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	rmSync,
	existsSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const publisher = new URL("./check-pr-history-status.mjs", import.meta.url)
	.pathname;

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-history-status-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	function git(...args) {
		const r = spawnSync("git", args, {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
			},
		});
		assert.equal(r.status, 0, r.stderr);
		return r.stdout.trim();
	}
	function commit(file) {
		writeFileSync(join(root, file), file);
		git("add", "--", file);
		git("-c", "commit.gpgSign=false", "commit", "-m", file);
	}
	git("init", "-b", "main");
	git("config", "user.name", "Status test");
	git("config", "user.email", "status@example.invalid");
	commit("base");
	git("checkout", "-b", "feature");
	commit("feature");
	git("remote", "add", "origin", root);
	const head = git("rev-parse", "HEAD");
	git("checkout", "main");
	commit("independent");
	function record(state = "open") {
		const pr = {
			number: 1,
			state,
			head: { sha: git("rev-parse", "feature") },
			base: { ref: "main", sha: git("rev-parse", "main") },
		};
		writeFileSync(join(root, "pr.json"), JSON.stringify(pr));
	}
	record();
	writeFileSync(
		join(root, "gh"),
		`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const prs = [JSON.parse(fs.readFileSync('pr.json', 'utf8')), ...(fs.existsSync('extra-pr.json') ? [JSON.parse(fs.readFileSync('extra-pr.json', 'utf8'))] : [])];
const endpoint = args.at(-1);
const requested = endpoint.match(/\\/pulls\\/(\\d+)$/);
const ref = endpoint.match(/\\/git\\/ref\\/heads\\/(.+)$/);
const pr = prs.find(p => requested ? p.number === Number(requested[1]) : ref ? p.base.ref === decodeURIComponent(ref[1]) : false) || prs[0];
if (args.includes('POST')) {
  const body = JSON.parse(fs.readFileSync(0, 'utf8'));
  fs.appendFileSync('statuses.jsonl', JSON.stringify({endpoint: args.find(x => x.includes('/statuses/')), ...body}) + '\\n');
  console.log('{}');
} else if (args.includes('--slurp')) {
  const base = new URL('https://fixture/' + endpoint).searchParams.get('base');
  console.log(JSON.stringify([prs.filter(p => !base || p.base.ref === base)]));
}
else if (args.some(x => x.includes('/git/ref/heads/'))) console.log(JSON.stringify({object: {sha: process.env.TEST_FORCE_BASE || (fs.existsSync('current-base') ? fs.readFileSync('current-base', 'utf8') : pr.base.sha)}}));
else {
  const reads = fs.existsSync('reads') ? Number(fs.readFileSync('reads', 'utf8')) + 1 : 1;
  fs.writeFileSync('reads', String(reads));
  if (reads >= 2 && process.env.TEST_CLOSE_DURING_CHECK) pr.state = 'closed';
  if (reads >= 2 && process.env.TEST_ADVANCED_BASE) {
    pr.base.sha = process.env.TEST_ADVANCED_BASE;
    fs.writeFileSync('current-base', pr.base.sha);
  }
  console.log(JSON.stringify(pr));
}
`,
		{ mode: 0o700 },
	);
	const env = {
		...process.env,
		PATH: `${root}:${process.env.PATH}`,
		GITHUB_REPOSITORY: "fixture/repo",
		HISTORY_BASE: "main",
	};
	function run(...args) {
		return spawnSync(process.execPath, [publisher, ...args], {
			cwd: root,
			encoding: "utf8",
			env,
		});
	}
	function statuses() {
		const path = join(root, "statuses.jsonl");
		return existsSync(path)
			? readFileSync(path, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line))
			: [];
	}
	return { root, git, commit, head, record, run, statuses, env };
}

test("a base push publishes history status for each open PR comparison", (t) => {
	const f = fixture(t);
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		f.statuses().map((s) => s.state),
		["pending", "success"],
	);
	assert.equal(f.statuses()[1].context, "PR history #1");
	assert.match(f.statuses()[1].endpoint, new RegExp(`${f.head}$`));
	assert.ok(
		f
			.statuses()[1]
			.description.includes(f.git("rev-parse", "main").slice(0, 12)),
	);
});

test("trusted reconciliation checks open PRs across all base branches", (t) => {
	const f = fixture(t);
	delete f.env.HISTORY_BASE;
	f.git("branch", "stack", "main");
	writeFileSync(
		join(f.root, "extra-pr.json"),
		JSON.stringify({
			number: 2,
			state: "open",
			head: { sha: f.head },
			base: { ref: "stack", sha: f.git("rev-parse", "stack") },
		}),
	);
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		f.statuses().map((s) => s.state),
		["pending", "success", "pending", "success"],
	);
	assert.deepEqual(
		[...new Set(f.statuses().map((s) => s.context))],
		["PR history #1", "PR history #2"],
	);
});

test("a base advance that lands the patch replaces stale green with failure", (t) => {
	const f = fixture(t);
	f.git("-c", "commit.gpgSign=false", "cherry-pick", "-x", f.head);
	f.commit("later");
	f.record();
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		f.statuses().map((s) => s.state),
		["pending", "failure"],
	);
	assert.match(result.stdout, /already match/);
});

test("closed PRs receive no history status writes", (t) => {
	const f = fixture(t);
	f.record("closed");
	assert.equal(f.run("1").status, 0);
	assert.deepEqual(f.statuses(), []);
});

test("closing during validation prevents the final status write", (t) => {
	const f = fixture(t);
	f.env.TEST_CLOSE_DURING_CHECK = "1";
	assert.equal(f.run("1").status, 0);
	assert.deepEqual(
		f.statuses().map((s) => s.state),
		["pending"],
	);
});

test("a changed base is rechecked before publishing a final result", (t) => {
	const f = fixture(t);
	f.git("-c", "commit.gpgSign=false", "cherry-pick", "-x", f.head);
	f.env.TEST_ADVANCED_BASE = f.git("rev-parse", "main");
	const result = f.run("1");
	assert.notEqual(result.status, 0);
	assert.deepEqual(
		f.statuses().map((s) => s.state),
		["pending", "pending", "failure"],
	);
	assert.ok(
		f
			.statuses()
			.at(-1)
			.description.includes(f.env.TEST_ADVANCED_BASE.slice(0, 12)),
	);
});

test("the live base ref overrides a stale SHA in PR metadata", (t) => {
	const f = fixture(t);
	f.git("-c", "commit.gpgSign=false", "cherry-pick", "-x", f.head);
	f.env.TEST_FORCE_BASE = f.git("rev-parse", "main");
	const result = f.run("1");
	assert.notEqual(result.status, 0);
	assert.equal(f.statuses().at(-1).state, "failure");
	assert.ok(
		f
			.statuses()
			.at(-1)
			.description.includes(f.env.TEST_FORCE_BASE.slice(0, 12)),
	);
});

test("the PR cannot replace the trusted validator with its own script", (t) => {
	const f = fixture(t);
	f.git("checkout", "feature");
	mkdirSync(join(f.root, "scripts"));
	writeFileSync(
		join(f.root, "scripts/check-pr-history.mjs"),
		"require('node:fs').writeFileSync('executed-head-code', ''); process.exit(0)",
	);
	f.git("add", "scripts");
	f.git("-c", "commit.gpgSign=false", "commit", "-m", "replace validator");
	f.git("-c", "commit.gpgSign=false", "merge", "main", "--no-edit");
	f.record();
	const result = f.run("1");
	assert.notEqual(result.status, 0);
	assert.match(result.stdout, /merge commits/);
	assert.equal(f.statuses().at(-1).state, "failure");
	assert.equal(existsSync(join(f.root, "executed-head-code")), false);
});
