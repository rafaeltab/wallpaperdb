import { pathToFileURL } from "node:url";
import ts from "typescript";
import { existsSync } from "node:fs";
import {
	readdir,
	readFile,
	writeFile,
	mkdir,
	symlink,
	realpath,
	cp,
	rm,
} from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
const root = process.cwd(),
	out = resolve(".coverage-experiment/build");
await rm(out, { recursive: true, force: true });
const workspaces = [
	".",
	"apps/user",
	"apps/asset",
	"apps/wallpaper",
	...(await Promise.all(
		["packages"].map(async (dir) =>
			(await readdir(dir)).map((n) => `${dir}/${n}`),
		),
	).then((x) => x.flat())),
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
const workerEntry = (value) =>
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
const isResolvedTsx = (n) =>
	ts.isCallExpression(n) &&
	n.arguments.length === 1 &&
	ts.isStringLiteral(n.arguments[0]) &&
	n.arguments[0].text === "node_modules/tsx/dist/loader.mjs";
const isTsx = (n) =>
	(ts.isStringLiteral(n) && n.text === "tsx") || isResolvedTsx(n);
async function compile(dir, only) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (only && !only.has(entry.name)) continue;
		if (
			[
				"node_modules",
				"dist",
				"coverage",
				".git",
				".turbo",
				".coverage-experiment",
			].includes(entry.name)
		)
			continue;
		const src = join(dir, entry.name),
			dest = join(out, relative(root, resolve(src)));
		if (entry.isDirectory()) {
			await compile(src);
			continue;
		}
		if (src.endsWith(".d.ts")) continue;
		await mkdir(dirname(dest), { recursive: true });
		if (src.endsWith(".ts")) {
			const cleanCli = [
				"apps/asset/test/source-confirmation.integration.test.ts",
				"apps/asset/test/result-notification.integration.test.ts",
			].includes(src);
			const result = ts.transpileModule(await readFile(src, "utf8"), {
				fileName: resolve(src),
				compilerOptions: {
					target: ts.ScriptTarget.ESNext,
					module: ts.ModuleKind.ESNext,
					sourceMap: !src.includes("/test/"),
					inlineSources: !src.includes("/test/"),
					experimentalDecorators: true,
					emitDecoratorMetadata: true,
					rewriteRelativeImportExtensions: true,
				},
				transformers: {
					before: [
						(context) => (source) =>
							ts.visitNode(source, function visit(node) {
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
									node.name.text === "env" &&
									ts.isObjectLiteralExpression(node.initializer) &&
									node.initializer.properties.some(
										(p) =>
											ts.isPropertyAssignment(p) &&
											p.name.getText() === "DATABASE_URL",
									)
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
									src ===
										"scripts/coverage-experiment/fixtures/method-controls.ts" &&
									node.text ===
										"../../../apps/user/node_modules/effect/dist/index.js"
								)
									return ts.factory.createStringLiteral("effect");
								if (
									ts.isStringLiteral(node) &&
									src ===
										"scripts/coverage-experiment/fixtures/qualification.fixture.ts" &&
									node.text === "./method-controls.js"
								)
									return ts.factory.createStringLiteral(
										"../../../apps/user/src/coverage-experiment-methods.js",
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
										node.text.slice(0, -3) + ".js",
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
										const suffix = existsSync(base + ".ts")
											? ".js"
											: existsSync(join(base, "index.ts"))
												? "/index.js"
												: null;
										if (suffix)
											return ts.factory.createStringLiteral(node.text + suffix);
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
												.map((e) => ts.visitNode(e, visit)),
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
									return ts.factory.createStringLiteral("scripts/operator.js");
								if (ts.isStringLiteral(node) && node.text === "./child-only.js")
									return ts.factory.createStringLiteral(
										"../../../apps/user/src/coverage-experiment-control.js",
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
											.map((e) => ts.visitNode(e, visit)),
									);
								if (
									ts.isImportDeclaration(node) &&
									node.moduleSpecifier.text.endsWith(".json") &&
									!node.attributes
								)
									return ts.factory.updateImportDeclaration(
										node,
										node.modifiers,
										node.importClause,
										node.moduleSpecifier,
										ts.factory.createImportAttributes([
											ts.factory.createImportAttribute(
												ts.factory.createIdentifier("type"),
												ts.factory.createStringLiteral("json"),
											),
										]),
									);
								return ts.visitEachChild(node, visit, context);
							}),
					],
				},
			});
			const map = result.sourceMapText
				? JSON.parse(result.sourceMapText)
				: null;
			if (map) map.sources = [resolve(src)];
			if (map) map.sourceRoot = "";
			await writeFile(
				dest.slice(0, -3) + ".js",
				(cleanCli
					? `import {coverageEnvironment as __coverageEnv} from ${JSON.stringify(pathToFileURL(resolve("scripts/coverage-experiment/coverage-env.mjs")).href)};\n`
					: "") + result.outputText,
			);
			if (map)
				await writeFile(dest.slice(0, -3) + ".js.map", JSON.stringify(map));
		} else if (entry.name === "package.json") {
			const p = JSON.parse(await readFile(src, "utf8"));
			for (const key of ["exports", "main", "module", "imports"])
				if (p[key])
					p[key] = JSON.parse(JSON.stringify(p[key]).replace(/\.ts"/g, '.js"'));
			await writeFile(dest, JSON.stringify(p, null, 2));
		} else await cp(src, dest);
	}
}
for (const w of owned.values()) {
	if (w !== ".") {
		await compile(w);
		await cp(join(w, "dist"), join(out, w, "dist"), { recursive: true }).catch(
			(e) => {
				if (e.code !== "ENOENT") throw e;
			},
		);
	}
	const target = join(out, w, "node_modules");
	await mkdir(target, { recursive: true });
	async function linkDir(from, to) {
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

await compile("scripts", new Set(["operator-inbox.ts"]));
await compile("scripts/coverage-experiment/fixtures");

await cp(
	join(out, "scripts/coverage-experiment/fixtures/child-only.js"),
	join(out, "apps/user/src/coverage-experiment-control.js"),
);
await cp(
	join(out, "scripts/coverage-experiment/fixtures/child-only.js.map"),
	join(out, "apps/user/src/child-only.js.map"),
);

await cp(
	join(out, "scripts/coverage-experiment/fixtures/method-controls.js"),
	join(out, "apps/user/src/coverage-experiment-methods.js"),
);
await cp(
	join(out, "scripts/coverage-experiment/fixtures/method-controls.js.map"),
	join(out, "apps/user/src/method-controls.js.map"),
);
await mkdir(join(out, "apps/user/test/coverage-experiment"), {
	recursive: true,
});
await cp(
	join(out, "scripts/coverage-experiment/fixtures/cache.js"),
	join(out, "apps/user/test/coverage-experiment/cache.js"),
);
await writeFile(
	join(out, "apps/user/test/coverage-experiment/mock.qualification.js"),
	(
		await readFile(
			join(out, "scripts/coverage-experiment/fixtures/mock.fixture.js"),
			"utf8",
		)
	).replace("../../../apps/user/node_modules/vitest/dist/index.js", "vitest"),
);

await cp(
	"scripts/coverage-experiment/fixtures/native-mock.mjs",
	join(out, "apps/user/test/coverage-experiment/mock.qualification.js"),
);
await writeFile(
	join(out, "apps/user/test/coverage-experiment/dynamic.js"),
	"export const value='actual';\n",
);

await cp(
	"scripts/coverage-experiment/fixtures/native-dynamic-limit.mjs",
	join(
		out,
		"apps/user/test/coverage-experiment/dynamic-limit.qualification.js",
	),
);

await cp(
	join(out, "scripts/coverage-experiment/fixtures/mock-target.js"),
	join(out, "apps/user/src/coverage-experiment-mock-target.js"),
);
await cp(
	join(out, "scripts/coverage-experiment/fixtures/mock-target.js.map"),
	join(out, "apps/user/src/mock-target.js.map"),
);
await cp(
	"scripts/coverage-experiment/fixtures/native-app-mock.mjs",
	join(out, "apps/user/test/coverage-experiment/app-mock.qualification.js"),
);
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

await cp(
	join(out, "scripts/coverage-experiment/fixtures/auto-target.js"),
	join(out, "apps/user/src/coverage-experiment-auto-target.js"),
);
await cp(
	join(out, "scripts/coverage-experiment/fixtures/auto-target.js.map"),
	join(out, "apps/user/src/auto-target.js.map"),
);
for (const kind of ["automock", "autospy"])
	await cp(
		`scripts/coverage-experiment/fixtures/native-${kind}.mjs`,
		join(out, `apps/user/test/coverage-experiment/${kind}.qualification.js`),
	);
