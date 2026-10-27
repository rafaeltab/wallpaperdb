import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Do not inherit selectors or dry-run flags from the parent make invocation.
const env = { ...process.env, MAKEFLAGS: "", MFLAGS: "", MAKELEVEL: "0" };
for (const selector of [
	"PACKAGE",
	"SERVICE",
	"DB",
	"SCRIPT",
	"ARGS",
	"FORCE",
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
	assert.equal(result.status, 0, result.stderr);
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
	assert.equal(result.status, 0, result.stderr);
	const plan = JSON.parse(result.stdout);
	const task = plan.tasks.find(
		(entry) => entry.taskId === `@wallpaperdb/${workspace}#${taskName}`,
	);
	assert.ok(task, `${workspace} must plan ${taskName}`);
	return task;
}

test("Compose image plans and prebuilt startup are explicit opt-ins", () => {
	assert.match(output("apps-build", "ARGS=--print"), / build --print\s*$/);
	assert.match(
		output("apps-start", "ARGS=--no-build"),
		/ up -d --no-build\s*$/,
	);
	assert.match(output("apps-start"), / up -d --build\s*$/);
});

test("workspace actions support optional package scoping", () => {
	assert.match(output("build"), /run build(?!.*--filter)/);
	assert.match(
		output("build", "PACKAGE=web"),
		/run build .*--filter=@wallpaperdb\/web/,
	);
	assert.match(
		output("check-types", "PACKAGE=ingestor"),
		/run check-types .*--filter=@wallpaperdb\/ingestor/,
	);
	assert.doesNotMatch(
		output("check-types", "PACKAGE=ingestor"),
		/crap:check-types/,
	);
	assert.doesNotMatch(output("check-types"), /crap:check-types/);
	for (const invalid of ["typo", "web*", "%", "web ingestor"]) {
		assert.notEqual(make("build", `PACKAGE=${invalid}`).status, 0);
	}
});

test("repository scripts participate in the unit task graph", () => {
	const task = plannedTask("test-unit", "scripts", "test:unit");
	assert.equal(task.resolvedTaskDefinition.cache, false);
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
		assert.equal(result.status, 0, result.stderr);
		return new Map(JSON.parse(result.stdout).tasks.map((task) => [task.taskId, task.hash]));
	});
	for (const task of ["test", "test:integration", "test:unit", "build"]) {
		const id = `@wallpaperdb/ingestor#${task}`;
		assert.ok(plans[0].has(id) && plans[1].has(id), `${id} must be planned`);
		if (task === "test" || task === "test:integration") {
			assert.notEqual(plans[0].get(id), plans[1].get(id), `${id} must hash scheduling mode`);
		} else {
			assert.equal(plans[0].get(id), plans[1].get(id), `${id} must retain its cache identity`);
		}
	}
});

test("shared tooling is invoked through the scripts workspace", () => {
	const scripts = JSON.parse(readFileSync("scripts/package.json", "utf8"));
	assert.ok(scripts.bin["wallpaperdb-check-architecture"]);
	assert.ok(scripts.bin["wallpaperdb-crap"]);
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
		assert.equal(
			manifest.devDependencies["@wallpaperdb/scripts"],
			"workspace:*",
		);
		assert.match(
			manifest.scripts["lint:architecture"],
			/wallpaperdb-check-architecture/,
		);
	}
	assert.ok(
		plannedTask("lint", "gateway", "lint").dependencies.includes(
			"@wallpaperdb/gateway#lint:architecture",
		),
	);
	assert.match(output("crap"), /wallpaperdb-crap report/);
});

test("local infrastructure owns its stream setup test", () => {
	const task = plannedTask("test-unit", "infra-local", "test:unit");
	const manifest = JSON.parse(readFileSync("infra/package.json", "utf8"));
	assert.ok(manifest.scripts["test:unit"]);
	assert.ok(Object.hasOwn(task.inputs, "nats/init/setup-streams.sh"));
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
		assert.doesNotMatch(source, new RegExp(`^${name}:`, "m"));
	}
});

test("web integration runs cached browser contracts with dependency builds and coverage", () => {
	const task = plannedTask("test-integration", "web", "test:integration");
	assert.equal(task.command, "vitest run --config vitest.browser.config.ts");
	assert.equal(task.resolvedTaskDefinition.cache, true);
	assert.ok(task.dependencies.includes("@wallpaperdb/profile-markdown#build"));
	assert.deepEqual(task.resolvedTaskDefinition.outputs, [
		"coverage/integration/**",
	]);
	for (const input of [
		"test/browser/picture-processing.spec.ts",
		"vitest.browser.config.ts",
		"../web-e2e/fixtures/profile-small.png",
		"../web-e2e/fixtures/profile-transparent-p3.png",
	]) {
		assert.ok(
			Object.hasOwn(task.inputs, input),
			`${input} must invalidate browser contracts`,
		);
	}
});

test("test tiers preserve sequential container execution", () => {
	for (const tier of ["integration", "e2e"]) {
		assert.match(
			output(`test-${tier}`, "PACKAGE=test-utils", "GITHUB_ACTIONS=true"),
			/--concurrency=1/,
		);
	}
});

test("E2E task graphs retain only shared container suites and browser journeys", () => {
	for (const [filter, expected] of [
		[
			"",
			[
				"@wallpaperdb/test-utils",
				"@wallpaperdb/testcontainers",
				"@wallpaperdb/web-e2e",
			],
		],
		[
			"--filter=!@wallpaperdb/web-e2e",
			["@wallpaperdb/test-utils", "@wallpaperdb/testcontainers"],
		],
	]) {
		const result = spawnSync(
			"make",
			["--no-print-directory", "test-e2e", `TURBO_FLAGS=${filter} --dry=json`],
			{ encoding: "utf8", env },
		);
		assert.equal(result.status, 0, result.stderr);
		const tasks = JSON.parse(result.stdout).tasks.filter(
			(task) => task.task === "test:e2e" && task.command !== "<NONEXISTENT>",
		);
		assert.deepEqual(tasks.map((task) => task.package).sort(), expected);
	}
});

test("browser E2E always executes against the current deployed environment", () => {
	const task = plannedTask("test-e2e", "web-e2e", "test:e2e");
	assert.equal(
		task.resolvedTaskDefinition.cache,
		false,
		"source hashes cannot prove that the deployed application, infrastructure, and credentials are unchanged",
	);
});

test("test task graphs do not build production images", () => {
	for (const target of ["test", "test-e2e"]) {
		const result = spawnSync(
			"make",
			["--no-print-directory", target, "TURBO_FLAGS=--dry=json"],
			{ encoding: "utf8", env },
		);
		assert.equal(result.status, 0, result.stderr);
		const tasks = JSON.parse(result.stdout).tasks;
		assert.deepEqual(
			tasks
				.filter((task) => task.task === "build:docker")
				.map((task) => task.taskId),
			[],
		);
	}
});

test("typecheck cache inputs include test files compiled by the workspace", () => {
	const task = plannedTask("check-types", "asset", "check-types");
	const tsconfig = JSON.parse(readFileSync("apps/asset/tsconfig.json", "utf8"));
	assert.ok(tsconfig.include.includes("test/**/*"));
	assert.ok(
		Object.hasOwn(task.inputs, "test/catalog-postgres.integration.test.ts"),
		"test-only TypeScript errors must invalidate a cached successful typecheck",
	);
});

test("root workspace checks use the shared Turbo commands", () => {
	assert.match(
		output("test-integration", "PACKAGE=root"),
		/run test:integration .*--filter=\/\/.*--concurrency=1/,
	);
	assert.match(
		output("check-types", "PACKAGE=root"),
		/run check-types .*--filter=\/\//,
	);
	const ci = output("ci");
	assert.doesNotMatch(ci, /test-crap|crap-check-types|crap:check-types/);
});

test("CRAP commands pass the optional workspace selector to the shared analyzer", () => {
	for (const target of ["crap", "check-crap"]) {
		assert.match(
			output(target, "PACKAGE=ingestor"),
			/PACKAGE="ingestor".*wallpaperdb-crap/,
		);
		assert.match(output(target), /PACKAGE="".*wallpaperdb-crap/);
	}
});

test("focused tests select one workspace and serialize dependency builds and tests", () => {
	assert.notEqual(make("test-focused").status, 0);
	for (const [workspace, file] of [
		["web", "test/components/profile/public-profile-page.dom.test.tsx"],
		["gateway", "test/catalogue.unit.test.ts"],
	]) {
		const focused = output(
			"test-focused",
			`PACKAGE=${workspace}`,
			`ARGS=${file}`,
		);
		assert.ok(
			focused.includes(
				`run build --filter="@wallpaperdb/${workspace}^..." --concurrency=1`,
			),
		);
		assert.ok(
			focused.includes(
				`node scripts/test-focused.mjs "${workspace}" ${file}`,
			),
		);
		assert.doesNotMatch(
			focused,
			/--minWorkers/,
			"the shared command must support gateway Vitest 5",
		);
	}
});

test("dev defaults to Compose and scopes workspace dev through Turbo", () => {
	assert.match(output("dev"), /docker compose .* watch/);
	assert.match(
		output("dev", "PACKAGE=docs"),
		/run dev .*--filter=@wallpaperdb\/docs/,
	);
});

test("stop tears down apps before infrastructure for the selected Compose project", () => {
	const commands = output("stop", "COMPOSE_PROJECT_NAME=isolated");
	const apps = commands.indexOf(
		"docker compose -p isolated -f infra/docker-compose.apps.yml down",
	);
	const infra = commands.indexOf(
		"docker compose -p isolated -f infra/docker-compose.yml --profile '*' down",
	);
	assert.ok(apps >= 0, "stop must tear down the app stack");
	assert.ok(infra > apps, "stop must tear down infrastructure after apps");
});

test("database and Compose commands use explicit selectors", () => {
	assert.match(output("psql"), /psql -U wallpaperdb\s/);
	assert.match(output("psql", "DB=asset"), /-d wallpaperdb_media/);
	assert.match(
		output("apps-start", "SERVICE=ingestor", "COMPOSE_PROJECT_NAME=isolated"),
		/-p isolated .*up -d --build ingestor/,
	);
	assert.match(output("apps-stop", "SERVICE=ingestor"), /stop ingestor/);
	assert.doesNotMatch(output("apps-stop", "SERVICE=ingestor"), / down/);
	assert.match(output("apps-stop"), / down/);
});

test("admin infrastructure has an explicit Make path and participates in teardown", () => {
	assert.match(output("infra-start-admin"), /--profile admin up -d/);
	assert.doesNotMatch(output("infra-start"), /--profile admin/);
	for (const target of ["infra-stop", "infra-reset", "infra-logs"]) {
		assert.match(output(target), /--profile '\*'/);
	}
});

test("one-off scripts require a package and script", () => {
	assert.notEqual(make("run").status, 0);
	assert.notEqual(make("run", "PACKAGE=web").status, 0);
	assert.match(
		output("run", "PACKAGE=web", "SCRIPT=preview"),
		/pnpm --filter @wallpaperdb\/web run preview/,
	);
});

test("force applies to ordinary CI checks and type checks", () => {
	const ci = output("ci", "FORCE=1");
	assert.match(
		ci,
		/run build lint check-types test:unit test:integration .*--force/,
	);
	assert.doesNotMatch(ci, /run test:e2e/);
	assert.match(
		ci,
		/run build lint check-types test:unit test:integration .*--concurrency=1/,
	);
	const scopedCi = output("ci", "PACKAGE=web");
	assert.doesNotMatch(
		scopedCi,
		/run (build lint check-types test:unit test:integration|test:e2e)[^\n]*--filter=/,
	);
	assert.doesNotMatch(
		scopedCi,
		/run build --filter=@wallpaperdb\/vitest-config/,
	);
	assert.match(output("check-types", "FORCE=1"), /run check-types .*--force/);
});

test("default goal is help, even with worktree configuration", () => {
	const result = spawnSync("make", ["--no-print-directory"], {
		encoding: "utf8",
		env,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /PACKAGE=web/);
	assert.doesNotMatch(result.stdout, /ingestor-build/);
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
	assert.equal(help.status, 0, help.stderr);
	for (const [line, name] of targets) {
		assert.match(line, /## /, `${name} needs a help description`);
		assert.ok(phony.includes(name), `${name} must be phony`);
		assert.match(help.stdout, new RegExp(`^  ${name}\\s`, "m"));
	}
});
