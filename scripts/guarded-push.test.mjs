import assert from "node:assert/strict";
import test from "node:test";
import { guardedPush } from "./guarded-push.mjs";
const head = "a".repeat(40),
	expected = "b".repeat(40);
test("guarded publication requires an open unchanged PR and uses a literal expected-head lease", () => {
	const pr = {
		state: "OPEN",
		headRefOid: expected,
		headRefName: "feature/$(literal)",
		headRepository: { name: "repo" },
		headRepositoryOwner: { login: "owner" },
	};
	let pushed;
	const run = (program, args) => {
		if (args[0] === "push") pushed = args;
		return "";
	};
	let reads = 0;
	guardedPush(
		{ pr, expectedHead: expected, head, validatedHead: head },
		run,
		() => (++reads === 1 ? pr : { ...pr, headRefOid: head }),
	);
	assert.ok(
		pushed.includes(
			`--force-with-lease=refs/heads/feature/$(literal):${expected}`,
		),
	);
	assert.equal(pushed.at(-1), `${head}:refs/heads/feature/$(literal)`);
	assert.throws(
		() =>
			guardedPush(
				{
					pr: { ...pr, state: "CLOSED" },
					expectedHead: expected,
					head,
					validatedHead: head,
				},
				run,
				() => pr,
			),
		/open/,
	);
	assert.throws(
		() =>
			guardedPush(
				{ pr, expectedHead: expected, head, validatedHead: head },
				run,
				() => ({ ...pr, headRefOid: head }),
			),
		/changed/,
	);
	assert.throws(
		() =>
			guardedPush(
				{ pr, expectedHead: expected, head, validatedHead: expected },
				run,
				() => pr,
			),
		/validated/,
	);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
test("the actual Git lease rejects a stale remote head", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lease-test-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const remote = path.join(directory, "remote.git"),
		local = path.join(directory, "local");
	fs.mkdirSync(local);
	const git = (args) =>
		execFileSync("git", args, {
			cwd: local,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["init", "--bare", remote]);
	git(["init"]);
	const commit = () =>
		git([
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--allow-empty",
			"-m",
			"test",
		]);
	commit();
	const expectedHead = git(["rev-parse", "HEAD"]).trim();
	git(["push", remote, "HEAD:refs/heads/selected"]);
	commit();
	const head = git(["rev-parse", "HEAD"]).trim();
	const pr = {
		state: "OPEN",
		headRefOid: expectedHead,
		headRefName: "selected",
		headRepository: { name: "repo" },
		headRepositoryOwner: { login: "owner" },
	};
	const run = (_program, args) =>
		git(
			args.map((arg) =>
				arg === "https://github.com/owner/repo.git" ? remote : arg,
			),
		);
	let reads = 0;
	guardedPush({ pr, head, expectedHead, validatedHead: head }, run, () =>
		++reads === 1 ? pr : { ...pr, headRefOid: head },
	);
	assert.equal(
		git(["--git-dir", remote, "rev-parse", "refs/heads/selected"]).trim(),
		head,
	);
	assert.throws(() =>
		guardedPush({ pr, head, expectedHead, validatedHead: head }, run, () => pr),
	);
});

test("rewrite authorization must be an explicit boolean", () => {
	const pr = {
		state: "OPEN",
		headRefOid: expected,
		headRefName: "selected",
		headRepository: { name: "repo" },
		headRepositoryOwner: { login: "owner" },
	};
	assert.throws(
		() =>
			guardedPush(
				{
					pr,
					expectedHead: expected,
					head,
					validatedHead: head,
					rewriteAuthorized: "false",
				},
				() => "",
				() => pr,
			),
		/boolean/,
	);
});
