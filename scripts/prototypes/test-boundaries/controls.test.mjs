import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { analyze } from "./analyzer.mjs";

function fixture(
	t,
	content,
	role = "capability",
	frontend = false,
	extra = {},
	testFile = "test/case.ts",
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-boundaries-416-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const files = {
		"tsconfig.json": JSON.stringify({
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		}),
		"quality.config.json": JSON.stringify({
			publicModules: ["adapters/search", "http"],
		}),
		"src/capabilities/catalogue/index.ts":
			'export { construct } from "./private";',
		"src/capabilities/catalogue/private.ts":
			"export const construct = () => 1;",
		"src/adapters/search/index.ts": 'import "nats";',
		"src/http/index.ts": 'import "../capabilities/catalogue";',
		"src/features/authentication/index.ts":
			'export { policy } from "./policy";',
		"src/features/authentication/policy.ts":
			"export const policy = () => true;",
		"src/features/authentication/adapters/navigation.ts": 'import "../index";',
		"test/helper.ts": 'export * from "@/capabilities/catalogue/private";',
		"test/builder.ts": 'import "../src/adapters/search";',
		"test/controlled.ts":
			'import { construct } from "../src/capabilities/catalogue"; export const memory = new Map();',
		[testFile]: content,
		...extra,
	};
	for (const [file, text] of Object.entries(files)) {
		if (file.endsWith(".ts"))
			assert.deepEqual(
				ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
					.parseDiagnostics,
				[],
				`Invalid control syntax: ${file}`,
			);
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	}
	const subject = frontend
		? "src/features/authentication/index.ts"
		: "src/capabilities/catalogue/index.ts";
	return analyze({
		root: `${root}/`,
		workspace: ".",
		kind: frontend ? "frontend" : "backend",
		tests: [{ file: testFile, role, subject }],
	});
}

const invalid = [
	[
		"private import",
		'import "../src/capabilities/catalogue/private";',
		"private-entry",
	],
	[
		"alias import",
		'import "@/capabilities/catalogue/private";',
		"private-entry",
	],
	["helper re-export", 'import "./helper";', "private-entry"],
	[
		"dynamic literal",
		'import("@/capabilities/catalogue/private");',
		"private-entry",
	],
	[
		"static template",
		"import(`@/capabilities/catalogue/private`);",
		"private-entry",
	],
	[
		"require",
		'require("../src/capabilities/catalogue/private");',
		"private-entry",
	],
	[
		"private type query",
		'type T = import("@/capabilities/catalogue/private").T;',
		"private-entry",
	],
	[
		"builder infrastructure",
		'import "./builder";',
		"capability-infrastructure",
	],
	["external infrastructure", 'import "nats";', "capability-infrastructure"],
	[
		"subject mock",
		'import { vi } from "vitest"; vi.mock("../src/capabilities/catalogue", () => ({}));',
		"subject-mock",
	],
	[
		"aliased mock",
		'import { vi as fake } from "vitest"; fake.doMock("@/capabilities/catalogue", () => ({}));',
		"subject-mock",
	],
	[
		"helper mock",
		'import "./mock-helper";',
		"subject-mock",
		{
			"test/mock-helper.ts":
				'import { vi } from "vitest"; vi.mock("../src/capabilities/catalogue", () => ({}));',
		},
	],
];
for (const [name, content, code, extra] of invalid) {
	test(`rejects ${name}`, (t) => {
		const result = fixture(t, content, "capability", false, extra);
		const finding = result.diagnostics.find((item) => item.code === code);
		assert.ok(finding, JSON.stringify(result));
		assert.ok(finding.line > 0);
		assert.equal(finding.severity, "error");
		assert.ok(finding.trail[0].endsWith("test/case.ts"));
	});
}
for (const [name, content, role] of [
	[
		"public construction and stateful adapter",
		'import "./controlled";',
		"capability",
	],
	[
		"real infrastructure adapter contract",
		'import "../src/adapters/search"; import "testcontainers";',
		"driven-adapter",
	],
	["driving adapter", 'import "../src/http";', "driving-adapter"],
	[
		"composition",
		'import "../src/http"; import "../src/adapters/search";',
		"composition",
	],
]) {
	test(`accepts ${name}`, (t) =>
		assert.deepEqual(fixture(t, content, role).diagnostics, []));
}
test("frontend public policy and named adapter stay public", (t) => {
	assert.deepEqual(
		fixture(
			t,
			'import "@/features/authentication"; import "@/features/authentication/adapters/navigation";',
			"frontend-integration",
			true,
		).diagnostics,
		[],
	);
});
test("frontend helper cannot expose private policy", (t) => {
	assert.ok(
		fixture(t, 'import "./helper";', "frontend-workflow", true, {
			"test/helper.ts": 'export * from "@/features/authentication/policy";',
		}).diagnostics.some((d) => d.code === "private-entry"),
	);
});
test("type-only infrastructure is erased, but private types stay private", (t) => {
	assert.deepEqual(
		fixture(t, 'import type { Client } from "nats";').diagnostics,
		[],
	);
});
test("computed dependency is advisory, never a silent pass", (t) => {
	assert.ok(
		fixture(t, 'let target = "nats"; import(target);').diagnostics.some(
			(d) => d.code === "computed-dependency" && d.severity === "advisory",
		),
	);
});
test("unknown role is rejected rather than inferred from filename", (t) => {
	assert.throws(() => fixture(t, "", "unit"), /role/);
});
test("unresolved local alias is advisory", (t) => {
	assert.ok(
		fixture(t, 'import "@/missing";').diagnostics.some(
			(d) => d.code === "unresolved-dependency",
		),
	);
});
test("partial subject mock needs review", (t) => {
	assert.ok(
		fixture(
			t,
			'import { vi } from "vitest"; vi.mock("../src/capabilities/catalogue", async (original) => ({ ...await original() }));',
		).diagnostics.some(
			(d) => d.code === "partial-subject-mock" && d.severity === "advisory",
		),
	);
});
test("colocated tests still use the public entry", (t) => {
	const result = fixture(
		t,
		'import "./private";',
		"capability",
		false,
		{},
		"src/capabilities/catalogue/colocated.test.ts",
	);
	assert.ok(
		result.diagnostics.some(
			(d) => d.file.endsWith("colocated.test.ts") && d.code === "private-entry",
		),
	);
});
test("namespace Vitest alias mock is detected", (t) => {
	assert.ok(
		fixture(
			t,
			'import * as testing from "vitest"; testing.vi.mock("../src/capabilities/catalogue", () => ({}));',
		).diagnostics.some((d) => d.code === "subject-mock"),
	);
});
test("global Vitest mock is detected", (t) => {
	assert.ok(
		fixture(
			t,
			'vi.mock("../src/capabilities/catalogue", () => ({}));',
		).diagnostics.some((d) => d.code === "subject-mock"),
	);
});
test("constant dynamic import is statically resolved", (t) => {
	assert.ok(
		fixture(
			t,
			'const target = "../src/capabilities/catalogue/private"; import(target);',
		).diagnostics.some((d) => d.code === "private-entry"),
	);
});
test("named type re-exports do not introduce runtime infrastructure", (t) => {
	assert.deepEqual(
		fixture(t, 'export { type Client } from "nats";').diagnostics,
		[],
	);
});
test("cyclic helper graph terminates and detects its private dependency", (t) => {
	const result = fixture(t, 'import "./loop";', "capability", false, {
		"test/loop.ts": 'export * from "./cycle";',
		"test/cycle.ts":
			'export * from "./loop"; export * from "../src/capabilities/catalogue/private";',
	});
	assert.ok(result.diagnostics.some((d) => d.code === "private-entry"));
});
test("measures conservative false positive: unused helper function loads infrastructure", (t) => {
	const result = fixture(
		t,
		'import { memory } from "./mixed";',
		"capability",
		false,
		{
			"test/mixed.ts":
				'export const memory = new Map(); export const unused = () => import("nats");',
		},
	);
	assert.ok(
		result.diagnostics.some((d) => d.code === "capability-infrastructure"),
	);
});
// Deliberate blind spots are executable measurements, not claims of full coverage.
for (const [name, content] of [
	[
		"destructured mock alias",
		'import { vi } from "vitest"; const { mock } = vi; mock("../src/capabilities/catalogue", () => ({}));',
	],
	[
		"subject method replacement",
		'import { vi } from "vitest"; import * as subject from "../src/capabilities/catalogue"; vi.spyOn(subject, "construct").mockImplementation(() => 42);',
	],
	["runtime loader", "eval('require(\"nats\")');"],
	["unlisted infrastructure package", 'import "pg";'],
]) {
	test(`measures known bypass: ${name}`, (t) =>
		assert.equal(fixture(t, content).diagnostics.length, 0));
}
