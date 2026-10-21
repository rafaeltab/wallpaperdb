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

const version = 1;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const isMutationSource = (file) =>
	file.startsWith("src/") &&
	/\.[cm]?[jt]sx?$/.test(file) &&
	!/\.(?:d|test|spec|stories)\.[cm]?[jt]sx?$/.test(file) &&
	file !== "src/routeTree.gen.ts";
const isTest = (file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
export const isMutationToolInput = (file) =>
	/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|turbo\.json)$/.test(
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
	const files = execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	const compatibility = [],
		inputs = [];
	for (const file of [...new Set(files)].sort()) {
		if (!existsSync(join(root, file))) continue;
		const inside = file.startsWith(`${workspace}/`),
			local = inside ? file.slice(workspace.length + 1) : "";
		const controlled = isMutationToolInput(file);
		const dependency = [...dependencies].some((d) => file.startsWith(`${d}/`));
		if (inside || controlled || dependency) {
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
		process.env[name] ?? null,
	]);
	const key = digest(
		JSON.stringify({
			version,
			workspace,
			suite,
			config: { ...config, sourceFiles: undefined },
			compatibility,
			environment,
			node: process.version,
			platform: process.platform,
			arch: process.arch,
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
		key,
		inputDigest: digest(JSON.stringify([key, inputs])),
		watchRoots: [workspace, ...dependencies],
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
			if (mutant.status === "Survived" && mutant.testsCompleted === 0)
				throw new Error("Surviving mutation ran zero tests");
		}
	}
}
export function mutantCount(report) {
	return Object.values(report.files).reduce((n, f) => n + f.mutants.length, 0);
}
/** Immutable snapshots avoid overwriting another worktree's in-progress report. */
export function publishBaseline(context, report, { complete = false } = {}) {
	validateReport(report);
	const portable = structuredClone(report);
	delete portable.config;
	delete portable.projectRoot;
	const envelope = {
		version,
		key: context.key,
		inputDigest: context.inputDigest,
		complete,
		createdAt: new Date().toISOString(),
		report: portable,
	};
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
	validateReport(state.report);
	mkdirSync(context.cacheDirectory, { recursive: true });
	const destination = join(
		context.cacheDirectory,
		`${Date.now()}-${randomUUID()}.json`,
	);
	writeFileSync(`${destination}.tmp`, JSON.stringify(state));
	renameSync(`${destination}.tmp`, destination);
	return true;
}
export function restoreBaseline(context) {
	if (!existsSync(context.cacheDirectory)) return null;
	const entries = [];
	for (const file of readdirSync(context.cacheDirectory).filter((f) =>
		f.endsWith(".json"),
	)) {
		try {
			const state = readJson(join(context.cacheDirectory, file));
			validateReport(state.report);
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
	const report = structuredClone(state.report);
	for (const file of Object.values(report.files))
		file.mutants = file.mutants.filter(
			(m) =>
				!["RuntimeError", "CompileError", "Ignored", "Pending"].includes(
					m.status,
				) && !(m.static && state.inputDigest !== context.inputDigest),
		);
	report.projectRoot = resolve(context.root, context.workspace);
	return { ...state, report };
}
