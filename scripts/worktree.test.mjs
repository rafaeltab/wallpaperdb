import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const portKeys = [
	"INGRESS_PORT",
	"POSTGRES_HOST_PORT",
	"S3_API_HOST_PORT",
	"NATS_HOST_PORT",
	"REDIS_HOST_PORT",
	"OPENSEARCH_HOST_PORT",
	"OTEL_HTTP_HOST_PORT",
	"OTEL_GRPC_HOST_PORT",
];

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-worktree-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const main = join(root, "main");
	const bin = join(root, "bin");
	mkdirSync(main);
	mkdirSync(bin);
	const dockerLog = join(root, "docker.log");
	writeFileSync(
		join(bin, "docker"),
		`#!${process.execPath}\n` +
			`const fs = require("node:fs");\n` +
			`fs.appendFileSync(process.env.WORKTREE_TEST_DOCKER_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n` +
			`console.log("2.22.0");\n`,
		{ mode: 0o755 },
	);
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		XDG_CONFIG_HOME: join(root, "config"),
		WORKTREE_TEST_DOCKER_LOG: dockerLog,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
	};
	for (const key of Object.keys(env)) {
		if (
			key.startsWith("GIT_") &&
			!["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"].includes(key)
		) {
			delete env[key];
		}
	}
	for (const key of ["COMPOSE_PROJECT_NAME", ...portKeys]) delete env[key];

	function git(cwd, ...args) {
		return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
	}
	git(main, "init", "--initial-branch=main");
	git(
		main,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"Initial commit",
	);

	function addWorktree(name, branch = name) {
		const path = join(root, name);
		git(main, "worktree", "add", "-b", branch, path);
		return path;
	}

	function prepare(cwd) {
		mkdirSync(join(cwd, "infra"), { recursive: true });
		copyFileSync(
			join(repoRoot, "infra/.env.example"),
			join(cwd, "infra/.env.example"),
		);
		for (const name of ["docker-compose.yml", "docker-compose.apps.yml"]) {
			writeFileSync(join(cwd, "infra", name), "services: {}\n");
		}
	}

	function run(script, cwd, ...args) {
		return execFileSync(
			process.execPath,
			[join(repoRoot, "scripts", script), ...args],
			{
				cwd,
				env,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	}

	return { main, addWorktree, git, prepare, run, dockerLog };
}

function readValues(path) {
	return Object.fromEntries(
		readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => /^[A-Z0-9_]+=/.test(line))
			.map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1)];
			}),
	);
}

function assertGenerated(cwd, projectName, slot) {
	const worktree = readValues(join(cwd, ".worktree"));
	const infra = readValues(join(cwd, "infra/.env"));
	assert.equal(worktree.COMPOSE_PROJECT_NAME, projectName);
	assert.equal(infra.COMPOSE_PROJECT_NAME, projectName);
	assert.equal(worktree.WORKTREE_SLOT, String(slot));
	for (const [offset, key] of portKeys.entries()) {
		const expected = String(8000 + slot * 10 + offset);
		assert.equal(worktree[key], expected);
		assert.equal(infra[key], expected);
	}
	return readFileSync(join(cwd, ".worktree"), "utf8");
}

test("setup keeps the administrative worktree identity and ports across HEAD changes", (t) => {
	const { main, addWorktree, git, prepare, run } = fixture(t);
	const worktree = addWorktree("t3-3e761aad", "feature/original");
	prepare(worktree);
	const gitDir = resolve(worktree, git(worktree, "rev-parse", "--git-dir"));
	assert.equal(basename(gitDir), "t3-3e761aad");
	writeFileSync(join(gitDir, "worktree-slot"), "29");
	run("setup-worktree.mjs", worktree);
	const generated = assertGenerated(worktree, "wallpaperdb-t3-3e761aad", 29);
	const changes = [
		[],
		["switch", "-c", "feature/switched"],
		["branch", "-m", "feature/renamed"],
		["switch", "--detach", git(main, "rev-parse", "HEAD")],
	];
	for (const args of changes) {
		if (args.length) git(worktree, ...args);
		run("setup-worktree.mjs", worktree);
		assert.equal(
			assertGenerated(worktree, "wallpaperdb-t3-3e761aad", 29),
			generated,
		);
	}
});
