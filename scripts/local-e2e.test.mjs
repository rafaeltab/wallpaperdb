import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repository = new URL("../", import.meta.url).pathname;

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-local-e2e-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "scripts"));
	copyFileSync(join(repository, "Makefile"), join(root, "Makefile"));
	for (const file of ["local-e2e.sh", "local-e2e.mjs"]) {
		try {
			copyFileSync(
				join(repository, "scripts", file),
				join(root, "scripts", file),
			);
		} catch {
			/* Red before implementation. */
		}
	}
	for (const name of ["test-utils", "testcontainers", "web-e2e"]) {
		const directory = join(
			root,
			name === "web-e2e" ? "apps" : "packages",
			name,
		);
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: `@wallpaperdb/${name}` }),
		);
	}
	writeFileSync(
		join(root, "turbo"),
		`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(['turbo', ...args]) + '\\n');
if (args.includes('--dry=json')) {
  const selected = args.filter(x => x.startsWith('--filter=@')).map(x => x.slice(9));
  console.log(JSON.stringify({ tasks: (selected.length ? selected : ['@wallpaperdb/web-e2e', '@wallpaperdb/test-utils', '@wallpaperdb/testcontainers']).map(name => ({package: name, task: 'test:e2e', command: 'test'})) }));
}
`,
		{ mode: 0o700 },
	);
	writeFileSync(
		join(root, "docker"),
		`#!/usr/bin/env node
require('node:fs').appendFileSync('calls.jsonl', JSON.stringify(['docker', ...process.argv.slice(2)]) + '\\n');
`,
		{ mode: 0o700 },
	);
	const env = {
		...process.env,
		PATH: `${root}:${process.env.PATH}`,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
		GITHUB_ACTIONS: "",
		E2E_LOCK_FILE: join(root, "host.lock"),
	};
	for (const key of [
		"PACKAGE",
		"ARGS",
		"FORCE",
		"TURBO_FLAGS",
		"COMPOSE_PROJECT_NAME",
	])
		delete env[key];
	const args = [
		"--no-print-directory",
		"test-e2e",
		`TURBO=${join(root, "turbo")}`,
	];
	return {
		root,
		env,
		args,
		run: (...extra) =>
			spawnSync("make", [...args, ...extra], {
				cwd: root,
				env,
				encoding: "utf8",
				timeout: 15_000,
			}),
		calls: () =>
			readFileSync(join(root, "calls.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
	};
}

test("explicit container-only selection preserves test arguments and FORCE without starting Compose", (t) => {
	const f = fixture(t);
	const result = f.run(
		"PACKAGE=test-utils",
		"ARGS=test/storage.test.ts",
		"FORCE=1",
	);
	assert.equal(result.status, 0, result.stderr);
	const calls = f.calls();
	assert.ok(
		calls.some(
			(call) =>
				call.includes("--filter=@wallpaperdb/test-utils") &&
				call.includes("test/storage.test.ts") &&
				call.includes("--force"),
		),
	);
	assert.ok(calls.some((call) => call[0] === "docker" && call[1] === "info"));
	assert.ok(!calls.some((call) => call.includes("compose")));
	assert.match(result.stdout, /Container E2E/);
});
