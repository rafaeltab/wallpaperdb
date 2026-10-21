// PROTOTYPE #417: bounded adapters for this checkout's runner and shell conventions.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";

export const slash = (path) => path.replaceAll("\\", "/");
export const rel = (root, path) => slash(relative(root, path));
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function command(bin, args, cwd, extraEnv = {}, timeout = 60_000) {
	const env = {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
		...extraEnv,
	};
	for (const name of ["PACKAGE", "SERVICE", "DB", "SCRIPT", "ARGS", "FORCE"])
		delete env[name];
	const start = performance.now();
	const result = spawnSync(bin, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout,
		maxBuffer: 32 * 1024 * 1024,
	});
	return {
		status: result.status,
		error: result.error?.message,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		ms: Math.round(performance.now() - start),
	};
}

export function scan(path, source) {
	const ast = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const names = new Set(["test", "it", "describe", "suite"]);
	const namespaces = new Set();
	for (const node of ast.statements) {
		if (
			!ts.isImportDeclaration(node) ||
			!/^(vitest|@effect\/vitest|node:test|@playwright\/test)$/.test(
				node.moduleSpecifier.text,
			)
		)
			continue;
		const bindings = node.importClause?.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings))
			namespaces.add(bindings.name.text);
		if (bindings && ts.isNamedImports(bindings)) {
			for (const binding of bindings.elements)
				if (names.has(binding.propertyName?.text ?? binding.name.text))
					names.add(binding.name.text);
		}
		if (node.importClause?.name) names.add(node.importClause.name.text);
	}
	const findings = [];
	const conditionals = [];
	let hasTests = false;
	function parts(node) {
		if (ts.isIdentifier(node)) return [node.text];
		if (ts.isCallExpression(node)) return parts(node.expression);
		if (ts.isPropertyAccessExpression(node)) {
			const base = parts(node.expression);
			return base.length ? [...base, node.name.text] : [];
		}
		if (
			ts.isElementAccessExpression(node) &&
			ts.isStringLiteral(node.argumentExpression)
		) {
			const base = parts(node.expression);
			return base.length ? [...base, node.argumentExpression.text] : [];
		}
		return [];
	}
	function visit(node) {
		if (ts.isCallExpression(node)) {
			let chain = parts(node.expression);
			if (namespaces.has(chain[0])) chain = chain.slice(1);
			if (
				names.has(chain[0]) &&
				!chain.some((p) =>
					[
						"step",
						"extend",
						"use",
						"info",
						"setTimeout",
						"beforeEach",
						"afterEach",
						"beforeAll",
						"afterAll",
					].includes(p),
				)
			) {
				hasTests = true;
				const line =
					ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
				const add = (code, detail) => {
					if (!findings.some((f) => f.code === code && f.detail === detail))
						findings.push({ code, target: path, detail });
				};
				if (chain.includes("only"))
					add("focused", `${chain.join(".")} at line ${line}`);
				if (chain.some((p) => ["skipIf", "runIf"].includes(p))) {
					if (
						!conditionals.some(
							(c) => c.line === line && c.api === chain.join("."),
						)
					)
						conditionals.push({ path, line, api: chain.join(".") });
				} else if (chain.some((p) => ["skip", "todo", "fixme"].includes(p)))
					add("disabled", `${chain.join(".")} at line ${line}`);
				for (const arg of node.arguments) {
					if (!ts.isObjectLiteralExpression(arg)) continue;
					for (const prop of arg.properties) {
						if (
							ts.isPropertyAssignment(prop) &&
							["only", "skip", "todo"].includes(prop.name.getText(ast)) &&
							prop.initializer.kind !== ts.SyntaxKind.FalseKeyword
						)
							add(
								prop.name.getText(ast) === "only" ? "focused" : "disabled",
								`${prop.name.getText(ast)} option at line ${line}`,
							);
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(ast);
	return { findings, conditionals, hasTests };
}

export function typeMembers(root, config, build, seen = new Set()) {
	const path = resolve(root, config);
	if (seen.has(path)) return new Map();
	seen.add(path);
	const json = ts.readConfigFile(path, ts.sys.readFile);
	if (json.error)
		throw new Error(
			ts.flattenDiagnosticMessageText(json.error.messageText, "\n"),
		);
	const parsed = ts.parseJsonConfigFileContent(
		json.config,
		ts.sys,
		resolve(path, ".."),
	);
	const errors = parsed.errors.filter((e) => e.code !== 18003);
	if (errors.length)
		throw new Error(
			errors
				.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
				.join("\n"),
		);
	const members = new Map();
	if (!parsed.options.noCheck) {
		const program = ts.createProgram({
			rootNames: parsed.fileNames,
			options: parsed.options,
			projectReferences: parsed.projectReferences,
		});
		for (const source of program.getSourceFiles())
			if (
				source.checkJsDirective?.enabled !== false &&
				!source.isDeclarationFile &&
				!source.fileName.includes("/node_modules/")
			)
				members.set(rel(root, source.fileName), rel(root, path));
	}
	if (build) {
		for (const ref of parsed.projectReferences ?? []) {
			const refConfig = ref.path.endsWith(".json")
				? ref.path
				: resolve(ref.path, "tsconfig.json");
			for (const [file, project] of typeMembers(root, refConfig, true, seen))
				members.set(file, project);
		}
	}
	return members;
}

export function taskArguments(script) {
	const segment = script.split("&&").find((s) => /\bvitest run\b/.test(s));
	if (!segment) throw new Error(`Unsupported runner command: ${script}`);
	const text = segment
		.slice(segment.indexOf("vitest run") + "vitest run".length)
		.trim();
	if (/["'|;$`]/.test(text))
		throw new Error(`Unsupported shell syntax: ${script}`);
	return text.split(/\s+/).filter((a) => a && !a.startsWith("--coverage"));
}

export function graph(root) {
	const tasks = new Map();
	const evidence = [];
	// Deliberately supports only the literal Make invocations in these two workflows.
	// This is not a YAML/Actions expression evaluator. Unknown commands fail below.
	for (const workflow of [
		".github/workflows/ci.yml",
		".github/workflows/e2e.yml",
	]) {
		if (!existsSync(resolve(root, workflow))) continue;
		const source = readFileSync(resolve(root, workflow), "utf8");
		for (const line of source.split("\n")) {
			const invocation = line.match(
				/^\s*(?:(?:-\s+)?run:\s*)?(make\s+(?:test-unit|test-integration|test-e2e|check|check-types)\b.*)$/,
			)?.[1];
			if (!invocation) continue;
			const args = invocation
				.match(/(?:[^\s"']+|'[^']*'|"[^"]*")+/g)
				.slice(1)
				.map((a) => a.replaceAll("'", "").replaceAll('"', ""));
			if (args.some((a) => /[;$`|&]/.test(a)))
				throw new Error(`Unsupported workflow command: ${invocation}`);
			const flags = args.findIndex((a) => a.startsWith("TURBO_FLAGS="));
			if (flags >= 0) args[flags] += " --dry=json";
			else args.push("TURBO_FLAGS=$(FILTER) --dry=json");
			const result = command("make", ["--silent", ...args], root, {
				GITHUB_ACTIONS: "true",
			});
			if (result.status !== 0)
				throw new Error(`${invocation} graph failed: ${result.stderr}`);
			const plan = JSON.parse(result.stdout);
			evidence.push({
				workflow,
				invocation,
				ms: result.ms,
				tasks: plan.tasks.map((t) => t.taskId),
			});
			for (const task of plan.tasks)
				if (task.command && task.command !== "<NONEXISTENT>")
					tasks.set(task.taskId, task);
		}
	}
	if (!evidence.length)
		throw new Error("No supported literal CI Make invocations found");
	return { tasks, evidence };
}

export function vitestFiles(root, suite, args, scratch, index) {
	const output = resolve(scratch, `discovery-${index}.json`);
	const result = command(
		resolve(root, suite.cwd, "node_modules/.bin/vitest"),
		["list", "--filesOnly", `--json=${output}`, ...args],
		resolve(root, suite.cwd),
	);
	if (result.status !== 0 || !existsSync(output))
		throw new Error(
			`${suite.id} discovery failed: ${result.stderr || result.stdout}`,
		);
	const files = readJson(output).map(
		(f) => `${f.projectName ?? ""}::${rel(root, f.file)}`,
	);
	return { files, ms: result.ms };
}

export function playwrightFiles(root, suite, scratch, index) {
	const output = resolve(scratch, `playwright-${index}.json`);
	const result = command(
		resolve(root, suite.cwd, "node_modules/.bin/playwright"),
		["test", "--list", "--reporter=json", "--forbid-only"],
		resolve(root, suite.cwd),
		{ PLAYWRIGHT_JSON_OUTPUT_FILE: output },
	);
	if (result.status !== 0 || !existsSync(output))
		throw new Error(
			`${suite.id} discovery failed: ${result.stderr || result.stdout}`,
		);
	const json = readJson(output);
	if (json.errors?.length) throw new Error(JSON.stringify(json.errors));
	const files = [];
	function visit(node) {
		for (const spec of node.specs ?? []) {
			for (const test of spec.tests)
				files.push(
					`${test.projectName}::${rel(root, resolve(root, suite.cwd, "specs", spec.file))}`,
				);
		}
		for (const child of node.suites ?? []) visit(child);
	}
	visit(json);
	return {
		files: [...new Set(files)],
		ms: result.ms,
		projects: json.config.projects.map((p) => ({
			name: p.name,
			dependencies: p.dependencies,
		})),
	};
}
