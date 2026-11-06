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
import { describe, expect, test } from "vitest";
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
		"scripts/toolchain.ts",
		"scripts/check-workspaces.mjs",
		"scripts/crap.mts",
		"mutation.inventory.json",
		"scripts/mutation.ts",
		"scripts/lib/mutation-catalog.ts",
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
	// The lint-discovery probes below import Vitest, including in workspaces
	// whose production tests use node:test. Declare that synthetic dependency.
	for (const workspace of workspaces) {
		const manifestPath = join(directory, workspace, "package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.devDependencies = { ...manifest.devDependencies, vitest: "5.0.2" };
		writeFileSync(manifestPath, JSON.stringify(manifest));
	}
	const rules = "packages/biome-test-rules";
	// Keep probe diagnostics visible alongside warnings in the adapted sources.
	const manifestPath = join(directory, rules, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.scripts.lint += " --max-diagnostics=200";
	writeFileSync(manifestPath, JSON.stringify(manifest));
	copyFileSync(
		join(repository, rules, "vitest.config.ts"),
		join(directory, rules, "vitest.config.ts"),
	);
	copyFileSync(
		join(repository, rules, "test-correctness.json"),
		join(directory, rules, "test-correctness.json"),
	);
	cpSync(join(repository, rules, "src"), join(directory, rules, "src"), {
		recursive: true,
	});
	// The coverage collector builds declared dependencies before running tests.
	// Include the shared Vitest policy's real build inputs in the isolated repo.
	for (const file of ["src", "tsconfig.json"])
		cpSync(
			join(repository, "packages/vitest-config", file),
			join(directory, "packages/vitest-config", file),
			{ recursive: true },
		);
	const git = spawnSync("git", ["init", "--quiet", directory], {
		encoding: "utf8",
	});
	expect(git.status, git.stderr).toBe(0);
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

function gitFixture(directory: string, args: string[]) {
	const result = spawnSync("git", ["-C", directory, ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

function makeEnvironment(directory: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
		// Cache assertions require execution in this fixture, never a result from
		// another temporary repository or CI's shared remote cache.
		TURBO_CACHE: "local:rw",
		TURBO_CACHE_DIR: join(directory, ".turbo/cache"),
		// This is the reviewed configuration copied into our own temporary fixture.
		MISE_TRUSTED_CONFIG_PATHS: [
			process.env.MISE_TRUSTED_CONFIG_PATHS,
			directory,
		]
			.filter(Boolean)
			.join(":"),
	};
}

function makeLint(directory: string, workspace: string, force = true) {
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
	expect(result.error).toBe(undefined);
	return { status: result.status, output: result.stdout + result.stderr };
}

function makeRuleTests(directory: string) {
	const env: NodeJS.ProcessEnv = makeEnvironment(directory);
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
	expect(result.status, result.stdout + result.stderr).toBe(0);
	return result.stdout + result.stderr;
}

test("unit coverage combines with the CRAP TypeScript rule inventory", () => {
	const directory = isolatedRepository();
	try {
		const workspace = join(directory, "packages/biome-test-rules");
		mkdirSync(join(workspace, "src"), { recursive: true });
		mkdirSync(join(workspace, "test"));
		writeFileSync(
			join(workspace, "src/measurement.ts"),
			"export function measured() {\n  return 42;\n}\n",
		);
		writeFileSync(
			join(workspace, "test/coverage.test.ts"),
			`import { expect, test } from 'vitest';
import { measured } from '../src/measurement.ts';
test('executes measured source', () => expect(measured()).toBe(42));`,
		);
		gitFixture(directory, ["add", "--", "."]);
		makeRuleTests(directory);
		const reportPath = join(workspace, "coverage/unit/coverage-final.json");
		expect(
			existsSync(reportPath),
			"unit task must produce the collector's Istanbul report",
		).toBeTruthy();
		const coverage: Record<
			string,
			{ f: Record<string, number>; s: Record<string, number> }
		> = JSON.parse(readFileSync(reportPath, "utf8"));
		const measured = coverage[join(workspace, "src/measurement.ts")];
		expect(Object.values(measured.f).some((hits) => hits > 0)).toBeTruthy();
		const unmeasured = coverage[join(workspace, "src/syntax.ts")];
		expect(
			unmeasured,
			"unloaded maintained rules must remain visible",
		).toBeTruthy();
		expect(
			Object.values(unmeasured.s).every((hits) => hits === 0),
		).toBeTruthy();
		const env: NodeJS.ProcessEnv = {
			...makeEnvironment(directory),
			PACKAGE: "biome-test-rules",
		};
		const runCollector = (mode: string) =>
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
		expect(report.status, report.stdout + report.stderr).toBe(0);
		for (const file of [
			"syntax.ts",
			"scope.ts",
			"port.ts",
			"retry.ts",
			"ported/valid-expect.ts",
			"ported/valid-expect-in-promise.ts",
			"ported/require-awaited-expect-poll.ts",
		])
			expect(
				report.stdout.includes(`src/${file}`),
				`missing ${file}: ${report.stdout}`,
			).toBeTruthy();
		expect(report.stdout).toMatch(
			/0\.00%\tpackages\/biome-test-rules\/src\/syntax\.ts:/,
		);
		expect(report.stdout).toMatch(
			/100\.00%\tpackages\/biome-test-rules\/src\/measurement\.ts:/,
		);
		const check = runCollector("check");
		expect(
			check.status,
			"unmeasured rules must not silently pass a zero threshold",
		).not.toBe(0);
		expect(check.stdout + check.stderr).toMatch(
			/CRAP: \d+ of \d+ functions exceed 0\./,
		);
		expect(check.stdout + check.stderr).not.toMatch(
			/ENOENT|No in-scope source|Cannot combine coverage/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

function installRuleTestCounter(directory: string) {
	const workspace = join(directory, "packages/biome-test-rules");
	mkdirSync(join(workspace, "test"));
	mkdirSync(join(workspace, ".turbo"));
	const count = join(workspace, ".turbo/executions");
	writeFileSync(
		join(workspace, "test/cache.test.ts"),
		`import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
test('records actual execution', () => {
  const path = '.turbo/executions';
  const previous = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
  writeFileSync(path, String(previous + 1));
  expect(readFileSync(path, 'utf8')).toBe(String(previous + 1));
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
		expect(readFileSync(count, "utf8")).toBe("1");
		expect(makeRuleTests(directory)).toMatch(/cache hit/);
		expect(readFileSync(count, "utf8")).toBe("1");
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
				expect(
					readFileSync(count, "utf8"),
					`${extension}, ${staged ? "staged" : "untracked"}`,
				).toBe(String(++executions));
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
			expect(makeLint(directory, "root", false).status).toBe(0);
			expect(makeLint(directory, "root", false).output).toMatch(/cache hit/);
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
			expect(result.status, `${changed}: ${result.output}`).not.toBe(0);
			expect(result.output).toMatch(/Expect requires at least/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
});

function sourceTestDirectory(path: string): string | undefined {
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

describe("Make lint discovers each workspace's actual test directories and accepts valid assertions", () => {
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
	for (const [workspace, path] of fixtures) {
		test(`${workspace}: ${path}`, () => {
			const directory = isolatedRepository();
			try {
				const fixture = join(directory, path);
				mkdirSync(dirname(fixture), { recursive: true });
				writeFileSync(
					fixture,
					'import { expect } from "vitest";\nexpect(1, 2);\n',
				);
				const invalid = makeLint(directory, workspace);
				expect(invalid.status, path).not.toBe(0);
				expect(
					invalid.output.includes(basename(path)),
					invalid.output,
				).toBeTruthy();
				expect(invalid.output, path).toMatch(
					/Expect must have a corresponding matcher/,
				);
				writeFileSync(
					fixture,
					'import { expect } from "vitest";\nexpect(1).toBe(1);\n',
				);
				const valid = makeLint(directory, workspace);
				expect(valid.status, valid.output).toBe(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
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
		expect(result.status, result.output).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("rule-test cache tracks copied configuration and ignore policy", () => {
	for (const path of [
		"scripts/biome.json",
		"infra/biome.json",
		".gitignore",
		"crap.config.mts",
		"scripts/crap.mts",
		"mutation.inventory.json",
		"scripts/mutation.ts",
		"scripts/lib/mutation-catalog.ts",
		"packages/profile-markdown/mutation.config.json",
		// Present after the independent locked-toolchain change lands.
		...[
			"mise.toml",
			"mise.lock",
			".npmrc",
			"scripts/mise-shell.sh",
			"scripts/toolchain.ts",
		].filter((path) => existsSync(join(repository, path))),
	])
		test(path, () => {
			const directory = isolatedRepository();
			try {
				const count = installRuleTestCounter(directory);
				makeRuleTests(directory);
				expect(readFileSync(count, "utf8")).toBe("1");
				expect(makeRuleTests(directory)).toMatch(/cache hit/);
				expect(readFileSync(count, "utf8")).toBe("1");
				const config = join(directory, path);
				writeFileSync(
					config,
					path.endsWith(".mjs") || path.endsWith(".mts") || path.endsWith(".ts")
						? readFileSync(config, "utf8") +
								(path === "scripts/crap.mts"
									? "\nthrow new Error('Collector changed after caching');\n"
									: "\n// Collector policy changed.\n")
						: path === "mutation.inventory.json" ||
								path.endsWith("/mutation.config.json")
							? `${readFileSync(config, "utf8")}\n`
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
				expect(readFileSync(count, "utf8"), path).toBe("2");
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
	expect(result.status, result.stdout + result.stderr).toBe(0);
	const entry = JSON.parse(result.stdout).workspaces[
		"packages/biome-test-rules"
	];
	expect(entry.decision).toBe("excluded");
	expect(entry.reason).toMatch(/Biome/);
	expect(entry.followUp).toBe(
		"https://github.com/rafaeltab/wallpaperdb/issues/445",
	);
});
