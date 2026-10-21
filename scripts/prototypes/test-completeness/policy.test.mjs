import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "./policy.mjs";

const file = "test/example.test.ts";
const key = `unit::${file}`;
const baseline = () => ({
	files: [
		{ path: file, role: "test", typedBy: ["tsconfig.json"], discovered: [key] },
	],
	suites: [
		{
			id: "unit",
			role: "expected",
			files: [key],
			ciFiles: [key],
			task: "example#test:unit",
			inGraph: true,
		},
	],
	findings: [],
	executions: [],
});
const codes = (input, exceptions = []) =>
	evaluate(input, exceptions, "2026-10-21").failures.map((f) => f.code);

test("empty expected projects fail even when a sibling has tests; setup-only projects pass", () => {
	const input = baseline();
	input.suites[0].expectedProjects = [
		{ name: "unit", role: "expected" },
		{ name: "missing", role: "expected" },
		{ name: "setup-only", role: "setup" },
	];
	const result = evaluate(input);
	assert.deepEqual(
		result.failures.map((f) => [f.code, f.target]),
		[["empty-suite", "unit/missing"]],
	);
});

test("valid tests, helpers, fixtures, JavaScript, setup-only suites and explicit selections pass", () => {
	const input = baseline();
	input.files.push(
		{
			path: "test/helper.ts",
			role: "helper",
			typedBy: ["tsconfig.json"],
			discovered: [],
		},
		{ path: "test/data.json", role: "fixture", typedBy: [], discovered: [] },
		{
			path: "test/example.test.mjs",
			role: "test",
			typedBy: [],
			discovered: ["node::js"],
		},
	);
	input.suites.push(
		{ id: "setup", role: "setup", files: [], ciFiles: [], inGraph: true },
		{
			id: "filtered",
			role: "selection",
			files: [],
			ciFiles: [],
			inGraph: true,
			reason: "Explicit local filter",
		},
	);
	assert.deepEqual(codes(input), []);
});

for (const [name, mutate, expected] of [
	[
		"misplaced test",
		(i) => {
			i.files[0].discovered = [];
		},
		"undiscovered",
	],
	[
		"test omitted by task project filter",
		(i) => {
			i.suites[0].ciFiles = [];
		},
		"ci-omission",
	],
	[
		"task absent from CI graph",
		(i) => {
			i.suites[0].inGraph = false;
		},
		"ci-task",
	],
	[
		"empty expected suite",
		(i) => {
			i.suites[0].files = [];
		},
		"empty-suite",
	],
	[
		"excluded TypeScript test",
		(i) => {
			i.files[0].typedBy = [];
		},
		"untyped",
	],
	[
		"excluded TypeScript helper",
		(i) => {
			i.files[0].role = "helper";
			i.files[0].typedBy = [];
		},
		"untyped",
	],
	[
		"runtime skip",
		(i) => {
			i.executions = [
				{
					id: "unit",
					nonce: "new",
					expectedNonce: "new",
					expectedFiles: [key],
					files: [{ key, tests: [{ name: "conditional", state: "skipped" }] }],
				},
			];
		},
		"runtime-skip",
	],
	[
		"missing execution",
		(i) => {
			i.executions = [
				{
					id: "unit",
					nonce: "new",
					expectedNonce: "new",
					expectedFiles: [key],
					files: [],
				},
			];
		},
		"unexecuted",
	],
	[
		"empty test file",
		(i) => {
			i.executions = [
				{
					id: "unit",
					nonce: "new",
					expectedNonce: "new",
					expectedFiles: [key],
					files: [{ key, tests: [] }],
				},
			];
		},
		"empty-file",
	],
	[
		"stale cached report",
		(i) => {
			i.executions = [
				{
					id: "unit",
					nonce: "old",
					expectedNonce: "new",
					expectedFiles: [key],
					files: [{ key, tests: [{ name: "passes", state: "passed" }] }],
				},
			];
		},
		"stale-report",
	],
]) {
	test(`rejects ${name}`, () => {
		const input = baseline();
		mutate(input);
		assert.ok(codes(input).includes(expected));
	});
}

test("exceptions require exact finding, owner, issue, reason, strict expiry and current use", () => {
	const input = baseline();
	input.findings.push({ code: "disabled", target: file, detail: "test.skip" });
	const exception = {
		code: "disabled",
		target: file,
		owner: "@rafaeltab",
		issue: "https://github.com/rafaeltab/wallpaperdb/issues/417",
		reason: "Pilot control",
		expires: "2026-10-22",
	};
	const result = evaluate(input, [exception], "2026-10-21");
	assert.deepEqual(result.failures, []);
	assert.equal(result.allowed[0].exception.reason, "Pilot control");
	for (const patch of [
		{ owner: "" },
		{ issue: "417" },
		{ reason: "" },
		{ expires: "2026-02-30" },
		{ expires: "2026-10-21" },
		{ target: "*" },
		{ code: "unknown" },
	]) {
		assert.ok(
			codes(input, [{ ...exception, ...patch }]).includes("invalid-exception"),
		);
	}
	assert.ok(codes(baseline(), [exception]).includes("unused-exception"));
});
