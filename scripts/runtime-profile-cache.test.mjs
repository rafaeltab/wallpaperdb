import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const helper = new URL("../packages/test-logger/src/index.ts", import.meta.url)
	.href;
const phases = ["unit", "integration", "all"];
const taskFor = (phase) => (phase === "all" ? "test" : `test:${phase}`);
const reportFor = (phase) =>
	`test-results/ci-runtime-vitest${phase === "integration" ? "" : `-${phase}`}.json`;

function fixture(t, workspace) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-runtime-cache-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	function write(relative, contents) {
		const filename = join(root, relative);
		mkdirSync(dirname(filename), { recursive: true });
		writeFileSync(filename, contents);
	}
	write(
		"package.json",
		JSON.stringify({
			name: "@wallpaperdb/root",
			private: true,
			packageManager: "pnpm@10.18.3",
		}),
	);
	write("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
	write(
		"pnpm-lock.yaml",
		`lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n  apps/${workspace}: {}\n`,
	);
	write(
		".gitignore",
		"node_modules/\n.turbo/\ncoverage/\ntest-results/\nexecutions.jsonl\n",
	);
	write("turbo.json", readFileSync(join(repository, "turbo.json"), "utf8"));
	write(
		`apps/${workspace}/turbo.json`,
		readFileSync(join(repository, `apps/${workspace}/turbo.json`), "utf8"),
	);
	const manifest = JSON.parse(
		readFileSync(join(repository, `apps/${workspace}/package.json`), "utf8"),
	);
	write(
		`apps/${workspace}/package.json`,
		JSON.stringify({
			name: manifest.name,
			type: "module",
			scripts: {
				build: 'node -e ""',
				...Object.fromEntries(
					phases.map((phase) => [
						taskFor(phase),
						manifest.scripts[taskFor(phase)].replace(
							/^vitest run/,
							"node --experimental-strip-types test/cache-operation.mjs",
						),
					]),
				),
			},
		}),
	);
	write(
		`apps/${workspace}/test/cache-operation.mjs`,
		`
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { measureTestPhase } from ${JSON.stringify(helper)};
const event = process.env.npm_lifecycle_event;
const phase = event === 'test:unit' ? 'unit' : event === 'test:integration' ? 'integration' : 'all';
appendFileSync('executions.jsonl', JSON.stringify({ phase, profiling: process.env.CI_RUNTIME_PROFILE }) + '\\n');
const execution = readFileSync('executions.jsonl', 'utf8').trim().split('\\n').length;
const write = (filename, contents) => { mkdirSync(dirname(filename), { recursive: true }); writeFileSync(filename, contents); };
if (process.argv.includes('--coverage')) {
  const directory = process.argv.find(value => value.startsWith('--coverage.reportsDirectory='))?.split('=')[1] ?? 'coverage/integration';
  write(directory + '/coverage-final.json', JSON.stringify({ phase, execution }));
}
if (process.env.CI_RUNTIME_PROFILE === 'true') {
  await measureTestPhase('fixture.' + phase, async () => phase);
  const report = process.argv.find(value => value.startsWith('--outputFile.json='))?.split('=')[1] ?? 'test-results/ci-runtime-vitest.json';
  write(report, JSON.stringify({ phase, execution }));
}
`,
	);
	for (const args of [
		["init", "-q"],
		["add", "."],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}
	const application = join(root, "apps", workspace);
	function run(task, profiling, extra = []) {
		const env = {
			...process.env,
			TURBO_TELEMETRY_DISABLED: "1",
			TURBO_TOKEN: "",
			TURBO_TEAM: "",
		};
		delete env.CI_RUNTIME_PROFILE;
		if (profiling) env.CI_RUNTIME_PROFILE = "true";
		const result = spawnSync(
			join(repository, "node_modules/.bin/turbo"),
			[
				"run",
				task,
				`--filter=${manifest.name}`,
				"--cache=local:rw",
				`--cache-dir=${join(root, ".turbo/cache")}`,
				...extra,
			],
			{ cwd: root, env, encoding: "utf8", timeout: 30_000 },
		);
		assert.equal(result.error, undefined, result.error?.message);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return result;
	}
	const executions = () =>
		readFileSync(join(application, "executions.jsonl"), "utf8")
			.trim()
			.split("\n").length;
	return { application, executions, run };
}

for (const workspace of ["gateway", "ingestor"]) {
	test(`${workspace} separates profiled test caches and restores only the selected phase`, (t) => {
		const project = fixture(t, workspace);
		const buildHash = (profiling) => {
			const plan = JSON.parse(
				project.run("build", profiling, ["--dry=json"]).stdout,
			);
			return plan.tasks.find((entry) => entry.taskId.endsWith("#build")).hash;
		};
		assert.equal(buildHash(false), buildHash(true));
		for (const phase of phases) {
			const initialExecutions = phase === "unit" ? 0 : project.executions();
			project.run(taskFor(phase), false);
			assert.equal(project.executions(), initialExecutions + 1);
			const foreign = phases
				.filter((candidate) => candidate !== phase)
				.flatMap((candidate) => [
					reportFor(candidate),
					`test-results/ci-runtime-${candidate}-foreign.jsonl`,
				]);
			mkdirSync(join(project.application, "test-results"), { recursive: true });
			for (const name of foreign)
				writeFileSync(join(project.application, name), "old foreign evidence");
			project.run(taskFor(phase), true);
			assert.equal(
				project.executions(),
				initialExecutions + 2,
				`${phase} profiling must execute after an ordinary cached run`,
			);
			const phaseFiles = readdirSync(join(project.application, "test-results"))
				.filter((name) => name.startsWith(`ci-runtime-${phase}-`))
				.map((name) => `test-results/${name}`);
			assert.ok(phaseFiles.some((name) => /-\d+\.jsonl$/.test(name)));
			const owned = [reportFor(phase), ...phaseFiles];
			if (phase !== "all") owned.push(`coverage/${phase}/coverage-final.json`);
			const contents = new Map(
				owned.map((name) => [
					name,
					readFileSync(join(project.application, name), "utf8"),
				]),
			);
			for (const name of foreign)
				writeFileSync(
					join(project.application, name),
					"fresh foreign evidence",
				);
			for (const name of owned) rmSync(join(project.application, name));
			const cached = project.run(taskFor(phase), true);
			assert.match(cached.stdout, /cache hit/);
			assert.equal(project.executions(), initialExecutions + 2);
			for (const [name, expected] of contents)
				assert.equal(
					readFileSync(join(project.application, name), "utf8"),
					expected,
				);
			for (const name of foreign)
				assert.equal(
					readFileSync(join(project.application, name), "utf8"),
					"fresh foreign evidence",
					`${phase} cache must not restore another phase's ${name}`,
				);
		}
	});
}
