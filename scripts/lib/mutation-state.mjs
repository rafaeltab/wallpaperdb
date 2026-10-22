import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { release } from "node:os";
import { createRequire } from "node:module";
import { isProcessed, mergeReports } from "./mutation-results.mjs";

const version = 1;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const isPosition = (value) =>
	Number.isSafeInteger(value?.line) &&
	value.line > 0 &&
	Number.isSafeInteger(value.column) &&
	value.column > 0;
const runtime = {
	node: process.version,
	versions: process.versions,
	platform: process.platform,
	arch: process.arch,
	// Hosted Ubuntu images can use different host kernels on consecutive runs.
	// The distribution and libc identify the userland executing Node and tests.
	os:
		process.platform === "linux" && existsSync("/etc/os-release")
			? Object.fromEntries(
					readFileSync("/etc/os-release", "utf8")
						.split("\n")
						.map((line) => /^(ID|VERSION_ID)=["']?([^"']*)["']?$/.exec(line))
						.filter(Boolean)
						.map((match) => [match[1], match[2]]),
				)
			: { release: release() },
	libc: process.report.getReport().header.glibcVersionRuntime ?? "not-glibc",
};
export const isMutationSource = (file) =>
	file.startsWith("src/") &&
	/\.[cm]?[jt]sx?$/.test(file) &&
	!/\.(?:d|test|spec|stories)\.[cm]?[jt]sx?$/.test(file) &&
	file !== "src/routeTree.gen.ts";
const isTest = (file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
export const isMutationToolInput = (file) =>
	/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|turbo\.json|mise\.(?:toml|lock))$/.test(
		file,
	) ||
	file.startsWith("patches/") ||
	/^scripts\/(?:lib\/)?mutation/.test(file);

export function git(root, ...args) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function manifests(root) {
	const directories = [".", "scripts", "infra"];
	for (const parent of ["apps", "packages", "experiments"]) {
		if (existsSync(join(root, parent)))
			for (const d of readdirSync(join(root, parent), {
				withFileTypes: true,
			})) {
				if (d.isDirectory()) directories.push(`${parent}/${d.name}`);
			}
	}
	return new Map(
		directories
			.filter((d) => existsSync(join(root, d, "package.json")))
			.map((directory) => {
				const manifest = readJson(join(root, directory, "package.json"));
				return [manifest.name, { directory, manifest }];
			}),
	);
}
/** Inputs Stryker cannot track are separate from source/test inputs it diffs. */
export function mutationContext(root, workspace, suite, config) {
	if (!/^[a-z][a-z0-9-]*$/.test(suite))
		throw new Error("Invalid mutation suite");
	const all = manifests(root),
		own = [...all.values()].find((m) => m.directory === workspace);
	if (!own) throw new Error(`Unknown workspace: ${workspace}`);
	const dependencies = new Set();
	function visit(manifest) {
		for (const name of Object.keys({
			...manifest.dependencies,
			...manifest.devDependencies,
			...manifest.peerDependencies,
			...manifest.optionalDependencies,
		})) {
			const dep = all.get(name);
			if (
				dep &&
				dep.directory !== workspace &&
				!dependencies.has(dep.directory)
			) {
				dependencies.add(dep.directory);
				visit(dep.manifest);
			}
		}
	}
	visit(own.manifest);
	const externalInputs = config.externalInputs ?? [];
	for (const file of externalInputs)
		if (
			typeof file !== "string" ||
			isAbsolute(file) ||
			file.includes("\\") ||
			file.split("/").some((part) => ["", ".", ".."].includes(part)) ||
			!existsSync(join(root, file))
		)
			throw new Error(`Invalid external mutation input: ${file}`);
	const files = execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	const compatibility = [],
		inputs = [];
	for (const file of [...new Set([...files, ...externalInputs])].sort()) {
		if (!existsSync(join(root, file))) continue;
		const inside = file.startsWith(`${workspace}/`),
			local = inside ? file.slice(workspace.length + 1) : "";
		const controlled = isMutationToolInput(file);
		const dependency = [...dependencies].some((d) => file.startsWith(`${d}/`));
		if (inside || controlled || dependency || externalInputs.includes(file)) {
			const entry = [file, digest(readFileSync(join(root, file)))];
			if (
				inside &&
				((config.sourceFiles
					? config.sourceFiles.includes(local)
					: isMutationSource(local)) ||
					isTest(local))
			)
				inputs.push(entry);
			else compatibility.push(entry);
		}
	}
	const environment = (config.environmentKeys ?? []).map((name) => [
		name,
		digest(
			JSON.stringify(
				name === "MUTATION_REDIS_ISOLATED"
					? process.env[name] === "1"
					: (process.env[name] ?? null),
			),
		),
	]);
	const require = createRequire(import.meta.url);
	const tools = [
		"@stryker-mutator/core",
		"@stryker-mutator/vitest-runner",
		"vitest",
	].map((name) => [name, require(`${name}/package.json`).version]);
	const key = digest(
		JSON.stringify({
			version,
			workspace,
			suite,
			config: { ...config, sourceFiles: undefined },
			compatibility,
			environment,
			runtime,
			tools,
		}),
	);
	const common = git(
		root,
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	);
	return {
		root,
		workspace,
		suite,
		config,
		compatibility: {
			runtime,
			diagnostics: { kernelRelease: release() },
			tools,
			configDigest: digest(JSON.stringify(config)),
			externalInputsDigest: digest(JSON.stringify(compatibility)),
			environmentDigest: digest(JSON.stringify(environment)),
		},
		key,
		inputDigest: digest(JSON.stringify([key, inputs])),
		watchRoots: [workspace, ...dependencies, ...externalInputs],
		cacheDirectory: join(
			common,
			"mutation",
			`v${version}`,
			basename(workspace),
			suite,
			key,
		),
	};
}
export function validateReport(report) {
	if (report?.schemaVersion !== "1.0" || !report.files || !report.testFiles)
		throw new Error("Invalid Stryker report");
	for (const [name, file] of Object.entries({
		...report.files,
		...report.testFiles,
	})) {
		if (
			isAbsolute(name) ||
			name.includes("\\") ||
			name.split("/").includes("..")
		)
			throw new Error(`Unsafe report path: ${name}`);
		if (typeof file.source !== "string")
			throw new Error(`Missing source: ${name}`);
	}
	for (const file of Object.values(report.files)) {
		if (!Array.isArray(file.mutants)) throw new Error("Missing mutant results");
		for (const mutant of file.mutants) {
			if (
				typeof mutant?.id !== "string" ||
				typeof mutant.mutatorName !== "string" ||
				(mutant.replacement !== undefined &&
					typeof mutant.replacement !== "string") ||
				!isPosition(mutant.location?.start) ||
				!isPosition(mutant.location?.end) ||
				mutant.location.end.line < mutant.location.start.line ||
				(mutant.location.end.line === mutant.location.start.line &&
					mutant.location.end.column < mutant.location.start.column)
			)
				throw new Error("Invalid mutant identity");
			for (const references of [mutant.coveredBy, mutant.killedBy])
				if (
					references !== undefined &&
					(!Array.isArray(references) ||
						references.some((id) => typeof id !== "string"))
				)
					throw new Error("Invalid mutant test references");
			if (mutant.status === "Survived" && mutant.testsCompleted === 0)
				throw new Error("Surviving mutation ran zero tests");
		}
	}
	for (const file of Object.values(report.testFiles)) {
		if (!Array.isArray(file.tests)) throw new Error("Missing test results");
		for (const test of file.tests) {
			if (
				typeof test?.id !== "string" ||
				typeof test.name !== "string" ||
				(test.location !== undefined &&
					(!isPosition(test.location?.start) ||
						(test.location.end !== undefined &&
							(!isPosition(test.location.end) ||
								test.location.end.line < test.location.start.line ||
								(test.location.end.line === test.location.start.line &&
									test.location.end.column < test.location.start.column)))))
			)
				throw new Error("Invalid test identity");
		}
	}
}
export function validateBaseline(state) {
	if (
		state?.version !== version ||
		typeof state.key !== "string" ||
		!/^[a-f0-9]{64}$/.test(state.key) ||
		typeof state.inputDigest !== "string" ||
		!/^[a-f0-9]{64}$/.test(state.inputDigest)
	)
		throw new Error("Invalid checkpoint identity");
	// Snapshots are sorted lexically, so require the publisher's canonical UTC form.
	if (
		typeof state.createdAt !== "string" ||
		!Number.isFinite(Date.parse(state.createdAt)) ||
		new Date(state.createdAt).toISOString() !== state.createdAt
	)
		throw new Error("Invalid checkpoint creation timestamp");
	const discovery = state.discovery;
	if (
		discovery !== undefined &&
		(!discovery ||
			!Array.isArray(discovery.files) ||
			!Array.isArray(discovery.selected) ||
			[...discovery.files, ...discovery.selected].some(
				(file) =>
					typeof file !== "string" ||
					!isMutationSource(file) ||
					file.includes("\\") ||
					file.includes("\0") ||
					file.split("/").some((part) => ["", ".", ".."].includes(part)),
			) ||
			discovery.selected.some((file) => !discovery.files.includes(file)))
	)
		throw new Error("Invalid checkpoint discovery");
	validateReport(state.report);
}
export function mutantCount(report) {
	return Object.values(report.files).reduce((n, f) => n + f.mutants.length, 0);
}
/** Immutable snapshots avoid overwriting another worktree's in-progress report. */
export function publishBaseline(
	context,
	report,
	{ complete = false, discovery, provenance } = {},
) {
	const portable = structuredClone(report);
	delete portable.config;
	delete portable.projectRoot;
	const envelope = {
		version,
		key: context.key,
		inputDigest: context.inputDigest,
		complete,
		discovery,
		provenance:
			provenance ??
			Object.fromEntries(
				Object.keys(report.files).map((file) => [file, context.inputDigest]),
			),
		compatibility: context.compatibility,
		createdAt: new Date().toISOString(),
		report: portable,
	};
	validateBaseline(envelope);
	mkdirSync(context.cacheDirectory, { recursive: true });
	const file = join(
		context.cacheDirectory,
		`${Date.now()}-${randomUUID()}.json`,
	);
	const temp = `${file}.tmp`;
	writeFileSync(temp, JSON.stringify(envelope));
	renameSync(temp, file);
	return file;
}
export function importBaseline(context, file) {
	const state = readJson(file);
	if (
		state.version !== version ||
		state.key !== context.key ||
		!/^[a-f0-9]{64}$/.test(state.inputDigest)
	)
		return false;
	validateBaseline(state);
	mkdirSync(context.cacheDirectory, { recursive: true });
	const destination = join(
		context.cacheDirectory,
		`${Date.now()}-${randomUUID()}.json`,
	);
	writeFileSync(`${destination}.tmp`, JSON.stringify(state));
	renameSync(`${destination}.tmp`, destination);
	return true;
}
export function restoreBaseline(context, { forExecution = false } = {}) {
	if (!existsSync(context.cacheDirectory)) return null;
	const entries = [];
	for (const file of readdirSync(context.cacheDirectory).filter((f) =>
		f.endsWith(".json"),
	)) {
		try {
			const state = readJson(join(context.cacheDirectory, file));
			validateBaseline(state);
			if (state.version === version && state.key === context.key)
				entries.push(state);
		} catch {
			/* A corrupt checkpoint cannot establish a result. Try another snapshot. */
		}
	}
	entries.sort(
		(a, b) =>
			Number(b.inputDigest === context.inputDigest) -
				Number(a.inputDigest === context.inputDigest) ||
			mutantCount(b.report) - mutantCount(a.report) ||
			b.createdAt.localeCompare(a.createdAt),
	);
	const state = entries[0];
	if (!state) return null;
	// Union snapshots for exactly the same inputs. Never discard an independent
	// writer's completed mutants by choosing only the largest report.
	const compatible = entries.filter(
		(entry) => entry.inputDigest === state.inputDigest,
	);
	compatible.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const provenanceOf = (entry, file) =>
		entry.provenance?.[file] ?? entry.inputDigest;
	const selected = new Map();
	for (const entry of compatible)
		for (const [file, report] of Object.entries(entry.report.files)) {
			const inputDigest = provenanceOf(entry, file);
			const previous = selected.get(file);
			const terminal =
				report.mutants.some(
					(mutant) => isProcessed(mutant) || mutant.conflictingStatuses?.length,
				) ||
				(previous?.inputDigest === inputDigest && previous.terminal);
			// Merge a file only within one provenance. Prefer current inputs;
			// otherwise a later plan cannot relabel retained terminal evidence.
			if (
				!previous ||
				previous.inputDigest === inputDigest ||
				inputDigest === state.inputDigest ||
				(previous.inputDigest !== state.inputDigest &&
					(terminal || !previous.terminal))
			)
				selected.set(file, { inputDigest, terminal });
		}
	const reports = compatible.map((entry) => ({
		...entry.report,
		files: Object.fromEntries(
			Object.entries(entry.report.files).filter(
				([file]) =>
					provenanceOf(entry, file) === selected.get(file).inputDigest,
			),
		),
	}));
	const report = mergeReports(reports);
	const provenance = Object.fromEntries(
		[...selected].map(([file, evidence]) => [file, evidence.inputDigest]),
	);
	for (const [name, file] of Object.entries(report.files))
		file.mutants = file.mutants.filter(
			(m) =>
				(!forExecution ||
					(provenance[name] === context.inputDigest &&
						!["RuntimeError", "CompileError", "Ignored", "Pending"].includes(
							m.status,
						))) &&
				!(m.static && state.inputDigest !== context.inputDigest),
		);
	report.projectRoot = resolve(context.root, context.workspace);
	const discoveries = compatible
		.map((entry) => entry.discovery)
		.filter(Boolean);
	return {
		...state,
		report,
		provenance,
		discovery: discoveries.length
			? {
					files: [
						...new Set(discoveries.flatMap((discovery) => discovery.files)),
					],
					selected: [
						...new Set(discoveries.flatMap((discovery) => discovery.selected)),
					],
				}
			: undefined,
	};
}
