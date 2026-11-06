import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const apps = [
	"asset",
	"ingestor",
	"gateway",
	"variant-generator",
	"color-extractor",
	"tags",
	"wallpaper",
	"user",
	"web",
];
let root;
let env;
let compose;
let foreground;
let managed;
let managedOutput;

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		env,
		encoding: "utf8",
		timeout: 10_000,
	});
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

function config(file) {
	return JSON.parse(
		run(compose, [
			"-p",
			"watch-fixture",
			"--env-file",
			"/dev/null",
			"-f",
			file,
			"config",
			"--format",
			"json",
		]),
	);
}

before(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "wallpaperdb-compose-watch-"));
	for (const directory of ["infra", "scripts", "bin", ".boat", "docker-config"])
		fs.mkdirSync(path.join(root, directory));
	for (const file of [
		"infra/docker-compose.apps.yml",
		"scripts/boat-watch.mjs",
		"Makefile",
	])
		fs.copyFileSync(path.join(repository, file), path.join(root, file));
	// Copy only maintained configuration and entry points. No app .env, private
	// authority, generated product output, or Docker account config enters here.
	compose = execFileSync("mise", ["which", "docker-compose"], {
		cwd: repository,
		encoding: "utf8",
	}).trim();
	const make = execFileSync("mise", ["which", "make"], {
		cwd: repository,
		encoding: "utf8",
	}).trim();
	env = {
		PATH: `${path.join(root, "bin")}${path.delimiter}/usr/bin:/bin`,
		COMPOSE_PROJECT_NAME: "watch-fixture",
		INGRESS_PORT: "18000",
		COMPOSE_DISABLE_ENV_FILE: "true",
		DOCKER_CONFIG: path.join(root, "docker-config"),
		DOCKER_HOST: `unix://${root}/no-daemon.sock`,
	};
	assert.equal(run(compose, ["version", "--short"]).trim(), "2.40.3");
	foreground = config("infra/docker-compose.apps.yml");
	// boat-watch must use the real Compose config implementation. Reject every
	// other Docker command. Its foreground Make child is rendered with real Make
	// in dry-run mode, so neither check-infra nor watch can contact an engine.
	fs.writeFileSync(
		path.join(root, "bin/docker"),
		`#!${process.execPath}
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.deepEqual(args, ['compose', '-p', 'watch-fixture', '-f', ${JSON.stringify(path.join(root, "infra/docker-compose.apps.yml"))}, 'config', '--format', 'json']);
const result = spawnSync(${JSON.stringify(compose)}, args.slice(1), { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
		{ mode: 0o755 },
	);
	fs.writeFileSync(
		path.join(root, "bin/make"),
		`#!${process.execPath}
const { spawnSync } = require('node:child_process');
const result = spawnSync(${JSON.stringify(make)}, ['-n', ...process.argv.slice(2), 'SHELL=/bin/sh'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
		{ mode: 0o755 },
	);
	managedOutput = run(process.execPath, ["scripts/boat-watch.mjs"]);
	managed = config(".boat/development-compose.json");
});

after(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

function watches(configuration, app) {
	return (configuration.services[app].develop?.watch ?? []).map((rule) => ({
		...rule,
		initial_sync: rule.initial_sync ?? false,
	}));
}

for (const mode of ["foreground", "managed"]) {
	const initial_sync = mode === "managed";
	for (const [source, target] of [
		[
			"drizzle/9999_watch_delivery.sql",
			"/app/apps/asset/drizzle/9999_watch_delivery.sql",
		],
		[
			"drizzle/meta/9999_snapshot.json",
			"/app/apps/asset/drizzle/meta/9999_snapshot.json",
		],
		[
			"drizzle/meta/_journal.json",
			"/app/apps/asset/drizzle/meta/_journal.json",
		],
		["scripts/new-backfill.ts", "/app/apps/asset/scripts/new-backfill.ts"],
		["src/index.ts", "/app/apps/asset/src/index.ts"],
		["package.json", "/app/apps/asset/package.json"],
	]) {
		test(`${mode} Asset watch maps ${source} without a restart`, () => {
			const rules = watches(mode === "managed" ? managed : foreground, "asset");
			const file = path.join(root, "apps/asset", source);
			const matching = rules.filter((rule) => {
				const relative = path.relative(rule.path, file);
				return (
					relative === "" ||
					(!relative.startsWith("..") && !path.isAbsolute(relative))
				);
			});
			assert.equal(
				matching.length,
				1,
				`Watch coverage for apps/asset/${source}`,
			);
			const [rule] = matching;
			assert.equal(rule.action, "sync");
			assert.equal(rule.initial_sync, initial_sync);
			assert.equal(
				path.posix.join(rule.target, path.relative(rule.path, file)),
				target,
			);
			assert.deepEqual(rule.ignore ?? [], []);
		});
	}

	for (const app of apps) {
		test(`${mode} ${app} scopes its literal package-directory ignore to Vitest compiler output`, () => {
			const configuration = mode === "managed" ? managed : foreground;
			const rule = watches(configuration, app).find(
				(item) => item.path === path.join(root, "packages"),
			);
			assert.ok(rule);
			// This is a configuration contract for literal directory entries, not
			// Compose trigger execution or a replacement for its glob matcher.
			// Compose 2.40.3 roots ignores at rule.path and checks parent matches:
			// https://github.com/docker/compose/blob/v2.40.3/pkg/watch/dockerignore.go
			// Existing glob entries are preserved exactly in the rule check below.
			const directories = (rule.ignore ?? [])
				.filter((pattern) => !pattern.includes("*"))
				.map((directory) => path.resolve(rule.path, directory));
			for (const [file, ignored] of [
				["vitest-config/src/index.ts", false],
				["vitest-config/src/defaults.ts", false],
				["vitest-config/package.json", false],
				["vitest-config/tsconfig.json", false],
				["vitest-config/dist-next/index.js", false],
				["vitest-config/dist.js", false],
				["vitest-config-next/dist/index.js", false],
				["nested/vitest-config/dist/index.js", false],
				// profile-markdown actually exports this built JS at runtime.
				["profile-markdown/dist/index.js", false],
				["profile-markdown/src/index.ts", false],
				["profile-markdown/package.json", false],
				["core/src/index.ts", false],
				["core/package.json", false],
				// tsc emits these eight files from src/{index,defaults}.ts with
				// declaration, declarationMap and sourceMap in this package's tsconfig.
				["vitest-config/dist/index.js", true],
				["vitest-config/dist/index.js.map", true],
				["vitest-config/dist/index.d.ts", true],
				["vitest-config/dist/index.d.ts.map", true],
				["vitest-config/dist/defaults.js", true],
				["vitest-config/dist/defaults.js.map", true],
				["vitest-config/dist/defaults.d.ts", true],
				["vitest-config/dist/defaults.d.ts.map", true],
			]) {
				const absolute = path.join(root, "packages", file);
				assert.equal(
					directories.some((directory) => {
						const relative = path.relative(directory, absolute);
						return (
							relative === "" ||
							(!relative.startsWith("..") && !path.isAbsolute(relative))
						);
					}),
					ignored,
					`Literal directory ignore coverage for packages/${file}`,
				);
			}
		});

		test(`${mode} preserves ${app} source, shared package restart, and lock rebuild rules`, () => {
			const configuration = mode === "managed" ? managed : foreground;
			const rules = watches(configuration, app);
			const expected = [
				{
					action: "sync",
					path: path.join(root, `apps/${app}/src`),
					target: `/app/apps/${app}/src`,
					initial_sync,
				},
				{
					action: "sync+restart",
					path: path.join(root, "packages"),
					target: "/app/packages",
					ignore: [
						"**/node_modules/**",
						"**/coverage/**",
						"**/.turbo/**",
						"**/*.tsbuildinfo",
						"vitest-config/dist/",
					],
					initial_sync,
				},
				{
					action: "sync",
					path: path.join(root, `apps/${app}/package.json`),
					target: `/app/apps/${app}/package.json`,
					initial_sync,
				},
				{
					action: "rebuild",
					path: path.join(root, "pnpm-lock.yaml"),
					initial_sync: false,
				},
			];
			// New Asset delivery directories are checked independently above. All
			// pre-existing rules and every other app must retain their exact shape.
			const existing = rules.filter(
				(rule) =>
					!["apps/asset/drizzle", "apps/asset/scripts"].some(
						(directory) => rule.path === path.join(root, directory),
					),
			);
			assert.deepEqual(
				existing,
				expected.map((rule) => ({ ...rule, exec: { command: null } })),
				app,
			);
			assert.equal(rules.length, app === "asset" ? 6 : 4, app);
		});
	}
	test(`${mode} preserves the application service set and unwatched ingress`, () => {
		const configuration = mode === "managed" ? managed : foreground;
		assert.deepEqual(
			Object.keys(configuration.services).sort(),
			[...apps, "caddy"].sort(),
		);
		assert.equal(configuration.services.caddy.develop, undefined);
	});
}

test("ordinary foreground Make keeps its standard watch command", () => {
	const output = run("make", ["dev", "PACKAGE=", "BOAT_EXEC=local"]);
	assert.ok(
		output
			.split("\n")
			.some(
				(line) =>
					line.trim() ===
					"docker compose -p watch-fixture -f infra/docker-compose.apps.yml watch",
			),
	);
});

test("managed watch uses the foreground Make workflow with --no-up and a private config", () => {
	assert.ok(
		managedOutput.includes(
			`docker compose -p watch-fixture -f ${root}/.boat/development-compose.json watch --no-up`,
		),
	);
	assert.equal(
		fs.statSync(path.join(root, ".boat/development-compose.json")).mode & 0o777,
		0o600,
	);
	assert.deepEqual(
		Object.fromEntries(
			Object.entries(managed.services).map(([name, service]) => [
				name,
				{ ...service, develop: undefined },
			]),
		),
		Object.fromEntries(
			Object.entries(foreground.services).map(([name, service]) => [
				name,
				{ ...service, develop: undefined },
			]),
		),
	);
});
