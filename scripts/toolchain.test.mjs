import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	copyFileSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
