import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
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
		return execFileSync("git", args, {
			cwd,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
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
		const result = spawnSync(
			process.execPath,
			[join(repoRoot, "scripts", script), ...args],
			{
				cwd,
				env,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout + result.stderr;
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

test("setup allocates distinct projects and slots to detached worktrees at the same commit", (t) => {
	const { main, addWorktree, git, prepare, run } = fixture(t);
	const first = addWorktree("first/shared", "first-branch");
	const second = addWorktree("second/shared", "second-branch");
	for (const [index, cwd] of [first, second].entries()) {
		prepare(cwd);
		git(cwd, "switch", "--detach", git(main, "rev-parse", "HEAD"));
		const output = run("setup-worktree.mjs", cwd);
		assert.doesNotMatch(output, /Slug collision/);
		assertGenerated(
			cwd,
			index === 0 ? "wallpaperdb-shared" : "wallpaperdb-shared1",
			index + 1,
		);
	}
	const output = run("setup-worktree.mjs", first);
	assert.doesNotMatch(output, /Slug collision/);
	assertGenerated(first, "wallpaperdb-shared", 1);
});

test("setup preserves the main checkout project, slot zero, and ports across branch changes", (t) => {
	const { main, git, prepare, run } = fixture(t);
	prepare(main);
	run("setup-worktree.mjs", main);
	const generated = assertGenerated(main, "wallpaperdb", 0);
	git(main, "switch", "-c", "other-branch");
	run("setup-worktree.mjs", main);
	assert.equal(assertGenerated(main, "wallpaperdb", 0), generated);
});

test("setup preserves Docker-safe normalization, fallback, and the 63-character limit", (t) => {
	const { addWorktree, prepare, run } = fixture(t);
	const cases = [
		["--MiXeD__Worktree!!--", "wallpaperdb-mixedworktree"],
		["___", "wallpaperdb-worktree"],
		["L".repeat(80), `wallpaperdb-${"l".repeat(51)}`],
	];
	for (const [index, [name, expected]] of cases.entries()) {
		const cwd = addWorktree(name, `branch-${index}`);
		prepare(cwd);
		run("setup-worktree.mjs", cwd);
		assertGenerated(cwd, expected, index + 1);
		assert.match(expected, /^[a-z0-9][a-z0-9-]*$/);
		assert.ok(expected.length <= 63);
	}
});

test("collision diagnostics use administrative identities even when HEAD is missing", (t) => {
	const { addWorktree, git, prepare, run } = fixture(t);
	const first = addWorktree("Feature_ID", "unrelated-first-branch");
	const second = addWorktree("FeatureID", "unrelated-second-branch");
	prepare(first);
	prepare(second);
	run("setup-worktree.mjs", first);
	const gitDir = resolve(first, git(first, "rev-parse", "--git-dir"));
	rmSync(join(gitDir, "HEAD"));
	const output = run("setup-worktree.mjs", second);
	assertGenerated(second, "wallpaperdb-featureid", 2);
	assert.match(output, /Slug collision detected/);
	assert.match(output, /Project name: wallpaperdb-featureid/);
	assert.ok(output.includes(first));
	assert.ok(output.includes(second));
	assert.match(output, /administrative worktree name/);
	assert.doesNotMatch(output, /Rename one branch/);
});

function assertComposeDown(dockerLog, projectName, removeVolumes) {
	const commands = readFileSync(dockerLog, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((args) => args.includes("down"));
	assert.equal(commands.length, 2);
	for (const [index, args] of commands.entries()) {
		assert.equal(args[args.indexOf("-p") + 1], projectName);
		assert.equal(
			basename(args[args.indexOf("-f") + 1]),
			index === 0 ? "docker-compose.apps.yml" : "docker-compose.yml",
		);
		assert.equal(args.includes("--volumes"), removeVolumes);
		assert.ok(args.includes("--remove-orphans"));
		assert.equal(args[args.indexOf("--profile") + 1], "*");
	}
}

test("normal teardown uses the saved project name and releases the linked-worktree slot", (t) => {
	const { addWorktree, git, prepare, run, dockerLog } = fixture(t);
	const cwd = addWorktree("normal-worktree", "original-branch");
	prepare(cwd);
	run("setup-worktree.mjs", cwd);
	assertGenerated(cwd, "wallpaperdb-normal-worktree", 1);
	const gitDir = resolve(cwd, git(cwd, "rev-parse", "--git-dir"));
	git(cwd, "switch", "-c", "changed-branch");
	// The generated name is authoritative, including for an older setup.
	const path = join(cwd, ".worktree");
	writeFileSync(
		path,
		readFileSync(path, "utf8").replace(
			"wallpaperdb-normal-worktree",
			"wallpaperdb-saved-project",
		),
	);
	run("teardown-worktree.mjs", cwd);
	assertComposeDown(dockerLog, "wallpaperdb-saved-project", true);
	assert.equal(existsSync(join(gitDir, "worktree-slot")), false);
});

test("normal teardown preserves main-checkout volumes", (t) => {
	const { main, prepare, run, dockerLog } = fixture(t);
	prepare(main);
	run("setup-worktree.mjs", main);
	assertGenerated(main, "wallpaperdb", 0);
	run("teardown-worktree.mjs", main);
	assertComposeDown(dockerLog, "wallpaperdb", false);
});

for (const [headState, name] of [
	["branch", "--MiXeD__Worktree!!--"],
	["detached", "L".repeat(80)],
	["missing", "___"],
]) {
	test(`stale teardown selects setup's project with ${headState} HEAD`, (t) => {
		const { main, addWorktree, git, prepare, run, dockerLog } = fixture(t);
		const cwd = addWorktree(name, "original-branch");
		prepare(main);
		prepare(cwd);
		run("setup-worktree.mjs", cwd);
		const projectName = readValues(join(cwd, ".worktree")).COMPOSE_PROJECT_NAME;
		const gitDir = resolve(cwd, git(cwd, "rev-parse", "--git-dir"));
		if (headState === "branch") git(cwd, "branch", "-m", "renamed-branch");
		if (headState === "detached") git(cwd, "switch", "--detach", "HEAD");
		if (headState === "missing") rmSync(join(gitDir, "HEAD"));
		rmSync(cwd, { recursive: true });
		const slotFile = join(gitDir, "worktree-slot");
		const output = run("teardown-worktree.mjs", main, "--slot-file", slotFile);
		assertComposeDown(dockerLog, projectName, true);
		assert.equal(existsSync(slotFile), false);
		assert.ok(output.includes(`worktree: ${basename(gitDir)}`));
		assert.doesNotMatch(output, /branch:/);
	});
}
