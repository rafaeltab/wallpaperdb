// PROTOTYPE #416. Opt-in only; not part of lint or CI policy.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { backendBoundaries } from "../../lib/architecture-boundaries.mjs";
import { isPublicFeatureEntry } from "../../../apps/web/test/features/feature-architecture.ts";

const roles = new Set([
	"capability",
	"driving-adapter",
	"driven-adapter",
	"composition",
	"frontend-workflow",
	"frontend-integration",
	"frontend-browser",
]);
const infrastructure =
	/^(?:nats(?:\/|$)|ioredis$|@opensearch-project\/|testcontainers$|@wallpaperdb\/(?:test-utils|testcontainers)(?:\/|$)|node:(?:net|http|https|tls|child_process)$)/;

function edges(source) {
	const result = [];
	const mockObjects = new Set(["vi", "jest"]);
	const constantStrings = new Map();
	for (const node of source.statements) {
		if (
			ts.isVariableStatement(node) &&
			node.declarationList.flags & ts.NodeFlags.Const
		) {
			for (const declaration of node.declarationList.declarations) {
				if (
					ts.isIdentifier(declaration.name) &&
					declaration.initializer &&
					ts.isStringLiteralLike(declaration.initializer)
				)
					constantStrings.set(
						declaration.name.text,
						declaration.initializer.text,
					);
			}
		}
		if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== "vitest")
			continue;
		const bindings = node.importClause?.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings))
			mockObjects.add(`${bindings.name.text}.vi`);
		if (bindings && ts.isNamedImports(bindings)) {
			for (const item of bindings.elements) {
				if ((item.propertyName ?? item.name).text === "vi")
					mockObjects.add(item.name.text);
			}
		}
	}
	function add(
		argument,
		node,
		typeOnly = false,
		mock = false,
		partial = false,
	) {
		result.push({
			specifier:
				argument && ts.isStringLiteralLike(argument)
					? argument.text
					: argument && ts.isIdentifier(argument)
						? constantStrings.get(argument.text)
						: undefined,
			node,
			typeOnly,
			mock,
			partial,
		});
	}
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier
		) {
			const clause = ts.isImportDeclaration(node)
				? node.importClause
				: undefined;
			const named = clause?.namedBindings;
			const allTypes =
				named &&
				ts.isNamedImports(named) &&
				named.elements.length > 0 &&
				named.elements.every((e) => e.isTypeOnly) &&
				!clause.name;
			const exportedTypes =
				ts.isExportDeclaration(node) &&
				node.exportClause &&
				ts.isNamedExports(node.exportClause) &&
				node.exportClause.elements.length > 0 &&
				node.exportClause.elements.every((e) => e.isTypeOnly);
			add(
				node.moduleSpecifier,
				node,
				node.isTypeOnly || clause?.isTypeOnly || allTypes || exportedTypes,
			);
		}
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
			add(node.argument.literal, node, true);
		if (ts.isCallExpression(node)) {
			if (
				node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")
			) {
				add(node.arguments[0], node);
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				mockObjects.has(node.expression.expression.getText(source)) &&
				["mock", "doMock", "unstable_mockModule"].includes(
					node.expression.name.text,
				)
			) {
				// A factory taking importOriginal or explicitly spreading actual exports needs review.
				const factory = node.arguments[1];
				const partial =
					factory &&
					(((ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) &&
						factory.parameters.length > 0) ||
						/importActual|requireActual/.test(factory.getText(source)));
				const argument = node.arguments[0];
				add(
					argument &&
						ts.isCallExpression(argument) &&
						argument.expression.kind === ts.SyntaxKind.ImportKeyword
						? argument.arguments[0]
						: argument,
					node,
					false,
					true,
					partial,
				);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return result;
}

export function analyze({ root, workspace, kind, tests }) {
	root = path.resolve(root);
	const started = performance.now();
	const application = path.resolve(root, workspace);
	const src = path.join(application, "src");
	const configFile = ts.findConfigFile(application, ts.sys.fileExists);
	const config = configFile
		? ts.readConfigFile(configFile, ts.sys.readFile).config
		: {};
	const options = ts.parseJsonConfigFileContent(
		config,
		ts.sys,
		application,
	).options;
	const capabilityRoot = path.join(src, "capabilities");
	const quality =
		kind === "backend"
			? JSON.parse(
					fs.readFileSync(
						path.join(application, "quality.config.json"),
						"utf8",
					),
				)
			: {};
	const capabilities = new Set(
		fs.existsSync(capabilityRoot) ? fs.readdirSync(capabilityRoot) : [],
	);
	const boundaries = backendBoundaries(src, quality, capabilities);
	const diagnostics = [];
	const parsed = new Map();
	const resolutions = new Map();
	const featureRoot = path.join(src, "features");
	const inside = (directory, filename) =>
		filename.startsWith(`${directory}${path.sep}`);
	function moduleOwner(filename) {
		if (kind === "backend") return boundaries.publicModule(filename);
		return inside(featureRoot, filename)
			? `features/${path.relative(featureRoot, filename).split(path.sep)[0]}`
			: undefined;
	}
	function resolve(specifier, filename) {
		const key = `${filename}:${specifier}`;
		if (!resolutions.has(key))
			resolutions.set(
				key,
				ts.resolveModuleName(
					specifier,
					filename,
					{ ...options, moduleResolution: ts.ModuleResolutionKind.Bundler },
					ts.sys,
				).resolvedModule?.resolvedFileName,
			);
		return resolutions.get(key);
	}
	for (const entry of tests) {
		if (
			!roles.has(entry.role) ||
			(kind === "frontend") !== entry.role.startsWith("frontend-")
		)
			throw new Error(`Invalid test role: ${entry.role} in ${entry.file}`);
		const subject = path.resolve(application, entry.subject);
		const testFile = path.resolve(application, entry.file);
		if (!fs.existsSync(subject) || !fs.existsSync(testFile))
			throw new Error(
				`Missing test or subject: ${entry.file}, ${entry.subject}`,
			);
		const visited = new Set();
		function visit(filename, trail = [], runtime = true) {
			const key = `${filename}:${runtime}`;
			if (visited.has(key)) return;
			visited.add(key);
			if (!parsed.has(filename)) {
				const source = ts.createSourceFile(
					filename,
					fs.readFileSync(filename, "utf8"),
					ts.ScriptTarget.Latest,
					true,
				);
				parsed.set(filename, { source, imports: edges(source) });
			}
			const { source, imports } = parsed.get(filename);
			for (const edge of imports) {
				const { specifier } = edge;
				const location = source.getLineAndCharacterOfPosition(
					edge.node.getStart(),
				);
				const report = (code, message, severity = "error") =>
					diagnostics.push({
						test: entry.file,
						role: entry.role,
						file: path.relative(root, filename),
						line: location.line + 1,
						column: location.character + 1,
						code,
						severity,
						message,
						trail: [...trail, path.relative(root, filename)],
					});
				if (!specifier) {
					report(
						"computed-dependency",
						"Computed import/mock requires runtime or review evidence.",
						"advisory",
					);
					continue;
				}
				const target = resolve(specifier, filename);
				// A declared test remains an external consumer even when colocated with its subject.
				const sourceOwner =
					filename === testFile ? undefined : moduleOwner(filename);
				const targetOwner = target && moduleOwner(target);
				const publicEntry =
					target &&
					(kind === "backend"
						? target === path.join(src, targetOwner ?? "", "index.ts")
						: isPublicFeatureEntry(featureRoot, target));
				if (targetOwner && sourceOwner !== targetOwner && !publicEntry)
					report(
						"private-entry",
						`Import ${targetOwner} through its deliberately public entry: ${specifier}`,
					);
				if (edge.mock && target) {
					const ownsSubject =
						target === subject ||
						(subject.endsWith(`${path.sep}index.ts`) &&
							moduleOwner(subject) === targetOwner &&
							targetOwner?.startsWith(
								kind === "backend" ? "capabilities/" : "features/",
							));
					if (ownsSubject)
						report(
							edge.partial ? "partial-subject-mock" : "subject-mock",
							`Module mock replaces declared subject ${entry.subject}: ${specifier}`,
							edge.partial ? "advisory" : "error",
						);
				}
				const runtimeEdge = runtime && !edge.typeOnly;
				if (
					entry.role === "capability" &&
					runtimeEdge &&
					(infrastructure.test(specifier) ||
						(target && inside(src, target) && !boundaries.capability(target)))
				) {
					report(
						"capability-infrastructure",
						`Capability test reaches production infrastructure/composition: ${specifier}`,
					);
					// The boundary is already enough evidence; avoid a vendor dependency flood.
					continue;
				}
				if (
					!target &&
					(specifier.startsWith(".") || specifier.startsWith("@/"))
				)
					report(
						"unresolved-dependency",
						`Cannot resolve ${specifier}`,
						"advisory",
					);
				if (
					target &&
					inside(root, target) &&
					!target.includes(`${path.sep}node_modules${path.sep}`) &&
					/\.[cm]?[jt]sx?$/.test(target) &&
					!target.endsWith(".d.ts")
				)
					visit(target, [...trail, path.relative(root, filename)], runtimeEdge);
			}
		}
		visit(testFile);
	}
	return {
		diagnostics,
		filesParsed: parsed.size,
		durationMs: Math.round((performance.now() - started) * 100) / 100,
	};
}
