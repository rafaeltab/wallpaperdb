import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const workspaces = [
	"scripts",
	"infra",
	...["apps", "packages"].flatMap((group) =>
		readdirSync(join(repository, group))
			.filter((name) =>
				existsSync(join(repository, group, name, "package.json")),
			)
			.map((name) => `${group}/${name}`),
	),
];

function isolatedRepository() {
	const directory = mkdtempSync(join(tmpdir(), "biome-make-lint-"));
	for (const name of [
		"Makefile",
		"package.json",
		"pnpm-workspace.yaml",
		"pnpm-lock.yaml",
		"turbo.json",
		"biome.json",
		"crap.config.mts",
		".gitignore",
	])
		copyFileSync(join(repository, name), join(directory, name));
	// Newer Makefiles enter the locked toolchain before workspace tasks. Keep
	// this fixture usable on both sides of that independently landed change.
	for (const name of [
		"mise.toml",
		"mise.lock",
		".npmrc",
		"scripts/mise-shell.sh",
		"scripts/toolchain.mjs",
		"scripts/crap.mts",
		"mutation.inventory.json",
		"scripts/mutation.mjs",
		"scripts/lib/mutation-catalog.mjs",
	]) {
		if (!existsSync(join(repository, name))) continue;
		mkdirSync(dirname(join(directory, name)), { recursive: true });
		copyFileSync(join(repository, name), join(directory, name));
	}
	symlinkSync(
		join(repository, "node_modules"),
		join(directory, "node_modules"),
	);
	for (const workspace of workspaces) {
		const target = join(directory, workspace);
		mkdirSync(target, { recursive: true });
		for (const file of ["package.json", "biome.json", "mutation.config.json"])
			if (existsSync(join(repository, workspace, file)))
				copyFileSync(join(repository, workspace, file), join(target, file));
		if (existsSync(join(repository, workspace, "node_modules")))
			symlinkSync(
				join(repository, workspace, "node_modules"),
				join(target, "node_modules"),
			);
	}
	const rules = "packages/biome-test-rules";
	copyFileSync(
		join(repository, rules, "test-correctness.json"),
		join(directory, rules, "test-correctness.json"),
	);
	cpSync(join(repository, rules, "src"), join(directory, rules, "src"), {
		recursive: true,
	});
	const git = spawnSync("git", ["init", "--quiet", directory], {
		encoding: "utf8",
	});
	assert.equal(git.status, 0, git.stderr);
	gitFixture(directory, ["add", "--", "."]);
	gitFixture(directory, [
		"-c",
		"user.name=Biome regression",
		"-c",
		"user.email=biome@example.invalid",
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"Fixture baseline",
	]);
	return directory;
}

function gitFixture(directory, args) {
	const result = spawnSync("git", ["-C", directory, ...args], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
}

function makeEnvironment(directory) {
	return {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
		// This is the reviewed configuration copied into our own temporary fixture.
		MISE_TRUSTED_CONFIG_PATHS: [
			process.env.MISE_TRUSTED_CONFIG_PATHS,
			directory,
		]
			.filter(Boolean)
			.join(":"),
	};
}

function makeLint(directory, workspace, force = true) {
	const filter = workspace === "root" ? "//" : `@wallpaperdb/${workspace}`;
	// The fixture owns configuration and sources, while dependency builds are
	// validated by repository CI. Run the actual Make/Turbo lint task in isolation.
	const result = spawnSync(
		"make",
		[
			"lint",
			`PACKAGE=${workspace}`,
			`TURBO_FLAGS=--filter=${filter} --only${force ? " --force" : ""}`,
		],
		{
			cwd: directory,
			encoding: "utf8",
			timeout: 30_000,
			env: makeEnvironment(directory),
		},
	);
	assert.equal(result.error, undefined);
	return { status: result.status, output: result.stdout + result.stderr };
}

function makeRuleTests(directory) {
	const env = makeEnvironment(directory);
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(
		"make",
		[
			"test-unit",
			"PACKAGE=biome-test-rules",
			"TURBO_FLAGS=--filter=@wallpaperdb/biome-test-rules --only",
		],
		{
			cwd: directory,
			encoding: "utf8",
			timeout: 30_000,
			env,
		},
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	return result.stdout + result.stderr;
}

test("unit coverage combines with the CRAP JavaScript rule inventory", () => {
	const directory = isolatedRepository();
	try {
		const workspace = join(directory, "packages/biome-test-rules");
		mkdirSync(join(workspace, "src"), { recursive: true });
		mkdirSync(join(workspace, "test"));
		writeFileSync(
			join(workspace, "src/measurement.js"),
			"export function measured() {\n  return 42;\n}\n",
		);
		writeFileSync(
			join(workspace, "test/coverage.test.mjs"),
			`import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measured } from '../src/measurement.js';
test('executes measured source', () => assert.equal(measured(), 42));`,
		);
		gitFixture(directory, ["add", "--", "."]);
		makeRuleTests(directory);
		const reportPath = join(workspace, "coverage/unit/coverage-final.json");
		assert.ok(
			existsSync(reportPath),
			"unit task must produce the collector's Istanbul report",
		);
		const coverage = JSON.parse(readFileSync(reportPath, "utf8"));
		const measured = coverage[join(workspace, "src/measurement.js")];
		assert.ok(Object.values(measured.f).some((hits) => hits > 0));
		const unmeasured = coverage[join(workspace, "src/syntax.js")];
		assert.ok(unmeasured, "unloaded maintained rules must remain visible");
		assert.ok(Object.values(unmeasured.s).every((hits) => hits === 0));
		const env = {
			...makeEnvironment(directory),
			PACKAGE: "biome-test-rules",
		};
		delete env.NODE_TEST_CONTEXT;
		const runCollector = (mode) =>
			spawnSync(
				join(repository, "scripts/node_modules/.bin/tsx"),
				[join(directory, "scripts/crap.mts"), mode],
				{
					cwd: directory,
					encoding: "utf8",
					timeout: 60_000,
					env: { ...env, CRAP_THRESHOLD: "0" },
				},
			);
		const report = runCollector("report");
		assert.equal(report.status, 0, report.stdout + report.stderr);
		for (const file of [
			"syntax.js",
			"scope.js",
			"port.js",
			"retry.js",
			"ported/valid-expect.js",
			"ported/valid-expect-in-promise.js",
			"ported/require-awaited-expect-poll.js",
		])
			assert.ok(
				report.stdout.includes(`src/${file}`),
				`missing ${file}: ${report.stdout}`,
			);
		assert.match(
			report.stdout,
			/0\.00%\tpackages\/biome-test-rules\/src\/syntax\.js:/,
		);
		assert.match(
			report.stdout,
			/100\.00%\tpackages\/biome-test-rules\/src\/measurement\.js:/,
		);
		const check = runCollector("check");
		assert.notEqual(
			check.status,
			0,
			"unmeasured rules must not silently pass a zero threshold",
		);
		assert.match(
			check.stdout + check.stderr,
			/CRAP: \d+ of \d+ functions exceed 0\./,
		);
		assert.doesNotMatch(
			check.stdout + check.stderr,
			/ENOENT|No in-scope source|Cannot combine coverage/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

function installRuleTestCounter(directory) {
	const workspace = join(directory, "packages/biome-test-rules");
	mkdirSync(join(workspace, "test"));
	mkdirSync(join(workspace, ".turbo"));
	const count = join(workspace, ".turbo/executions");
	writeFileSync(
		join(workspace, "test/cache.test.mjs"),
		`import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
test('records actual execution', () => {
  const path = '.turbo/executions';
  const previous = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
  writeFileSync(path, String(previous + 1));
});`,
	);
	gitFixture(directory, ["add", "--", "."]);
	return count;
}

test("rule-test cache reruns for staged and untracked discovered source tests", () => {
	const directory = isolatedRepository();
	try {
		const count = installRuleTestCounter(directory);
		makeRuleTests(directory);
		assert.equal(readFileSync(count, "utf8"), "1");
		assert.match(makeRuleTests(directory), /cache hit/);
		assert.equal(readFileSync(count, "utf8"), "1");
		let executions = 1;
		for (const extension of ["ts", "js", "mjs"])
			for (const staged of [true, false]) {
				const fixture = join(
					directory,
					`apps/docs/src/cache-${staged}.test.${extension}`,
				);
				mkdirSync(dirname(fixture), { recursive: true });
				writeFileSync(fixture, "export const value = 1;");
				if (staged)
					gitFixture(directory, ["add", "--", relative(directory, fixture)]);
				makeRuleTests(directory);
				assert.equal(
					readFileSync(count, "utf8"),
					String(++executions),
					`${extension}, ${staged ? "staged" : "untracked"}`,
				);
			}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("root lint cache changes when the shared rules or configuration changes", () => {
	for (const changed of ["rules", "configuration"]) {
		const directory = isolatedRepository();
		try {
			const fixture = join(directory, "test/cache.test.ts");
			mkdirSync(dirname(fixture), { recursive: true });
			writeFileSync(
				fixture,
				'import { expect } from "vitest"; expect(1).toBe(1);',
			);
			const policy = join(directory, "packages/biome-test-rules");
			const rule = join(policy, "src/correctness.ts");
			const stricter = readFileSync(rule, "utf8").replace(
				"maxArgs: 2",
				"maxArgs: 2, minArgs: 2",
			);
			writeFileSync(join(policy, "src/stricter.ts"), stricter);
			assert.equal(makeLint(directory, "root", false).status, 0);
			assert.match(makeLint(directory, "root", false).output, /cache hit/);
			if (changed === "rules") writeFileSync(rule, stricter);
			else {
				const configPath = join(policy, "test-correctness.json");
				writeFileSync(
					configPath,
					readFileSync(configPath, "utf8").replace(
						"src/correctness.ts",
						"src/stricter.ts",
					),
				);
			}
			const result = makeLint(directory, "root", false);
			assert.notEqual(result.status, 0, `${changed}: ${result.output}`);
			assert.match(result.output, /Expect requires at least/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
});

function sourceTestDirectory(path) {
	if (!existsSync(path)) return undefined;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
			return path;
		if (entry.isDirectory()) {
			const found = sourceTestDirectory(join(path, entry.name));
			if (found) return found;
		}
	}
	return undefined;
}

test("Make lint discovers each workspace's actual test directories and accepts valid assertions", () => {
	const fixtures = [["root", "test/integration/biome-discovery-probe.test.ts"]];
	for (const workspace of workspaces) {
		const manifest = JSON.parse(
			readFileSync(join(repository, workspace, "package.json"), "utf8"),
		);
		if (!manifest.scripts?.lint) continue;
		const name = manifest.name.replace("@wallpaperdb/", "");
		for (const subdirectory of ["test", "tests", "specs"])
			if (existsSync(join(repository, workspace, subdirectory)))
				fixtures.push([
					name,
					`${workspace}/${subdirectory}/biome-discovery-probe.test.ts`,
				]);
		const embedded = sourceTestDirectory(join(repository, workspace, "src"));
		if (embedded)
			fixtures.push([
				name,
				`${relative(repository, embedded)}/biome-discovery-probe.test.ts`,
			]);
	}
	fixtures.push(
		["scripts", "scripts/biome-discovery-probe.test.mjs"],
		["infra-local", "infra/biome-discovery-probe.test.ts"],
		["user", "apps/user/test/fixtures/biome-discovery-probe.ts"],
	);
	const directory = isolatedRepository();
	try {
		for (const [workspace, path] of fixtures) {
			const fixture = join(directory, path);
			mkdirSync(dirname(fixture), { recursive: true });
			writeFileSync(
				fixture,
				'import { expect } from "vitest";\nexpect(1, 2);\n',
			);
			const invalid = makeLint(directory, workspace);
			assert.notEqual(invalid.status, 0, path);
			assert.ok(invalid.output.includes(basename(path)), invalid.output);
			assert.match(
				invalid.output,
				/Expect must have a corresponding matcher/,
				path,
			);
			writeFileSync(
				fixture,
				'import { expect } from "vitest";\nexpect(1).toBe(1);\n',
			);
			const valid = makeLint(directory, workspace);
			assert.equal(valid.status, 0, valid.output);
			rmSync(fixture);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("ordinary lint ignores generated sources and deliberately invalid CRAP fixtures", () => {
	const directory = isolatedRepository();
	try {
		for (const path of [
			"test/fixtures/crap/biome-invalid.test.ts",
			"test/integration/dist/biome-invalid.test.js",
			"test/integration/.next/biome-invalid.test.js",
			"test/integration/valid.test.ts",
		]) {
			const fixture = join(directory, path);
			mkdirSync(dirname(fixture), { recursive: true });
			writeFileSync(
				fixture,
				path.endsWith("/valid.test.ts")
					? 'import { expect } from "vitest";\nexpect(1).toBe(1);\n'
					: 'import { expect } from "vitest";\nexpect(1, 2);\n',
			);
		}
		const result = makeLint(directory, "root");
		assert.equal(result.status, 0, result.output);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("rule-test cache tracks copied configuration and ignore policy", async (context) => {
	for (const path of [
		"scripts/biome.json",
		"infra/biome.json",
		".gitignore",
		"crap.config.mts",
		"scripts/crap.mts",
		"mutation.inventory.json",
		"scripts/mutation.mjs",
		"scripts/lib/mutation-catalog.mjs",
		"packages/profile-markdown/mutation.config.json",
		// Present after the independent locked-toolchain change lands.
		...[
			"mise.toml",
			"mise.lock",
			".npmrc",
			"scripts/mise-shell.sh",
			"scripts/toolchain.mjs",
		].filter((path) => existsSync(join(repository, path))),
	])
		await context.test(path, () => {
			const directory = isolatedRepository();
			try {
				const count = installRuleTestCounter(directory);
				makeRuleTests(directory);
				assert.equal(readFileSync(count, "utf8"), "1");
				assert.match(makeRuleTests(directory), /cache hit/);
				assert.equal(readFileSync(count, "utf8"), "1");
				const config = join(directory, path);
				writeFileSync(
					config,
					path.endsWith(".mjs") || path.endsWith(".mts")
						? readFileSync(config, "utf8") +
								(path === "scripts/crap.mts"
									? "\nthrow new Error('Collector changed after caching');\n"
									: "\n// Collector policy changed.\n")
						: path === "mutation.inventory.json" ||
								path.endsWith("/mutation.config.json")
							? readFileSync(config, "utf8") + "\n"
							: [
										"mise.toml",
										"mise.lock",
										".npmrc",
										"scripts/mise-shell.sh",
									].includes(path)
								? readFileSync(config, "utf8") +
									"\n# Fixture toolchain policy changed.\n"
								: path === ".gitignore"
									? readFileSync(config, "utf8") +
										"\napps/docs/src/ignored.test.ts\n"
									: JSON.stringify({
											files: { includes: ["*.json"] },
											linter: { rules: { preset: "none" } },
										}),
				);
				gitFixture(directory, ["add", "--", path]);
				makeRuleTests(directory);
				assert.equal(readFileSync(count, "utf8"), "2", path);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
});

test("mutation inventory records the isolated Biome plugin limitation", () => {
	const result = spawnSync("make", ["test-mutation", "ARGS=--inventory"], {
		cwd: repository,
		env: makeEnvironment(repository),
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const entry = JSON.parse(result.stdout).workspaces[
		"packages/biome-test-rules"
	];
	assert.equal(entry.decision, "excluded");
	assert.match(entry.reason, /Biome/);
	assert.equal(
		entry.followUp,
		"https://github.com/rafaeltab/wallpaperdb/issues/560",
	);
});
