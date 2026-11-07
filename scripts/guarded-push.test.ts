import { expect } from "vitest";
import { test } from "vitest";
import { guardedPush } from "./guarded-push.ts";
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
	let pushed: readonly string[] = [];
	const run = (program: string, args: readonly string[]) => {
		if (args[0] === "push") pushed = args;
		return "";
	};
	let reads = 0;
	guardedPush(
		{ pr, expectedHead: expected, head, validatedHead: head },
		run,
		() => (++reads === 1 ? pr : { ...pr, headRefOid: head }),
	);
	expect(
		pushed.includes(
			`--force-with-lease=refs/heads/feature/$(literal):${expected}`,
		),
	).toBeTruthy();
	expect(pushed.at(-1)).toBe(`${head}:refs/heads/feature/$(literal)`);
	expect(() =>
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
	).toThrow(/open/);
	expect(() =>
		guardedPush(
			{ pr, expectedHead: expected, head, validatedHead: head },
			run,
			() => ({ ...pr, headRefOid: head }),
		),
	).toThrow(/changed/);
	expect(() =>
		guardedPush(
			{ pr, expectedHead: expected, head, validatedHead: expected },
			run,
			() => pr,
		),
	).toThrow(/validated/);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
test("the actual Git lease rejects a stale remote head", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lease-test-"));
	t.onTestFinished(() =>
		fs.rmSync(directory, { recursive: true, force: true }),
	);
	const remote = path.join(directory, "remote.git"),
		local = path.join(directory, "local");
	fs.mkdirSync(local);
	const git = (args: readonly string[]) =>
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
	const run = (_program: string, args: readonly string[]) =>
		git(
			args.map((arg) =>
				arg === "https://github.com/owner/repo.git" ? remote : arg,
			),
		);
	let reads = 0;
	guardedPush({ pr, head, expectedHead, validatedHead: head }, run, () =>
		++reads === 1 ? pr : { ...pr, headRefOid: head },
	);
	expect(
		git(["--git-dir", remote, "rev-parse", "refs/heads/selected"]).trim(),
	).toBe(head);
	expect(() =>
		guardedPush({ pr, head, expectedHead, validatedHead: head }, run, () => pr),
	).toThrow();
});

test("rewrite authorization must be an explicit boolean", () => {
	const pr = {
		state: "OPEN",
		headRefOid: expected,
		headRefName: "selected",
		headRepository: { name: "repo" },
		headRepositoryOwner: { login: "owner" },
	};
	expect(() =>
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
	).toThrow(/boolean/);
});
