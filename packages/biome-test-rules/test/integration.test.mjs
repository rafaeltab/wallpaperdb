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
		".gitignore",
	])
		copyFileSync(join(repository, name), join(directory, name));
	symlinkSync(
		join(repository, "node_modules"),
		join(directory, "node_modules"),
	);
	for (const workspace of workspaces) {
		const target = join(directory, workspace);
		mkdirSync(target, { recursive: true });
		for (const file of ["package.json", "biome.json"])
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
	cpSync(join(repository, rules, "rules"), join(directory, rules, "rules"), {
		recursive: true,
	});
	const git = spawnSync("git", ["init", "--quiet", directory], {
		encoding: "utf8",
	});
	assert.equal(git.status, 0, git.stderr);
	return directory;
}

function makeLint(directory, workspace) {
	const filter = workspace === "root" ? "//" : `@wallpaperdb/${workspace}`;
	// The fixture owns configuration and sources, while dependency builds are
	// validated by repository CI. Run the actual Make/Turbo lint task in isolation.
	const result = spawnSync(
		"make",
		[
			"lint",
			`PACKAGE=${workspace}`,
			`TURBO_FLAGS=--filter=${filter} --only --force`,
		],
		{
			cwd: directory,
			encoding: "utf8",
			timeout: 30_000,
			env: { ...process.env, MAKEFLAGS: "", MFLAGS: "", MAKELEVEL: "0" },
		},
	);
	assert.equal(result.error, undefined);
	return { status: result.status, output: result.stdout + result.stderr };
}

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
			assert.match(invalid.output, /Complete the assertion/, path);
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
