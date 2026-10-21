// PROTOTYPE #417. Opt-in. Does not alter CI, test sources, or runner defaults.
import { randomUUID } from "node:crypto";
import {
	globSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
	rmSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	command,
	graph,
	readJson,
	rel,
	scan,
	typeMembers,
	taskArguments,
	vitestFiles,
	playwrightFiles,
} from "./collect.mjs";
import { evaluate } from "./policy.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const suiteDefinitions = [
	{
		id: "tooling-node",
		runner: "node",
		cwd: ".",
		task: "@wallpaperdb/scripts#test:unit",
	},
	{
		id: "tooling-vitest",
		cwd: ".",
		task: "@wallpaperdb/scripts#test:unit",
		all: ["scripts/ci-runner.test.ts", "scripts/lib/env-pipeline.test.ts"],
		sample: ["scripts/ci-runner.test.ts", "scripts/lib/env-pipeline.test.ts"],
	},
	{
		id: "repository-integration",
		cwd: ".",
		task: "//#test:integration",
		all: ["--config", "vitest.integration.config.ts"],
	},
	{
		id: "gateway",
		expectedProjects: [
			"gateway-unit",
			"gateway-integration",
			"gateway-search",
			"gateway-instrumentation",
		].map((name) => ({ name, role: "expected" })),
		cwd: "apps/gateway",
		task: "@wallpaperdb/gateway#test:unit",
		otherTasks: ["@wallpaperdb/gateway#test:integration"],
		all: [],
		sample: ["test/color-query.unit.test.ts", "--project=gateway-unit"],
	},
	{
		id: "web",
		expectedProjects: ["web-node", "web-dom"].map((name) => ({
			name,
			role: "expected",
		})),
		cwd: "apps/web",
		task: "@wallpaperdb/web#test:unit",
		all: [],
		sample: [
			"test/features/preferences.test.ts",
			"test/routes/profile-redirect-preload.dom.test.ts",
		],
	},
	{
		id: "web-browser",
		expectedProjects: [
			{ name: "picture-browser-contracts (chromium)", role: "expected" },
		],
		cwd: "apps/web",
		task: "@wallpaperdb/web#test:integration",
		all: ["--config", "vitest.browser.config.ts"],
		sample: [
			"--config",
			"vitest.browser.config.ts",
			"test/browser/picture-processing.spec.ts",
		],
	},
	{
		id: "web-clean-checkout",
		runner: "node",
		cwd: "apps/web",
		task: "@wallpaperdb/web#test:integration",
	},
	{
		id: "playwright-unit",
		cwd: "apps/web-e2e",
		task: "@wallpaperdb/web-e2e#test:unit",
		all: ["test"],
		sample: ["test"],
	},
	{
		id: "playwright",
		expectedProjects: [
			{ name: "setup:base-user", role: "expected" },
			{ name: "chromium", role: "expected" },
		],
		runner: "playwright",
		cwd: "apps/web-e2e",
		task: "@wallpaperdb/web-e2e#test:e2e",
	},
];

export function executeVitest(root, suite, args, scratch, index) {
	const expected = vitestFiles(
		root,
		suite,
		args,
		scratch,
		`selected-${index}`,
	).files;
	const output = resolve(scratch, `execution-${index}.json`);
	const nonce = randomUUID();
	const result = command(
		resolve(root, suite.cwd, "node_modules/.bin/vitest"),
		[
			"run",
			...args,
			"--allowOnly=false",
			`--passWithNoTests=${Boolean(suite.role === "selection" && suite.reason)}`,
			"--coverage.enabled=false",
			"--maxWorkers=1",
			"--no-file-parallelism",
			"--reporter",
			"default",
			"--reporter",
			fileURLToPath(new URL("./vitest-reporter.mjs", import.meta.url)),
		],
		resolve(root, suite.cwd),
		{ ...suite.env, COMPLETENESS_RECEIPT: output, COMPLETENESS_NONCE: nonce },
		120_000,
	);
	const receipt = existsSync(output)
		? readJson(output)
		: { files: [], errors: ["Missing execution receipt"] };
	return {
		id: suite.id,
		selection: args,
		expectedFiles: expected,
		expectedNonce: nonce,
		nonce: receipt.nonce,
		status: result.status,
		ms: result.ms,
		errors: receipt.errors,
		reason: receipt.reason,
		diagnostic:
			result.status === 0
				? undefined
				: `${result.error ?? ""}\n${result.stderr}\n${result.stdout}`.slice(
						-6000,
					),
		files: receipt.files.map((f) => ({
			...f,
			key: `${f.project ?? ""}::${rel(root, f.path)}`,
		})),
	};
}

export function pilot({ execute = false, output, exceptions = [] } = {}) {
	const start = performance.now();
	const scratch = mkdtempSync(
		resolve(tmpdir(), "wallpaperdb-completeness-417-"),
	);
	try {
		const { tasks, evidence } = graph(root);
		const input = {
			files: [],
			suites: [],
			findings: [],
			executions: [],
			conditionals: [],
			graph: evidence,
			pilotOnly: true,
		};
		const timing = [];
		let index = 0;
		for (const suite of suiteDefinitions) {
			const taskIds = [suite.task, ...(suite.otherTasks ?? [])];
			const scripts = taskIds
				.map((id) => tasks.get(id)?.command)
				.filter(Boolean);
			let discovery;
			let ciFiles = [];
			if (suite.runner === "node") {
				const patterns =
					suite.id === "tooling-node"
						? ["scripts/*.test.mjs", "scripts/lib/*.test.mjs"]
						: ["test/clean-checkout.test.mjs"];
				discovery = {
					files: globSync(patterns, { cwd: resolve(root, suite.cwd) }).map(
						(f) => `node::${rel(root, resolve(root, suite.cwd, f))}`,
					),
				};
				const nodeScript = scripts
					.join(" && ")
					.match(/node --test ([^&]+)/)?.[1]
					?.trim();
				if (scripts.length && (!nodeScript || /[^\w./* -]/.test(nodeScript)))
					throw new Error(`Unsupported Node test task for ${suite.id}`);
				ciFiles = globSync(nodeScript?.split(/\s+/) ?? [], {
					cwd: resolve(root, suite.cwd),
				}).map((f) => `node::${rel(root, resolve(root, suite.cwd, f))}`);
			} else if (suite.runner === "playwright") {
				discovery = playwrightFiles(root, suite, scratch, index++);
				const script = scripts[0] ?? "";
				if (
					scripts.length &&
					!/playwright test --config playwright.config.ts(?: --pass-with-no-tests)?$/.test(
						script,
					)
				)
					throw new Error(`Unsupported Playwright task command: ${script}`);
				ciFiles = scripts.length ? discovery.files : [];
				input.findings.push(
					...(script.includes("--pass-with-no-tests")
						? [
								{
									code: "empty-run-permitted",
									target: suite.task,
									detail:
										"CI command permits zero tests; removal evaluated by executable controls",
								},
							]
						: []),
				);
			} else {
				discovery = vitestFiles(root, suite, suite.all, scratch, index++);
				for (const script of scripts)
					ciFiles.push(
						...vitestFiles(root, suite, taskArguments(script), scratch, index++)
							.files,
					);
			}
			timing.push({ id: suite.id, discoveryMs: discovery.ms });
			input.suites.push({
				...suite,
				role: "expected",
				files: discovery.files,
				ciFiles: [...new Set(ciFiles)],
				inGraph: taskIds.every((id) => tasks.has(id)),
				projects: discovery.projects,
			});
			if (execute && suite.sample)
				input.executions.push(
					executeVitest(root, suite, suite.sample, scratch, index++),
				);
		}
		const typing = new Map();
		for (const [cwd, task] of [
			[".", "//#check-types"],
			["scripts", "@wallpaperdb/scripts#check-types"],
			["apps/gateway", "@wallpaperdb/gateway#check-types"],
			["apps/web", "@wallpaperdb/web#check-types"],
			["apps/web-e2e", "@wallpaperdb/web-e2e#check-types"],
		]) {
			if (!tasks.has(task)) {
				input.findings.push({
					code: "ci-task",
					target: task,
					detail: "Type-check task absent from the workflow graph",
				});
				continue;
			}
			const script = tasks.get(task)?.command ?? "";
			const tsc = script.match(/\btsc\b(.*)$/)?.[1];
			if (tsc === undefined || /[^\w ./=-]/.test(tsc))
				throw new Error(`Unsupported type-check task: ${task} ${script}`);
			const project =
				tsc.match(/(?:--project|-p)\s+([\w./-]+)/)?.[1] ?? "tsconfig.json";
			const members = typeMembers(
				root,
				resolve(root, cwd, project),
				/(?:^|\s)(?:-b|--build)(?:\s|$)/.test(tsc),
			);
			for (const [file, config] of members)
				typing.set(file, [...(typing.get(file) ?? []), `${task}:${config}`]);
		}
		const inventory = command(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard"],
			root,
		);
		if (inventory.status !== 0) throw new Error(inventory.stderr);
		for (const path of inventory.stdout.trim().split("\n")) {
			const scope =
				/^scripts\/(?:[^/]+\.test\.|lib\/)/.test(path) ||
				/^test\/(?:integration|fixtures\/crap)\//.test(path) ||
				/^apps\/(?:gateway|web)\/test\//.test(path) ||
				/^apps\/(?:gateway|web)\/src\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
					path,
				) ||
				/^apps\/web-e2e\/(?:src|test|specs)\//.test(path);
			if (!scope) continue;
			if (!/\.[cm]?[jt]sx?$/.test(path)) {
				input.files.push({
					path,
					role: "fixture",
					reason: "Non-code test data, not a test or a type-check input",
					typedBy: [],
					discovered: [],
				});
				continue;
			}
			const fixture = /\/(?:__fixtures__|fixtures)\//.test(path);
			const source = readFileSync(resolve(root, path), "utf8");
			const scanned = scan(path, source);
			const role = fixture
				? "fixture"
				: /\.(?:test|spec|setup)\.[cm]?[jt]sx?$/.test(path) || scanned.hasTests
					? "test"
					: "helper";
			if (!fixture) {
				input.findings.push(...scanned.findings);
				input.conditionals.push(...scanned.conditionals);
			}
			input.files.push({
				path,
				role,
				reason: fixture
					? "Data/code fixture directory, not compiled as a maintained test"
					: role === "helper"
						? "Supporting file, does not register tests"
						: "Filename or recognized test registration",
				typedBy: typing.get(path) ?? [],
				discovered: input.suites
					.flatMap((s) => s.files)
					.filter((k) => k.endsWith(`::${path}`)),
			});
		}
		const result = evaluate(input, exceptions);
		for (const run of input.executions)
			if (run.status !== 0 || run.errors?.length)
				result.failures.push({
					code: "runner-failure",
					target: run.id,
					detail: run.diagnostic ?? run.errors,
				});
		const report = {
			...input,
			...result,
			timing,
			elapsedMs: Math.round(performance.now() - start),
			executionScope: execute
				? "Explicit representative selections only; Docker suites and real Playwright journeys are discovery-only"
				: "Discovery/type/graph only; no execution claim",
			generatedAt: new Date().toISOString(),
		};
		if (output)
			writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
		return report;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const output = args.find((a) => a.startsWith("--output="))?.slice(9);
	const exceptionFile = args
		.find((a) => a.startsWith("--exceptions="))
		?.slice(13);
	try {
		const report = pilot({
			execute: args.includes("--execute"),
			output,
			exceptions: exceptionFile ? readJson(exceptionFile) : [],
		});
		console.log(
			JSON.stringify(
				{
					files: report.files.length,
					suites: report.suites.map((s) => ({
						id: s.id,
						task: s.task,
						files: s.files.length,
					})),
					failures: report.failures,
					allowed: report.allowed,
					executions: report.executions.map((r) => ({
						id: r.id,
						status: r.status,
						ms: r.ms,
						tests: r.files.reduce((n, f) => n + f.tests.length, 0),
					})),
					elapsedMs: report.elapsedMs,
					output,
				},
				null,
				2,
			),
		);
		process.exitCode = report.failures.length ? 1 : 0;
	} catch (error) {
		console.error(error.stack);
		process.exitCode = 2;
	}
}
