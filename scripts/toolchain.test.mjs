import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	copyFileSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { resolve } from "node:path";

test("Make rejects an unmanaged toolchain before running a workspace command", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-toolchain-"));
	try {
		mkdirSync(join(directory, "scripts"));
		copyFileSync("Makefile", join(directory, "Makefile"));
		copyFileSync(
			"scripts/mise-shell.sh",
			join(directory, "scripts/mise-shell.sh"),
		);
		// The fixture deliberately supplies no mise binary.
		mkdirSync(join(directory, "bin"));
		writeFileSync(
			join(directory, "bin", "sh"),
			'#!/bin/sh\nexec /bin/sh "$@"\n',
			{ mode: 0o755 },
		);
		const result = spawnSync("/usr/bin/make", ["build", "PACKAGE=scripts"], {
			cwd: directory,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: join(directory, "bin"),
				MAKEFLAGS: "",
				MFLAGS: "",
			},
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /mise.*CONTRIBUTING.md/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("setup rejects a package-manager pin that disagrees with mise", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-toolchain-"));
	try {
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ packageManager: "pnpm@1.0.0" }),
		);
		copyFileSync("mise.toml", join(directory, "mise.toml"));
		const result = spawnSync(
			process.execPath,
			[resolve("scripts/toolchain.mjs")],
			{
				cwd: directory,
				encoding: "utf8",
				env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: directory },
			},
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /packageManager.*pnpm@10.18.3/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("CI installs the locked project tools instead of selecting separate Node and pnpm versions", () => {
	for (const workflow of ["ci.yml", "e2e.yml", "pr-history.yml"]) {
		const source = readFileSync(`.github/workflows/${workflow}`, "utf8");
		assert.doesNotMatch(
			source,
			/uses: (?:actions\/setup-node|pnpm\/action-setup)@/,
		);
		const jobs = source
			.slice(source.indexOf("\njobs:\n"))
			.split(/^  (?=[\w-]+:\n)/m)
			.filter((job) => job.includes("runs-on:"));
		assert.ok(jobs.length > 0);
		for (const job of jobs) {
			assert.match(job, /uses: jdx\/mise-action@/);
			assert.match(job, /install_args: --locked/);
			assert.match(job, /run: make toolchain/);
		}
	}
});

for (const [version, diagnostic] of [
	["99.0.0", /gh selected.*expected 2.103.0/],
	["2.103.0", /gh resolved outside the managed toolchain/],
]) {
	test(`tool verification rejects an unowned gh executable reporting ${version}`, () => {
		const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-toolchain-"));
		try {
			for (const file of ["mise.toml", "mise.lock", "package.json"])
				copyFileSync(file, join(directory, file));
			mkdirSync(join(directory, "bin"));
			writeFileSync(
				join(directory, "bin/gh"),
				`#!/bin/sh\necho 'gh version ${version}'\n`,
				{ mode: 0o755 },
			);
			const result = spawnSync(
				process.execPath,
				[resolve("scripts/toolchain.mjs")],
				{
					cwd: directory,
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${directory}/bin:${process.env.PATH}`,
						MISE_TRUSTED_CONFIG_PATHS: directory,
					},
				},
			);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, diagnostic);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}

test("setup rejects a container Node version that disagrees with mise", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-toolchain-"));
	try {
		copyFileSync("package.json", join(directory, "package.json"));
		copyFileSync("mise.toml", join(directory, "mise.toml"));
		mkdirSync(join(directory, "apps/example"), { recursive: true });
		writeFileSync(
			join(directory, "apps/example/Dockerfile"),
			"FROM node:20-alpine\n",
		);
		const result = spawnSync(
			process.execPath,
			[resolve("scripts/toolchain.mjs"), "--pins"],
			{
				cwd: directory,
				encoding: "utf8",
				env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: directory },
			},
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Dockerfile.*Node.*22.22.3/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("Make rejects a local override instead of silently changing project tools", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-toolchain-"));
	try {
		mkdirSync(join(directory, "scripts"));
		for (const file of [
			"Makefile",
			"mise.toml",
			"mise.lock",
			"package.json",
			"scripts/mise-shell.sh",
			"scripts/toolchain.mjs",
		]) {
			copyFileSync(file, join(directory, file));
		}
		writeFileSync(
			join(directory, "mise.local.toml"),
			'[tools]\nnode = "22.22.3"\n',
		);
		const result = spawnSync("make", ["build", "PACKAGE=root"], {
			cwd: directory,
			encoding: "utf8",
			env: {
				...process.env,
				MAKEFLAGS: "",
				MFLAGS: "",
				MISE_TRUSTED_CONFIG_PATHS: directory,
			},
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /node.*this checkout's mise.toml/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("Docker builds discover the managed plugin with an explicit host configuration", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-docker-config-"));
	try {
		mkdirSync(join(directory, "cli-plugins"));
		const config =
			'{"auths":{"example.test":{"auth":"fixture"}},"currentContext":"default"}';
		writeFileSync(join(directory, "config.json"), config);
		writeFileSync(
			join(directory, "cli-plugins/docker-buildx"),
			'#!/bin/sh\nif [ "$1" = docker-cli-plugin-metadata ]; then\n  echo \'{"SchemaVersion":"0.1.0","Vendor":"fixture","Version":"0.16.0","ShortDescription":"fixture"}\'\nelse\n  echo HOST_PLUGIN_SELECTED\nfi\n',
			{ mode: 0o755 },
		);
		const result = spawnSync(
			"docker",
			["--config", directory, "buildx", "version"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /github.com\/docker\/buildx v0.37.1/);
		assert.equal(readFileSync(join(directory, "config.json"), "utf8"), config);
		const compose = spawnSync(
			"docker",
			["--config", directory, "compose", "-f", "-", "config", "--services"],
			{
				encoding: "utf8",
				input: "services:\n  command-forwarding:\n    image: alpine:3\n",
			},
		);
		assert.equal(compose.status, 0, compose.stderr);
		assert.equal(compose.stdout.trim(), "command-forwarding");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("Asset integration retains invocation tool trust through Make and strict Turbo", () => {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-turbo-toolchain-"));
	try {
		const home = join(directory, "home");
		const checkout = join(directory, "checkout");
		mkdirSync(join(home, ".local/share/mise"), { recursive: true });
		// Share public installed binaries, never the user's configuration or trust.
		const installs = dirname(
			dirname(dirname(dirname(realpathSync(process.execPath)))),
		);
		symlinkSync(installs, join(home, ".local/share/mise/installs"));
		mkdirSync(join(checkout, "scripts/toolchain-bin"), { recursive: true });
		for (const name of [
			"Makefile",
			"mise.toml",
			"mise.lock",
			"pnpm-lock.yaml",
			"turbo.json",
			"scripts/mise-shell.sh",
			"scripts/toolchain.mjs",
			"scripts/docker-config.mjs",
			"scripts/toolchain-bin/docker",
			"scripts/docker-validation.mjs",
			"scripts/lib/docker-queue.mjs",
		]) {
			mkdirSync(dirname(join(checkout, name)), { recursive: true });
			copyFileSync(name, join(checkout, name));
		}
		const manifest = JSON.parse(readFileSync("package.json", "utf8"));
		writeFileSync(
			join(checkout, "package.json"),
			JSON.stringify({
				name: "toolchain-fixture",
				private: true,
				packageManager: manifest.packageManager,
			}),
		);
		writeFileSync(
			join(checkout, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\n",
		);
		const configuration = JSON.parse(readFileSync("turbo.json", "utf8"));
		const packages = new Set(["@wallpaperdb/asset", "@wallpaperdb/control"]);
		for (const task of Object.keys(configuration.tasks)) {
			if (task.startsWith("@")) packages.add(task.split("#")[0]);
		}
		for (const name of packages) {
			const path = join(checkout, "packages", name.split("/")[1]);
			mkdirSync(path, { recursive: true });
			writeFileSync(
				join(path, "package.json"),
				JSON.stringify({
					name,
					scripts: { "test:integration": `node ../../probe.mjs ${name}` },
				}),
			);
		}
		writeFileSync(
			join(checkout, "compose.yml"),
			"services:\n  toolchain-proof:\n    image: alpine:3\n",
		);
		writeFileSync(
			join(checkout, "probe.mjs"),
			`import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
assert.equal(process.env.TOOLCHAIN_PRIVATE_SENTINEL, undefined);
assert.equal(process.env.DATABASE_URL, undefined);
const keys = ['MISE_TRUSTED_CONFIG_PATHS', 'MISE_LOCKED', 'MISE_AUTO_INSTALL'];
if (process.argv[2] === '@wallpaperdb/asset') {
  const result = spawnSync('docker', ['compose', '-f', '../../compose.yml', 'config', '--format', 'json'], {
    encoding: 'utf8', timeout: 10000,
    env: Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG', ...keys].map(key => [key, process.env[key]])),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).services['toolchain-proof'].image, 'alpine:3');
  assert.deepEqual(keys.map(key => process.env[key]), [resolve('../..'), 'true', 'false']);
} else {
  assert.deepEqual(keys.map(key => process.env[key]), [undefined, undefined, undefined]);
}
console.log('toolchain boundary passed for ' + process.argv[2]);
`,
		);
		const result = spawnSync(
			"timeout",
			[
				"--kill-after=5",
				"30",
				"make",
				"test-integration",
				`TURBO=${resolve("node_modules/.bin/turbo")}`,
				"TURBO_FLAGS=--filter=@wallpaperdb/asset --filter=@wallpaperdb/control --env-mode=strict",
			],
			{
				cwd: checkout,
				encoding: "utf8",
				env: {
					PATH: process.env.PATH,
					HOME: home,
					// Startup may persist trust here. The task's default HOME stays untrusted.
					MISE_STATE_DIR: join(directory, "startup-state"),
					MISE_TRUSTED_CONFIG_PATHS: checkout,
					MISE_LOCKED: "true",
					MISE_AUTO_INSTALL: "false",
					TOOLCHAIN_PRIVATE_SENTINEL: "synthetic-must-not-pass",
					DATABASE_URL: "synthetic-must-not-pass",
					TURBO_TELEMETRY_DISABLED: "1",
					DOCKER_VALIDATION_TIMEOUT: "5",
					// Compose config needs no daemon; use an isolated fixture queue.
					DOCKER_VALIDATION_LOCK_FILE: join(directory, "docker.lock"),
				},
			},
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(
			result.stdout,
			/toolchain boundary passed for @wallpaperdb\/asset/,
		);
		assert.match(
			result.stdout,
			/toolchain boundary passed for @wallpaperdb\/control/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
