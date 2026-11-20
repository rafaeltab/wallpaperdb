import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { copyBuiltArtifacts } from "@wallpaperdb/coverage-runtime";

const root = process.env.WALLPAPERDB_COVERAGE_REPO_ROOT || process.cwd(),
	out = resolve(root, ".coverage-runtime/build");
process.chdir(root);
const sourceHashes: Record<string, string> = {};
const sourceHash = (bytes: string | Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const processEntries = new Set([
	"apps/color-extractor/src/adapters/image/decoder.ts",
	"apps/variant-generator/src/adapters/image/encoder.ts",
]);
const outputExtension = (source: string) =>
	source.endsWith(".mts") || processEntries.has(source) ? ".mjs" : ".js";
await rm(out, { recursive: true, force: true });
const workspaces = [
	".",
	"infra",
	"scripts",
	...(
		await Promise.all(
			["apps", "packages", "experiments"].map(async (parent) =>
				existsSync(parent)
					? (
							await readdir(parent)
						)
							.filter((name) => existsSync(join(parent, name, "package.json")))
							.map((name) => `${parent}/${name}`)
					: [],
			),
		)
	).flat(),
];
const owned = new Map();
for (const w of workspaces) {
	try {
		const p = JSON.parse(await readFile(join(w, "package.json"), "utf8"));
		owned.set(p.name, w);
	} catch {}
}
// The receipt CLI deliberately supplies a clean environment. Coverage must
// still reach the official V8 descendant collector, without restoring dotenv
// or transformation options that its environment intentionally omits.
const workerEntry = (value: string) =>
	ts.factory.createConditionalExpression(
		ts.factory.createCallExpression(
			ts.factory.createPropertyAccessExpression(
				ts.factory.createPropertyAccessExpression(
					ts.factory.createMetaProperty(
						ts.SyntaxKind.ImportKeyword,
						ts.factory.createIdentifier("meta"),
					),
					"url",
				),
				"endsWith",
			),
			undefined,
			[ts.factory.createStringLiteral(".mjs")],
		),
		undefined,
		ts.factory.createStringLiteral(value),
		undefined,
		ts.factory.createStringLiteral(value.replace(".mjs", ".js")),
	);
const isResolvedTsx = (n: ts.Node) =>
	ts.isCallExpression(n) &&
	n.arguments.length === 1 &&
	ts.isStringLiteral(n.arguments[0]) &&
	n.arguments[0].text === "node_modules/tsx/dist/loader.mjs";
const isTsx = (n: ts.Node) =>
	(ts.isStringLiteral(n) && n.text === "tsx") || isResolvedTsx(n);
async function compile(dir: string, only?: Set<string>): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (only && !only.has(entry.name)) continue;
		if (
			[
				"node_modules",
				"dist",
				"coverage",
				".git",
				".turbo",
				".coverage-runtime",
			].includes(entry.name)
		)
			continue;
		const src = join(dir, entry.name),
			dest = join(out, relative(root, resolve(src)));
		if (entry.isDirectory()) {
			await compile(src);
			continue;
		}
		if (/\.d\.(?:ts|mts)$/.test(src)) continue;
		await mkdir(dirname(dest), { recursive: true });
		if (/\.(?:mts|tsx?)$/.test(src)) {
			const containerFixture =
				src ===
				"apps/ingestor/test/instrumentation/telemetry-availability.integration.test.ts";
			const protocolFixture =
				src === "apps/factory/test/protocol-fixture.integration.test.ts";
			const cleanCli = [
				"apps/asset/test/source-confirmation.integration.test.ts",
				"apps/asset/test/result-notification.integration.test.ts",
				"apps/gateway/test/search/server.integration.test.ts",
			].includes(src);
			const source = await readFile(src, "utf8");
			sourceHashes[resolve(src)] = sourceHash(source);
			const result = ts.transpileModule(source, {
				fileName: resolve(src),
				compilerOptions: {
					target: ts.ScriptTarget.ES2024,
					module: ts.ModuleKind.ESNext,
					jsx: ts.JsxEmit.ReactJSX,
					sourceMap: !src.includes("/test/"),
					inlineSources: !src.includes("/test/"),
					experimentalDecorators: true,
					emitDecoratorMetadata: true,
					rewriteRelativeImportExtensions: true,
				},
				transformers: {
					before: [
						(context) => (source) =>
							ts.visitEachChild(
								source,
								function visit(node: ts.Node): ts.Node {
									if (
										protocolFixture &&
										ts.isStringLiteral(node) &&
										node.text === "src/platform/durable.ts"
									)
										return ts.factory.createStringLiteral(
											"src/platform/durable.js",
										);
									if (
										protocolFixture &&
										ts.isExpressionStatement(node) &&
										ts.isCallExpression(node.expression) &&
										ts.isPropertyAccessExpression(node.expression.expression) &&
										node.expression.expression.name.text === "toContain" &&
										node.expression.arguments[0]?.getText(source) ===
											"resolve('src/platform/durable.ts')"
									)
										return ts.factory.createBlock(
											[
												ts.visitEachChild(node, visit, context),
												ts.factory.createExpressionStatement(
													ts.factory.createAwaitExpression(
														ts.factory.createCallExpression(
															ts.factory.createIdentifier(
																"__verifyProtocolCoverage",
															),
															undefined,
															[
																ts.factory.createIdentifier("collector"),
																ts.factory.createCallExpression(
																	ts.factory.createIdentifier("resolve"),
																	undefined,
																	[
																		ts.factory.createStringLiteral(
																			"src/platform/durable.js",
																		),
																	],
																),
																ts.factory.createStringLiteral(
																	resolve(
																		"apps/factory/src/platform/durable.ts",
																	),
																),
															],
														),
													),
												),
											],
											true,
										);
									if (
										containerFixture &&
										ts.isCallExpression(node) &&
										ts.isPropertyAccessExpression(node.expression) &&
										node.expression.name.text === "withBindMounts"
									)
										return ts.factory.createCallExpression(
											ts.factory.createIdentifier("__coverageContainer"),
											undefined,
											[
												ts.visitNode(
													node.expression.expression,
													visit,
													ts.isExpression,
												),
											],
										);
									if (
										containerFixture &&
										ts.isStringLiteral(node) &&
										node.text.includes(
											"node --import tsx test/fixtures/telemetry-outage.ts",
										)
									)
										return ts.factory.createBinaryExpression(
											ts.factory.createStringLiteral(
												node.text
													.replace(
														"node --import tsx test/fixtures/telemetry-outage.ts",
														"node test/fixtures/telemetry-outage.js",
													)
													.split("result=$?;")[0],
											),
											ts.SyntaxKind.PlusToken,
											ts.factory.createIdentifier("__coverageExit"),
										);
									// This contract exercises the development image's TS watch command
									// against a disposable edited source copy, not compiled application execution.
									if (
										src ===
											"apps/wallpaper/test/development-watch.integration.test.ts" &&
										ts.isCallExpression(node) &&
										ts.isIdentifier(node.expression) &&
										node.arguments.length &&
										ts.isStringLiteral(node.arguments[0])
									) {
										const name = node.expression.text,
											value = node.arguments[0].text;
										const original =
											name === "cp" && ["src", "package.json"].includes(value)
												? resolve("apps/wallpaper", value)
												: name === "resolve" && value === "node_modules"
													? resolve("apps/wallpaper/node_modules")
													: name === "resolve" && value === "../../node_modules"
														? resolve("node_modules")
														: undefined;
										if (original)
											return ts.factory.updateCallExpression(
												node,
												node.expression,
												node.typeArguments,
												[
													ts.factory.createStringLiteral(original),
													...node.arguments.slice(1),
												],
											);
									}

									if (
										cleanCli &&
										ts.isPropertyAssignment(node) &&
										ts.isIdentifier(node.name) &&
										node.name.text === "env"
									)
										return ts.factory.updatePropertyAssignment(
											node,
											node.name,
											ts.factory.createCallExpression(
												ts.factory.createIdentifier("__coverageEnv"),
												undefined,
												[node.initializer],
											),
										);

									if (
										ts.isStringLiteral(node) &&
										src === "apps/user/test/helpers/asset-fixture.ts" &&
										node.text === "../../../../"
									)
										return ts.factory.createStringLiteral(
											"../../../../apps/asset/",
										);
									if (
										ts.isStringLiteral(node) &&
										src.endsWith("esbuild.config.ts") &&
										node.text.startsWith("src/") &&
										node.text.endsWith(".ts")
									)
										return ts.factory.createStringLiteral(
											node.text.slice(0, -3) +
												outputExtension(join(dirname(src), node.text)),
										);
									if (
										ts.isStringLiteral(node) &&
										node.text.startsWith("../../../scripts/") &&
										node.text.endsWith(".ts")
									)
										return ts.factory.createStringLiteral(
											node.text.slice(0, -3) + ".js",
										);
									if (
										ts.isStringLiteral(node) &&
										node.text.startsWith(".") &&
										!/\.[a-z]+$/i.test(node.text)
									) {
										const parent = node.parent;
										const moduleRef =
											parent &&
											(ts.isImportDeclaration(parent) ||
												ts.isExportDeclaration(parent) ||
												(ts.isCallExpression(parent) &&
													(parent.expression.kind ===
														ts.SyntaxKind.ImportKeyword ||
														(ts.isPropertyAccessExpression(parent.expression) &&
															[
																"mock",
																"doMock",
																"unmock",
																"doUnmock",
																"importActual",
																"importMock",
															].includes(parent.expression.name.text)))));
										if (moduleRef) {
											const base = resolve(dirname(src), node.text);
											const suffix =
												existsSync(base + ".ts") || existsSync(base + ".tsx")
													? ".js"
													: existsSync(join(base, "index.ts"))
														? "/index.js"
														: null;
											if (suffix)
												return ts.factory.createStringLiteral(
													node.text + suffix,
												);
										}
									}
									if (
										ts.isCallExpression(node) &&
										ts.isIdentifier(node.expression) &&
										node.expression.text === "spawn" &&
										ts.isStringLiteral(node.arguments[0]) &&
										node.arguments[0].text === "make" &&
										ts.isArrayLiteralExpression(node.arguments[1]) &&
										node.arguments[1].elements.some(
											(e) =>
												ts.isStringLiteral(e) &&
												e.text === "SCRIPT=test:attachment-fixture",
										)
									)
										return ts.factory.updateCallExpression(
											node,
											node.expression,
											node.typeArguments,
											[
												ts.factory.createPropertyAccessExpression(
													ts.factory.createIdentifier("process"),
													"execPath",
												),
												ts.factory.createArrayLiteralExpression([
													ts.factory.createStringLiteral(
														"test/fixtures/attachment-server.js",
													),
												]),
												...node.arguments
													.slice(2)
													.map((e) => ts.visitNode(e, visit, ts.isExpression)),
											],
										);
									if (
										ts.isStringLiteral(node) &&
										[
											"./inspect-worker.mjs",
											"./broker-worker.mjs",
											"./resize-worker.mjs",
										].includes(node.text)
									)
										return workerEntry(node.text);
									if (
										ts.isStringLiteral(node) &&
										node.text === "scripts/operator.ts"
									)
										return ts.factory.createStringLiteral(
											"scripts/operator.js",
										);
									if (
										ts.isStringLiteral(node) &&
										node.text === "./picture-encoder.mjs"
									)
										return ts.factory.createConditionalExpression(
											ts.factory.createCallExpression(
												ts.factory.createPropertyAccessExpression(
													ts.factory.createPropertyAccessExpression(
														ts.factory.createMetaProperty(
															ts.SyntaxKind.ImportKeyword,
															ts.factory.createIdentifier("meta"),
														),
														"url",
													),
													"endsWith",
												),
												undefined,
												[ts.factory.createStringLiteral(".mjs")],
											),
											undefined,
											ts.factory.createStringLiteral("./picture-encoder.mjs"),
											undefined,
											ts.factory.createStringLiteral("./encoder.js"),
										);
									if (
										ts.isStringLiteral(node) &&
										node.text.startsWith("test/fixtures/") &&
										node.text.endsWith(".ts")
									)
										return ts.factory.createStringLiteral(
											node.text.slice(0, -3) + ".js",
										);
									if (
										ts.isArrayLiteralExpression(node) &&
										node.elements.some((e) => isTsx(e))
									)
										return ts.factory.updateArrayLiteralExpression(
											node,
											node.elements
												.filter(
													(e) =>
														!isResolvedTsx(e) &&
														(!ts.isStringLiteral(e) ||
															!["--import", "tsx"].includes(e.text)),
												)
												.map((e) => ts.visitNode(e, visit, ts.isExpression)),
										);
									if (
										ts.isImportDeclaration(node) &&
										ts.isStringLiteral(node.moduleSpecifier) &&
										node.moduleSpecifier.text.endsWith(".json") &&
										!node.attributes
									)
										return ts.factory.updateImportDeclaration(
											node,
											node.modifiers,
											node.importClause,
											node.moduleSpecifier,
											ts.factory.createImportAttributes(
												ts.factory.createNodeArray([
													ts.factory.createImportAttribute(
														ts.factory.createIdentifier("type"),
														ts.factory.createStringLiteral("json"),
													),
												]),
											),
										);
									return ts.visitEachChild(node, visit, context);
								},
								context,
							),
					],
				},
			});
			const map = result.sourceMapText
				? JSON.parse(result.sourceMapText)
				: null;
			if (map) map.sources = [resolve(src)];
			if (map) map.sourceRoot = "";
			// These entries are launched as .mjs by the real process adapter and
			// observed by the ownership tests. Keep that public launch contract.
			await writeFile(
				dest.replace(/\.(?:mts|tsx?)$/, outputExtension(src)),
				(cleanCli
					? `import {coverageEnvironment as __coverageEnv} from ${JSON.stringify(pathToFileURL(resolve("packages/coverage-runtime/dist/coverage-env.mjs")).href)};\n`
					: "") +
					(containerFixture
						? `import {containerExecution as __coverageContainer, coverageExit as __coverageExit} from ${JSON.stringify(pathToFileURL(resolve("packages/coverage-runtime/dist/container-execution.mjs")).href)};\n`
						: "") +
					(protocolFixture
						? `import {verifyProtocolCoverage as __verifyProtocolCoverage} from ${JSON.stringify(pathToFileURL(resolve("scripts/dist/coverage-protocol.mjs")).href)};\n`
						: "") +
					result.outputText,
			);
			if (map)
				await writeFile(
					dest.replace(
						/\.(?:mts|tsx?)$/,
						src.endsWith(".mts") ? ".mjs.map" : ".js.map",
					),
					JSON.stringify(map),
				);
		} else if (entry.name === "package.json") {
			const p = JSON.parse(await readFile(src, "utf8"));
			for (const key of ["exports", "main", "module", "imports"])
				if (p[key])
					p[key] = JSON.parse(JSON.stringify(p[key]).replace(/\.ts"/g, '.js"'));
			await writeFile(dest, JSON.stringify(p, null, 2));
		} else {
			await cp(src, dest);
			if (/\.(?:[cm]?js|jsx)$/.test(src))
				sourceHashes[resolve(src)] = sourceHash(await readFile(dest));
		}
	}
}
for (const w of owned.values()) {
	if (w !== "." && w !== "scripts") {
		await compile(w);
		await copyBuiltArtifacts(join(w, "dist"), join(out, w, "dist")).catch(
			(e) => {
				if (e.code !== "ENOENT") throw e;
			},
		);
	}
	const target = join(out, w, "node_modules");
	await mkdir(target, { recursive: true });
	async function linkDir(from: string, to: string): Promise<void> {
		for (const ent of await readdir(from, { withFileTypes: true })) {
			if (ent.name.startsWith(".")) continue;
			const orig = join(from, ent.name),
				dest = join(to, ent.name);
			if (ent.name.startsWith("@")) {
				await mkdir(dest, { recursive: true });
				await linkDir(orig, dest);
				continue;
			}
			const manifest = await readFile(join(orig, "package.json"), "utf8")
				.then(JSON.parse)
				.catch(() => null);
			const local = owned.get(manifest?.name);
			await symlink(
				local === undefined ? await realpath(orig) : join(out, local),
				dest,
			).catch((e) => {
				if (e.code !== "EEXIST") throw e;
			});
		}
	}
	await linkDir(join(root, w, "node_modules"), target).catch((e) => {
		if (e.code !== "ENOENT") throw e;
	});
}
console.log("Compiled mirror:", out);
// Deployment contracts invoke the real build task from their repository root.
// Keep that task, then synchronize its output into the mirror they launch.
await writeFile(
	join(out, "Makefile"),
	`.PHONY: build\nbuild:\n\t$(MAKE) -C ${JSON.stringify(root)} build PACKAGE="$(PACKAGE)"\n\t${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, "scripts/dist/coverage-sync-built.mjs"))} "$(PACKAGE)"\n`,
);

await compile("scripts", new Set(["operator-inbox.ts", "coverage-summary.ts"]));
// Immutable inputs read by the actual Compose deployment contract test. The TS
// inbox is copied as container input data; host application execution uses JS.
for (const fixture of [
	".gitignore",
	".dockerignore",
	"infra/docker-compose.yml",
	"scripts/operator-inbox.ts",
]) {
	await mkdir(dirname(join(out, fixture)), { recursive: true });
	await cp(fixture, join(out, fixture));
}

await writeFile(join(out, "source-hashes.json"), JSON.stringify(sourceHashes));
