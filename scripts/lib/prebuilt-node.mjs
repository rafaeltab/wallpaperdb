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
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
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
	".prebuilt-tests",
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

function runtimeOptions(input, configurations) {
	const file = ts.findConfigFile(dirname(input), existsSync);
	if (!file) return {};
	if (!configurations.has(file)) {
		const raw = ts.readConfigFile(file, ts.sys.readFile);
		if (raw.error)
			throw new Error(
				ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"),
			);
		const parsed = ts.parseJsonConfigFileContent(
			raw.config,
			{ ...ts.sys, readDirectory: () => [] },
			dirname(file),
		);
		const errors = parsed.errors.filter((error) => error.code !== 18003);
		if (errors.length)
			throw new Error(
				errors
					.map((error) =>
						ts.flattenDiagnosticMessageText(error.messageText, "\n"),
					)
					.join("\n"),
			);
		const keys = [
			"target",
			"jsx",
			"jsxFactory",
			"jsxFragmentFactory",
			"jsxImportSource",
			"experimentalDecorators",
			"emitDecoratorMetadata",
			"esModuleInterop",
			"useDefineForClassFields",
			"verbatimModuleSyntax",
		];
		configurations.set(
			file,
			Object.fromEntries(
				keys
					.filter((key) => parsed.options[key] !== undefined)
					.map((key) => [key, parsed.options[key]]),
			),
		);
	}
	return configurations.get(file);
}

function emit(input, output, compilerOptions) {
	const manifest = ts.findConfigFile(
		dirname(input),
		existsSync,
		"package.json",
	);
	const esm =
		input.endsWith(".mts") ||
		(!input.endsWith(".cts") &&
			manifest &&
			JSON.parse(readFileSync(manifest, "utf8")).type === "module");
	const result = ts.transpileModule(readFileSync(input, "utf8"), {
		fileName: input,
		reportDiagnostics: true,
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: esm ? ts.ModuleKind.ES2022 : ts.ModuleKind.CommonJS,
			sourceMap: true,
			inlineSources: true,
			sourceRoot: dirname(input),
			esModuleInterop: true,
			jsx: ts.JsxEmit.ReactJSX,
			...compilerOptions,
			rewriteRelativeImportExtensions: true,
		},
		transformers: {
			before: [
				(context) => {
					const visit = (node) => {
						if (
							esm &&
							ts.isImportDeclaration(node) &&
							ts.isStringLiteral(node.moduleSpecifier) &&
							node.moduleSpecifier.text.endsWith(".json") &&
							!node.attributes
						) {
							return context.factory.updateImportDeclaration(
								node,
								node.modifiers,
								node.importClause,
								node.moduleSpecifier,
								context.factory.createImportAttributes([
									context.factory.createImportAttribute(
										context.factory.createIdentifier("type"),
										context.factory.createStringLiteral("json"),
									),
								]),
							);
						}
						return ts.visitEachChild(node, visit, context);
					};
					return (source) => ts.visitNode(source, visit);
				},
			],
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
export function stageNodeTree({
	root,
	artifacts,
	aliases = {},
	fixtureScripts = {},
}) {
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
	const configurations = new Map();
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
			emit(input, output, runtimeOptions(input, configurations));
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
			if (fixtureScripts[dirname(name)])
				Object.assign(manifest.scripts, fixtureScripts[dirname(name)]);
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
		copyFileSync(join(tree, `${source}.map`), join(tree, `${alias}.map`));
	}
	const aliasInventory = Object.entries(aliases).map(([alias, source]) => {
		const original = inventory.find(
			(entry) => entry.emitted === join(tree, source),
		);
		if (!original) throw new Error(`Alias has no compiled source: ${source}`);
		const emitted = join(tree, alias);
		return {
			...original,
			emitted,
			emittedHash: digest(emitted),
			mapHash: digest(`${emitted}.map`),
		};
	});
	writeFileSync(
		join(directory, "inventory.json"),
		`${JSON.stringify(inventory, null, 2)}\n`,
	);
	const inputs = files.map((name) => ({
		file: join(root, name),
		hash: digest(join(root, name)),
	}));
	return { directory, root, tree, inventory, aliasInventory, inputs };
}

/** Reject changed emissions and conflicting Node map caches before accepting a run. */
export function auditNodeCoverage(
	stage,
	reports,
	covered = stage.inventory,
	built = [],
) {
	for (const input of stage.inputs) {
		if (digest(input.file) !== input.hash)
			throw new Error(`Changed input: ${input.file}`);
	}
	const sources = new Set(covered.map((entry) => entry.source));
	const byEmitted = new Map(
		[
			...covered,
			...stage.aliasInventory.filter((entry) => sources.has(entry.source)),
		].map((entry) => [entry.emitted, entry]),
	);
	for (const entry of [...stage.inventory, ...stage.aliasInventory]) {
		if (digest(entry.emitted) !== entry.emittedHash)
			throw new Error(`Changed emitted file: ${entry.emitted}`);
		if (digest(`${entry.emitted}.map`) !== entry.mapHash)
			throw new Error(`Changed source map: ${entry.emitted}`);
		if (digest(entry.source) !== entry.sourceHash)
			throw new Error(`Changed source input: ${entry.source}`);
		const map = JSON.parse(readFileSync(`${entry.emitted}.map`, "utf8"));
		if (
			map.sourcesContent.length !== 1 ||
			map.sourcesContent[0] !== readFileSync(entry.source, "utf8")
		)
			throw new Error(
				`Source map does not preserve original content: ${entry.source}`,
			);
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
			if (
				!byEmitted.has(file) &&
				!built.some((pattern) => matchesGlob(file, join(stage.tree, pattern)))
			)
				continue;
			if (url.search || url.hash)
				throw new Error(`Transformed module URL: ${script.url}`);
			const cached = raw["source-map-cache"]?.[script.url]?.data;
			const disk = JSON.parse(readFileSync(`${file}.map`, "utf8"));
			const originalPaths = (map) =>
				map.sources.map((source) =>
					source.startsWith("file:")
						? fileURLToPath(source)
						: resolve(dirname(file), map.sourceRoot ?? "", source),
				);
			if (
				!cached ||
				cached.mappings !== disk.mappings ||
				JSON.stringify(originalPaths(cached)) !==
					JSON.stringify(originalPaths(disk)) ||
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

/** Node collects native profiles; stock c8 owns source-map conversion and reports. */
export function nativeStdio(stdio = "inherit") {
	const descriptors =
		stdio === "inherit"
			? ["inherit", "inherit", "inherit"]
			: ["ignore", "pipe", "pipe"];
	const lease = Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
	if (Number.isSafeInteger(lease) && lease >= 3) {
		while (descriptors.length <= lease) descriptors.push("ignore");
		descriptors[lease] = lease;
	}
	return descriptors;
}

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
	const descriptors = nativeStdio(stdio);
	const raw = join(reports, "raw");
	mkdirSync(raw, { recursive: true });
	const execution = spawnSync(process.execPath, args, {
		cwd,
		stdio: descriptors,
		encoding: "utf8",
		env: {
			...process.env,
			NODE_V8_COVERAGE: raw,
			NODE_DISABLE_COMPILE_CACHE: "1",
		},
	});
	if (execution.error) throw execution.error;
	const report = spawnSync(
		process.execPath,
		[require.resolve("c8/bin/c8.js"), "--config", config, "report"],
		{
			cwd,
			stdio: descriptors,
			encoding: "utf8",
			env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" },
		},
	);
	if (report.error) throw report.error;
	return {
		...execution,
		status:
			execution.status === 0 ? (report.status ?? 1) : (execution.status ?? 1),
	};
}
