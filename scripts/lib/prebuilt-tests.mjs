import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
	dirname,
	isAbsolute,
	join,
	matchesGlob,
	relative,
	resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
	auditNodeCoverage,
	collectNodeCoverage,
	emittedName,
	nativeStdio,
	stageNodeTree,
} from "./prebuilt-node.mjs";

const matches = (file, patterns) =>
	patterns.some((pattern) => matchesGlob(file, pattern));

/** One-shot native Node execution. Unsupported runtime policies fail explicitly. */
export async function runPrebuiltTests({
	root,
	cwd,
	args,
	artifacts = join(root, ".prebuilt-tests"),
	aliases = {},
	fixtureScripts = {},
	built = [],
}) {
	const require = createRequire(join(cwd, "package.json"));
	const { parseCLI, resolveConfig } = await import(
		pathToFileURL(require.resolve("vitest/node")).href
	);
	const parsed = parseCLI(["vitest", "run", ...args]);
	cwd = resolve(cwd, parsed.options.root ?? ".");
	if (relative(root, cwd).startsWith(".."))
		throw new Error(
			"Prebuilt test root must stay inside the staged repository",
		);
	if (parsed.options.watch || parsed.options.ui || parsed.options.update)
		throw new Error(
			"Prebuilt Node tests require a one-shot run; watch/UI/snapshot updates have not been qualified. Use the existing test:watch entrypoint.",
		);
	const resolved = await resolveConfig({ ...parsed.options, root: cwd });
	const config = resolved.test;
	const enabled = config.coverage.enabled;
	const reports = resolve(cwd, config.coverage.reportsDirectory);
	if (enabled) rmSync(reports, { recursive: true, force: true });
	if (
		config.browser?.enabled ||
		config.environment !== "node" ||
		config.projects?.length
	)
		throw new Error(
			"Prebuilt c8 requires one native Node project; browser/DOM/projects are not qualified",
		);
	const thresholds = config.coverage.thresholds ?? {};
	for (const [key, value] of Object.entries(thresholds)) {
		if (
			!["lines", "branches", "functions", "statements", "perFile"].includes(
				key,
			) ||
			(typeof value === "number" && value < 0) ||
			(key === "perFile" && typeof value !== "boolean")
		)
			throw new Error(`Unsupported c8 threshold policy: ${key}`);
	}
	const stage = stageNodeTree({ root, artifacts, aliases, fixtureScripts });
	const stageCwd = join(stage.tree, relative(root, cwd));
	const included = stage.inventory.filter((entry) => {
		const name = relative(cwd, entry.source);
		return matches(name, config.include) && !matches(name, config.exclude);
	});
	const originalConfig = resolved.configFile;
	if (!originalConfig)
		throw new Error("Prebuilt Node tests require an existing Vitest config");
	const wrapper = join(stage.directory, "vitest.config.mjs");
	const nativeConfig = {
		root: stageCwd,
		include: included.map((entry) => relative(stageCwd, entry.emitted)),
		setupFiles: config.setupFiles.map((file) =>
			join(stage.tree, emittedName(relative(root, file))),
		),
		globalSetup: config.globalSetup.map((file) =>
			join(stage.tree, emittedName(relative(root, file))),
		),
		pool: "threads",
		experimental: { ...config.experimental, viteModuleRunner: false },
		coverage: { enabled: false },
		outputFile:
			typeof config.outputFile === "string"
				? resolve(cwd, config.outputFile)
				: config.outputFile &&
					Object.fromEntries(
						Object.entries(config.outputFile).map(([name, file]) => [
							name,
							resolve(cwd, file),
						]),
					),
	};
	writeFileSync(
		wrapper,
		`import configuration from ${JSON.stringify(pathToFileURL(join(stage.tree, emittedName(relative(root, originalConfig)))).href)};\nexport default { ...configuration, root: ${JSON.stringify(stageCwd)}, test: { ...configuration.test, ...${JSON.stringify(nativeConfig)} } };\n`,
	);
	const filters = parsed.filter.map((value) => {
		const filter = isAbsolute(value)
			? join(stage.tree, relative(root, value))
			: value;
		return filter.replace(/\.(tsx?|mts|cts)(?=:|$)/, (extension) =>
			emittedName(`file${extension}`).slice(4),
		);
	});
	const vitestManifest = require.resolve("vitest/package.json");
	const vitestBin = JSON.parse(readFileSync(vitestManifest, "utf8")).bin.vitest;
	const driver = join(stage.directory, "vitest-runner.mjs");
	// Let Vitest retain option values separately from positional filters. Its
	// public CLI action owns execution, failure status and resource cleanup.
	writeFileSync(
		driver,
		`import { createCLI } from ${JSON.stringify(pathToFileURL(require.resolve("vitest/node")).href)};\nconst cli = createCLI();\ncli.parse(${JSON.stringify([process.execPath, resolve(dirname(vitestManifest), vitestBin), "run", ...args])}, { run: false });\ncli.args = ${JSON.stringify(filters)};\ncli.options = { ...cli.options, ...${JSON.stringify({ config: wrapper, root: stageCwd, coverage: { enabled: false }, outputFile: nativeConfig.outputFile })} };\nawait cli.runMatchedCommand();\n`,
	);
	const command = [driver];
	if (!enabled) {
		const execution = spawnSync(process.execPath, command, {
			cwd: stageCwd,
			stdio: nativeStdio(),
			env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" },
		});
		if (execution.error) throw execution.error;
		return { status: execution.status ?? 1, stage };
	}
	const expected = stage.inventory.filter((entry) => {
		const name = relative(cwd, entry.source);
		return (
			matches(name, config.coverage.include ?? ["**/*"]) &&
			!matches(name, config.coverage.exclude)
		);
	});
	if (!expected.length) throw new Error("Coverage source selection is empty");
	const temporaryReports = join(stage.directory, "reports");
	const reporters = config.coverage.reporter.map(([name, options]) => {
		if (Object.keys(options).length)
			throw new Error(`c8 reporter options are not qualified: ${name}`);
		return name;
	});
	const execution = collectNodeCoverage({
		cwd: stageCwd,
		args: command,
		reports: temporaryReports,
		stdio: "inherit",
		coverage: {
			extension: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
			src: [...new Set(expected.map((entry) => dirname(entry.emitted)))],
			include: expected.flatMap((entry) => [entry.emitted, entry.source]),
			exclude: [],
			"allow-external": true,
			"exclude-node-modules": false,
			"exclude-after-remap": true,
			reporter: [...new Set([...reporters, "json"])],
			reporterOptions: {
				lcov: { projectRoot: cwd },
				lcovonly: { projectRoot: cwd },
			},
			"check-coverage": Object.keys(thresholds).length > 0,
			lines: 0,
			functions: 0,
			branches: 0,
			statements: 0,
			...thresholds,
			"per-file": thresholds.perFile ?? false,
		},
	});
	if (execution.error) throw execution.error;
	const audit = auditNodeCoverage(stage, temporaryReports, expected, built);
	const coverage = JSON.parse(
		readFileSync(join(temporaryReports, "coverage-final.json"), "utf8"),
	);
	const expectedPaths = expected.map((entry) => entry.source).sort();
	const actualPaths = Object.keys(coverage).sort();
	if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths))
		throw new Error(
			`Coverage inventory mismatch: expected ${expectedPaths.length}, reported ${actualPaths.length}. Missing: ${expectedPaths.filter((file) => !coverage[file]).join(", ")}. Extra: ${actualPaths.filter((file) => !expectedPaths.includes(file)).join(", ")}`,
		);
	const status = execution.status ?? 1;
	if (status === 0 || config.coverage.reportOnFailure) {
		mkdirSync(dirname(reports), { recursive: true });
		cpSync(temporaryReports, reports, { recursive: true });
		writeFileSync(
			join(reports, "prebuilt-run.json"),
			JSON.stringify({
				status,
				directory: stage.directory,
				audit,
				sourceInventory: expectedPaths,
			}),
		);
	}
	return { status, stage, audit, reports };
}
