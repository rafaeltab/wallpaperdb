import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const digest = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

const generatedDirectories = new Set([
	".git",
	"node_modules",
	".turbo",
	".next",
	".vite",
	".stryker-tmp",
	"coverage",
	"reports",
	"test-results",
	"playwright-report",
	".mise",
]);

export function emittedName(name) {
	return name.replace(/\.(tsx?|mts|cts)$/, (extension) =>
		extension === ".mts" ? ".mjs" : extension === ".cts" ? ".cjs" : ".js",
	);
}

function sourceFiles(root, directory = root) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (generatedDirectories.has(entry.name)) return [];
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(root, path)
			: [relative(root, path)];
	});
}

function emit(input, output) {
	const result = ts.transpileModule(readFileSync(input, "utf8"), {
		fileName: input,
		reportDiagnostics: true,
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: input.endsWith(".cts")
				? ts.ModuleKind.CommonJS
				: ts.ModuleKind.ES2022,
			sourceMap: true,
			inlineSources: true,
			sourceRoot: dirname(input),
			experimentalDecorators: true,
			emitDecoratorMetadata: true,
			esModuleInterop: true,
			jsx: ts.JsxEmit.ReactJSX,
			rewriteRelativeImportExtensions: true,
		},
	});
	const errors = result.diagnostics.filter(
		(item) => item.category === ts.DiagnosticCategory.Error,
	);
	if (errors.length)
		throw new Error(
			ts.formatDiagnosticsWithColorAndContext(errors, {
				getCanonicalFileName: (name) => name,
				getCurrentDirectory: () => dirname(input),
				getNewLine: () => "\n",
			}),
		);
	writeFileSync(output, result.outputText);
	writeFileSync(`${output}.map`, result.sourceMapText);
}

function runtimePaths(value) {
	if (typeof value === "string") return emittedName(value);
	if (Array.isArray(value)) return value.map(runtimePaths);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, runtimePaths(item)]),
		);
	}
	return value;
}

function linkModules(input, output, workspaces) {
	if (!existsSync(input)) return;
	for (const entry of readdirSync(input, { withFileTypes: true })) {
		if (entry.name.startsWith(".") && entry.name !== ".bin") continue;
		const source = join(input, entry.name);
		const target = join(output, entry.name);
		if (entry.name.startsWith("@")) {
			linkModules(source, target, workspaces);
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		const actual = realpathSync(source);
		symlinkSync(workspaces.get(actual) ?? actual, target, "dir");
	}
}

/** Compile a fresh native Node tree, retaining TypeScript inputs for real builds. */
export function stageNodeTree({ root, artifacts, aliases = {} }) {
	root = resolve(root);
	mkdirSync(artifacts, { recursive: true });
	const directory = mkdtempSync(join(artifacts, "run-"));
	const tree = join(directory, "tree");
	const files = sourceFiles(root);
	const outputs = new Set();
	for (const name of files) {
		const output = /\.d\.(?:ts|mts|cts)$/.test(name) ? name : emittedName(name);
		if (outputs.has(output)) throw new Error(`Conflicting output: ${output}`);
		outputs.add(output);
	}
	const workspaces = new Map();
	for (const name of files.filter((file) => file.endsWith("package.json"))) {
		const path = dirname(join(root, name));
		workspaces.set(realpathSync(path), dirname(join(tree, name)));
	}
	const inventory = [];
	for (const name of files) {
		const input = join(root, name);
		const output = join(
			tree,
			/\.d\.(?:ts|mts|cts)$/.test(name) ? name : emittedName(name),
		);
		mkdirSync(dirname(output), { recursive: true });
		if (
			/\.(?:ts|tsx|mts|cts)$/.test(name) &&
			!/\.d\.(?:ts|mts|cts)$/.test(name)
		) {
			emit(input, output);
			symlinkSync(input, join(tree, name));
			inventory.push({
				source: input,
				emitted: output,
				sourceHash: digest(input),
				emittedHash: digest(output),
				mapHash: digest(`${output}.map`),
			});
		} else if (name.endsWith("package.json")) {
			const manifest = JSON.parse(readFileSync(input, "utf8"));
			for (const field of ["main", "module", "exports", "imports"]) {
				if (manifest[field]) manifest[field] = runtimePaths(manifest[field]);
			}
			writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
		} else copyFileSync(input, output);
	}
	for (const [input, output] of workspaces)
		linkModules(
			join(input, "node_modules"),
			join(output, "node_modules"),
			workspaces,
		);
	for (const [alias, source] of Object.entries(aliases)) {
		copyFileSync(join(tree, source), join(tree, alias));
	}
	writeFileSync(
		join(directory, "inventory.json"),
		`${JSON.stringify(inventory, null, 2)}\n`,
	);
	return { directory, root, tree, inventory };
}

/** Reject changed emissions and conflicting Node map caches before accepting a run. */
export function auditNodeCoverage(stage, reports) {
	const byEmitted = new Map(
		stage.inventory.map((entry) => [entry.emitted, entry]),
	);
	for (const entry of stage.inventory) {
		if (digest(entry.emitted) !== entry.emittedHash)
			throw new Error(`Changed emitted file: ${entry.emitted}`);
		if (digest(`${entry.emitted}.map`) !== entry.mapHash)
			throw new Error(`Changed source map: ${entry.emitted}`);
		if (digest(entry.source) !== entry.sourceHash)
			throw new Error(`Changed source input: ${entry.source}`);
	}
	let occurrences = 0;
	for (const name of readdirSync(join(reports, "raw"))) {
		const raw = JSON.parse(readFileSync(join(reports, "raw", name), "utf8"));
		for (const script of raw.result ?? []) {
			if (!script.url.startsWith("file:")) continue;
			const url = new URL(script.url);
			const file = fileURLToPath(url);
			if (
				file.startsWith(`${stage.root}/`) &&
				/\.(?:ts|mts|cts|tsx)$/.test(file)
			) {
				throw new Error(
					`Original TypeScript executed outside emitted tree: ${script.url}`,
				);
			}
			if (!byEmitted.has(file)) continue;
			if (url.search || url.hash)
				throw new Error(`Transformed module URL: ${script.url}`);
			const cached = raw["source-map-cache"]?.[script.url]?.data;
			const disk = JSON.parse(readFileSync(`${file}.map`, "utf8"));
			if (
				!cached ||
				cached.mappings !== disk.mappings ||
				JSON.stringify(cached.sourcesContent) !==
					JSON.stringify(disk.sourcesContent)
			) {
				throw new Error(`Conflicting collected source map: ${script.url}`);
			}
			const extent = Math.max(
				...script.functions.flatMap((fn) =>
					fn.ranges.map((range) => range.endOffset),
				),
			);
			if (extent !== readFileSync(file, "utf8").length)
				throw new Error(`Conflicting collected extent: ${script.url}`);
			occurrences++;
		}
	}
	return { occurrences };
}

/** Stock c8 owns native process collection and all source-map conversion. */
export function collectNodeCoverage({
	cwd,
	args,
	reports,
	coverage,
	stdio = "pipe",
}) {
	mkdirSync(reports, { recursive: true });
	const config = join(reports, "c8.json");
	writeFileSync(
		config,
		JSON.stringify({
			all: true,
			extension: [".js", ".mjs", ".cjs"],
			"exclude-after-remap": false,
			reporter: ["json", "html", "lcov", "json-summary"],
			...coverage,
			"reports-dir": reports,
			"temp-directory": join(reports, "raw"),
		}),
	);
	const descriptors =
		stdio === "inherit"
			? ["inherit", "inherit", "inherit"]
			: ["ignore", "pipe", "pipe"];
	const lease = Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
	if (Number.isSafeInteger(lease) && lease >= 3) {
		while (descriptors.length <= lease) descriptors.push("ignore");
		descriptors[lease] = lease;
	}
	return spawnSync(
		process.execPath,
		[
			require.resolve("c8/bin/c8.js"),
			"--config",
			config,
			process.execPath,
			...args,
		],
		{
			cwd,
			stdio: descriptors,
			encoding: "utf8",
			env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" },
		},
	);
}
