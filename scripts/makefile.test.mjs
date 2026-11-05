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
import { expect, test } from "vitest";

// Do not inherit selectors or dry-run flags from the parent make invocation.
const env = { ...process.env, MAKEFLAGS: "", MFLAGS: "", MAKELEVEL: "0" };
for (const selector of [
	"PACKAGE",
	"SERVICE",
	"DB",
	"SCRIPT",
	"ARGS",
	"FORCE",
	"CI_CONCURRENCY",
]) {
	delete env[selector];
}

function make(...args) {
	return spawnSync("make", ["--no-print-directory", "-n", ...args], {
		encoding: "utf8",
		env,
	});
}
function output(...args) {
	const result = make(...args);
	expect(result.status, result.stderr).toBe(0);
	return result.stdout;
}
function plannedTask(target, workspace, taskName) {
	const result = spawnSync(
		"make",
		[
			"--no-print-directory",
			target,
			`PACKAGE=${workspace}`,
			`TURBO_FLAGS=--filter=@wallpaperdb/${workspace} --dry=json`,
		],
		{ encoding: "utf8", env },
	);
	expect(result.status, result.stderr).toBe(0);
	const plan = JSON.parse(result.stdout);
	const task = plan.tasks.find(
		(entry) => entry.taskId === `@wallpaperdb/${workspace}#${taskName}`,
	);
	expect(task, `${workspace} must plan ${taskName}`).toBeTruthy();
	return task;
}

function workspaceFixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-make-selector-"));
	t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
	copyFileSync("Makefile", join(directory, "Makefile"));
	writeFileSync(
		join(directory, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n",
	);
	for (const [path, name, marker] of [
		[directory, "@wallpaperdb/root", "root"],
		[join(directory, "packages/probe"), "@wallpaperdb/probe", "child"],
	]) {
		mkdirSync(path, { recursive: true });
		writeFileSync(
			join(path, "package.json"),
			JSON.stringify({
				name,
				private: true,
				scripts: { probe: "node probe.mjs" },
			}),
		);
		writeFileSync(
			join(path, "probe.mjs"),
			`console.log(JSON.stringify({ workspace: ${JSON.stringify(marker)}, args: process.argv.slice(2) }));\n`,
		);
	}
	return directory;
}

for (const [workspace, marker] of [
	["root", "root"],
	["probe", "child"],
]) {
	test(`one-off scripts execute in the ${workspace} workspace and forward arguments`, (t) => {
		const result = spawnSync(
			"make",
			[
				"--no-print-directory",
				"run",
				`PACKAGE=${workspace}`,
				"SCRIPT=probe",
				"ARGS=hello --flag",
				"SHELL=/bin/sh",
			],
			{
				cwd: workspaceFixture(t),
				encoding: "utf8",
				env,
			},
		);
		expect(result.status, result.stdout + result.stderr).toBe(0);
		expect(
			result.stdout
				.split("\n")
				.includes(
					JSON.stringify({ workspace: marker, args: ["hello", "--flag"] }),
				),
			result.stdout,
		).toBeTruthy();
	});
}

test("one-off scripts fail when a workspace directory has no matching package", (t) => {
	const directory = workspaceFixture(t);
	writeFileSync(
		join(directory, "packages/probe/package.json"),
		JSON.stringify({ name: "@other/probe", private: true }),
	);
	const result = spawnSync(
		"make",
		[
			"--no-print-directory",
			"run",
			"PACKAGE=probe",
			"SCRIPT=probe",
			"SHELL=/bin/sh",
		],
		{
			cwd: directory,
			encoding: "utf8",
			env,
		},
	);
	expect(result.status, result.stdout + result.stderr).not.toBe(0);
	expect(result.stdout + result.stderr).toMatch(/No projects matched/);
});

test("Compose image plans and prebuilt startup are explicit opt-ins", () => {
	expect(output("apps-build", "ARGS=--print")).toMatch(/ build --print\s*$/);
	expect(output("apps-start", "ARGS=--no-build")).toMatch(
		/ up -d --no-build\s*$/,
	);
	expect(output("apps-start")).toMatch(/ up -d --build\s*$/);
});

test("workspace actions support optional package scoping", () => {
	expect(output("build")).toMatch(/run build(?!.*--filter)/);
	expect(output("build", "PACKAGE=web")).toMatch(
		/run build .*--filter=@wallpaperdb\/web/,
	);
	expect(output("check-types", "PACKAGE=ingestor")).toMatch(
		/run check-types .*--filter=@wallpaperdb\/ingestor/,
	);
	expect(output("check-types", "PACKAGE=ingestor")).not.toMatch(
		/crap:check-types/,
	);
	expect(output("check-types")).not.toMatch(/crap:check-types/);
	for (const invalid of ["typo", "web*", "%", "web ingestor"]) {
		expect(make("build", `PACKAGE=${invalid}`).status).not.toBe(0);
	}
});

test("repository scripts participate in the unit task graph", () => {
	const task = plannedTask("test-unit", "scripts", "test:unit");
	expect(task.resolvedTaskDefinition.cache).toBe(false);
});

test("Ingestor caches distinguish scheduling modes only for instrumentation tasks", () => {
	const plans = [undefined, "true"].map((hosted) => {
		const childEnv = { ...env };
		if (hosted === undefined) delete childEnv.GITHUB_ACTIONS;
		else childEnv.GITHUB_ACTIONS = hosted;
		const result = spawnSync(
			"make",
			[
				"--no-print-directory",
				"test",
				"PACKAGE=ingestor",
				"TURBO_FLAGS=build test:integration test:unit --filter=@wallpaperdb/ingestor --dry=json",
			],
			{ encoding: "utf8", env: childEnv },
		);
		expect(result.status, result.stderr).toBe(0);
		return new Map(
			JSON.parse(result.stdout).tasks.map((task) => [task.taskId, task.hash]),
		);
	});
	for (const task of ["test", "test:integration", "test:unit", "build"]) {
		const id = `@wallpaperdb/ingestor#${task}`;
		expect(
			plans[0].has(id) && plans[1].has(id),
			`${id} must be planned`,
		).toBeTruthy();
		if (task === "test" || task === "test:integration") {
			expect(plans[0].get(id), `${id} must hash scheduling mode`).not.toBe(
				plans[1].get(id),
			);
		} else {
			expect(plans[0].get(id), `${id} must retain its cache identity`).toBe(
				plans[1].get(id),
			);
		}
	}
});

test("shared tooling is invoked through the scripts workspace", () => {
	const scripts = JSON.parse(readFileSync("scripts/package.json", "utf8"));
	expect(scripts.bin["wallpaperdb-check-architecture"]).toBeTruthy();
	expect(scripts.bin["wallpaperdb-crap"]).toBeTruthy();
	for (const app of [
		"ingestor",
		"asset",
		"tags",
		"wallpaper",
		"user",
		"gateway",
		"color-extractor",
		"variant-generator",
	]) {
		const manifest = JSON.parse(
			readFileSync(`apps/${app}/package.json`, "utf8"),
		);
		expect(manifest.devDependencies["@wallpaperdb/scripts"]).toBe(
			"workspace:*",
		);
		expect(manifest.scripts["lint:architecture"]).toMatch(
			/wallpaperdb-check-architecture/,
		);
	}
	expect(
		plannedTask("lint", "gateway", "lint").dependencies.includes(
			"@wallpaperdb/gateway#lint:architecture",
		),
	).toBeTruthy();
	expect(output("crap")).toMatch(/wallpaperdb-crap report/);
});

test("local infrastructure owns its stream setup test", () => {
	const task = plannedTask("test-unit", "infra-local", "test:unit");
	const manifest = JSON.parse(readFileSync("infra/package.json", "utf8"));
	expect(manifest.scripts["test:unit"]).toBeTruthy();
	expect(Object.hasOwn(task.inputs, "nats/init/setup-streams.sh")).toBeTruthy();
});

test("specialized test shortcuts are absent from the Make interface", () => {
	const source = readFileSync("Makefile", "utf8");
	for (const name of [
		"test-make",
		"ci-runner-test",
		"worktree-env-test",
		"nats-stream-setup-test",
		"storage-test",
		"storage-infra-test",
		"sandcastle-test",
		"sandcastle-check-types",
	]) {
		expect(source).not.toMatch(new RegExp(`^${name}:`, "m"));
	}
});

test("web integration runs cached browser contracts with dependency builds and coverage", () => {
	const task = plannedTask("test-integration", "web", "test:integration");
	expect(task.command).toBe("vitest run --config vitest.browser.config.ts");
	expect(task.resolvedTaskDefinition.cache).toBe(true);
	expect(
		task.dependencies.includes("@wallpaperdb/profile-markdown#build"),
	).toBeTruthy();
	expect(task.resolvedTaskDefinition.outputs).toStrictEqual([
		"coverage/integration/**",
	]);
	for (const input of [
		"test/browser/picture-processing.spec.ts",
		"vitest.browser.config.ts",
		"../web-e2e/fixtures/profile-small.png",
		"../web-e2e/fixtures/profile-transparent-p3.png",
	]) {
		expect(
			Object.hasOwn(task.inputs, input),
			`${input} must invalidate browser contracts`,
		).toBeTruthy();
	}
});

test("test tiers preserve sequential container execution", () => {
	for (const tier of ["integration", "e2e"]) {
		expect(
			output(`test-${tier}`, "PACKAGE=test-utils", "GITHUB_ACTIONS=true"),
		).toMatch(/--concurrency=1/);
	}
});

test("E2E task graphs retain shared infrastructure and product/operations browser journeys", () => {
	for (const [filter, expected] of [
		[
			"",
			[
				"@wallpaperdb/factory",
				"@wallpaperdb/test-utils",
				"@wallpaperdb/testcontainers",
				"@wallpaperdb/web-e2e",
			],
		],
		[
			"--filter=!@wallpaperdb/web-e2e",
			[
				"@wallpaperdb/factory",
				"@wallpaperdb/test-utils",
				"@wallpaperdb/testcontainers",
			],
		],
	]) {
		const result = spawnSync(
			"make",
			["--no-print-directory", "test-e2e", `TURBO_FLAGS=${filter} --dry=json`],
			{ encoding: "utf8", env },
		);
		expect(result.status, result.stderr).toBe(0);
		const tasks = JSON.parse(result.stdout).tasks.filter(
			(task) => task.task === "test:e2e" && task.command !== "<NONEXISTENT>",
		);
		expect(tasks.map((task) => task.package).sort()).toStrictEqual(expected);
	}
});

test("browser E2E always executes against the current deployed environment", () => {
	const task = plannedTask("test-e2e", "web-e2e", "test:e2e");
	expect(
		task.resolvedTaskDefinition.cache,
		"source hashes cannot prove that the deployed application, infrastructure, and credentials are unchanged",
	).toBe(false);
});

test("test task graphs do not build production images", () => {
	for (const target of ["test", "test-e2e"]) {
		const result = spawnSync(
			"make",
			["--no-print-directory", target, "TURBO_FLAGS=--dry=json"],
			{ encoding: "utf8", env },
		);
		expect(result.status, result.stderr).toBe(0);
		const tasks = JSON.parse(result.stdout).tasks;
		expect(
			tasks
				.filter((task) => task.task === "build:docker")
				.map((task) => task.taskId),
		).toStrictEqual([]);
	}
});

test("typecheck cache inputs include test files compiled by the workspace", () => {
	const task = plannedTask("check-types", "asset", "check-types");
	const tsconfig = JSON.parse(readFileSync("apps/asset/tsconfig.json", "utf8"));
	expect(tsconfig.include.includes("test/**/*")).toBeTruthy();
	expect(
		Object.hasOwn(task.inputs, "test/catalog-postgres.integration.test.ts"),
		"test-only TypeScript errors must invalidate a cached successful typecheck",
	).toBeTruthy();
});

test("root workspace checks use the shared Turbo commands", () => {
	expect(output("test-integration", "PACKAGE=root")).toMatch(
		/run test:integration .*--filter=\/\/.*--concurrency=1/,
	);
	expect(output("check-types", "PACKAGE=root")).toMatch(
		/run check-types .*--filter=\/\//,
	);
	const ci = output("ci");
	expect(ci).not.toMatch(/test-crap|crap-check-types|crap:check-types/);
});

test("CRAP commands pass the optional workspace selector to the shared analyzer", () => {
	for (const target of ["crap", "check-crap"]) {
		expect(output(target, "PACKAGE=ingestor")).toMatch(
			/PACKAGE="ingestor".*wallpaperdb-crap/,
		);
		expect(output(target)).toMatch(/PACKAGE="".*wallpaperdb-crap/);
	}
});

test("focused tests select one workspace and serialize dependency builds and tests", () => {
	expect(make("test-focused").status).not.toBe(0);
	for (const [workspace, file] of [
		["web", "test/components/profile/public-profile-page.dom.test.tsx"],
		["gateway", "test/catalogue.unit.test.ts"],
	]) {
		const focused = output(
			"test-focused",
			`PACKAGE=${workspace}`,
			`ARGS=${file}`,
		);
		expect(
			focused.includes(
				`run build --filter="@wallpaperdb/${workspace}^..." --concurrency=1`,
			),
		).toBeTruthy();
		expect(
			focused.includes(
				`pnpm --filter @wallpaperdb/${workspace} --fail-if-no-match exec vitest run --maxWorkers=1 --no-file-parallelism ${file}`,
			),
		).toBeTruthy();
		expect(
			focused,
			"the shared command must support gateway Vitest 5",
		).not.toMatch(/--minWorkers/);
	}
	expect(output("test-focused", "PACKAGE=root")).toMatch(
		/pnpm --workspace-root exec vitest run/,
	);
});

test("dev defaults to Compose and scopes workspace dev through Turbo", () => {
	expect(output("dev")).toMatch(/docker compose .* watch/);
	expect(output("dev", "PACKAGE=web")).toMatch(
		/run dev .*--filter=@wallpaperdb\/web/,
	);
});

test("stop tears down apps before infrastructure for the selected Compose project", () => {
	const commands = output("stop", "COMPOSE_PROJECT_NAME=isolated");
	const apps = commands.indexOf(
		"docker compose -p isolated -f infra/docker-compose.apps.yml --profile '*' down",
	);
	const infra = commands.indexOf(
		"docker compose -p isolated -f infra/docker-compose.yml --profile '*' down",
	);
	expect(apps >= 0, "stop must tear down the app stack").toBeTruthy();
	expect(
		infra > apps,
		"stop must tear down infrastructure after apps",
	).toBeTruthy();
});

test("database and Compose commands use explicit selectors", () => {
	expect(output("psql")).toMatch(/psql -U wallpaperdb\s/);
	expect(output("psql", "DB=asset")).toMatch(/-d wallpaperdb_media/);
	expect(
		output("apps-start", "SERVICE=ingestor", "COMPOSE_PROJECT_NAME=isolated"),
	).toMatch(/-p isolated .*up -d --build ingestor/);
	expect(output("apps-stop", "SERVICE=ingestor")).toMatch(/stop ingestor/);
	expect(output("apps-stop", "SERVICE=ingestor")).not.toMatch(/ down/);
	expect(output("apps-stop", "SERVICE=tags")).toMatch(/stop tags/);
	expect(output("apps-stop")).toMatch(/--profile '\*' down/);
	expect(output("apps-stop")).toMatch(/ down/);
});

test("admin infrastructure has an explicit Make path and participates in teardown", () => {
	expect(output("infra-start-admin")).toMatch(/--profile admin up -d/);
	expect(output("infra-start")).not.toMatch(/--profile admin/);
	for (const target of ["infra-stop", "infra-reset", "infra-logs"]) {
		expect(output(target)).toMatch(/--profile '\*'/);
	}
});

test("one-off scripts require a package and script", () => {
	expect(make("run").status).not.toBe(0);
	expect(make("run", "PACKAGE=web").status).not.toBe(0);
	expect(output("run", "PACKAGE=web", "SCRIPT=preview")).toMatch(
		/pnpm --filter @wallpaperdb\/web --fail-if-no-match run preview/,
	);
});

test("force applies to ordinary CI checks and type checks", () => {
	const ci = output("ci", "FORCE=1");
	expect(ci).toMatch(
		/run build lint check-types test:unit test:integration .*--force/,
	);
	expect(ci).not.toMatch(/run test:e2e/);
	expect(ci).toMatch(
		/run build lint check-types test:unit test:integration .*--concurrency=4/,
	);
	expect(output("ci", "CI_CONCURRENCY=1")).toMatch(
		/run build lint check-types test:unit test:integration .*--concurrency=1/,
	);
	const scopedCi = output("ci", "PACKAGE=web");
	expect(scopedCi).not.toMatch(
		/run (build lint check-types test:unit test:integration|test:e2e)[^\n]*--filter=/,
	);
	expect(scopedCi).not.toMatch(
		/run build --filter=@wallpaperdb\/vitest-config/,
	);
	expect(output("check-types", "FORCE=1")).toMatch(/run check-types .*--force/);
});

test("default goal is help, even with worktree configuration", () => {
	const result = spawnSync("make", ["--no-print-directory"], {
		encoding: "utf8",
		env,
	});
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toMatch(/PACKAGE=web/);
	expect(result.stdout).not.toMatch(/ingestor-build/);
});

test("all public targets are documented, phony, and advertised", () => {
	const source = readFileSync("Makefile", "utf8");
	const targets = [...source.matchAll(/^([a-z][a-z0-9-]*):.*$/gm)];
	const phony = source
		.replace(/\\\n/g, " ")
		.match(/^\.PHONY: (.*)$/m)[1]
		.split(/\s+/);
	const help = spawnSync("make", ["--no-print-directory", "help"], {
		encoding: "utf8",
		env,
	});
	expect(help.status, help.stderr).toBe(0);
	for (const [line, name] of targets) {
		expect(line, `${name} needs a help description`).toMatch(/## /);
		expect(phony.includes(name), `${name} must be phony`).toBeTruthy();
		expect(help.stdout).toMatch(new RegExp(`^  ${name}\\s`, "m"));
	}
});
