import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { auditReports } from "./report-audit.mjs";

const root = process.cwd();
function input(name, line, counts) {
	const path = resolve(root, `apps/factory/src/adapters/${name}.ts`),
		loc = { start: { line, column: 4 }, end: { line, column: 50 } };
	return {
		id: name,
		data: {
			[path]: {
				path,
				statementMap: { 0: loc, 1: loc },
				fnMap: {
					0: { name: "hit", loc, decl: loc },
					1: { name: "zero", loc, decl: loc },
				},
				branchMap: { 0: { type: "if", loc, locations: [loc, loc] } },
				s: { 0: 7, 1: 0 },
				f: { 0: 2, 1: 0 },
				b: { 0: counts },
			},
		},
	};
}
const inputs = [
		input("github/joins", 1133, [549, -310]),
		input("t3/planner", 277, [89, -2]),
	],
	before = structuredClone(inputs);
const result = auditReports(inputs, root);
assert.deepEqual(inputs, before, "raw evidence mutated");
assert.equal(result.audit.length, 2);
for (let i = 0; i < inputs.length; i++) {
	const raw = Object.values(inputs[i].data)[0],
		out = Object.values(result.reports[i].data)[0];
	for (const key of ["statementMap", "fnMap", "branchMap", "s", "f"])
		assert.deepEqual(out[key], raw[key], key);
	assert.deepEqual(out.b[0], [raw.b[0][0], 0]);
	assert.equal(out.branchMap[0].locations.length, 2);
	assert.equal(
		out.b[0].filter((n) => n > 0).length,
		1,
		"uncertain arm invented a hit",
	);
}
for (const counts of [
	[4, 0],
	[0, 3],
	[0, 0],
]) {
	const x = [input("github/joins", 1133, counts)];
	assert.deepEqual(auditReports(x, root), { reports: x, audit: [] });
}
assert.throws(
	() => auditReports([...inputs, inputs[0]], root),
	/budget|Repeated/,
);
assert.throws(
	() => auditReports([input("github/joins", 99, [1, -1])], root),
	/Unaudited/,
);
// Three completed calls: two true visits and one false visit. The incoming
// continuation reports one visit, producing [2,-1]; following read runs three times.
const mixed = input("github/joins", 1133, [2, -1]);
const mixedFile = Object.values(mixed.data)[0];
const branch = {
	start: { line: 1133, column: 4 },
	end: { line: 1133, column: 57 },
};
mixedFile.branchMap[0] = {
	type: "if",
	loc: branch,
	locations: [branch, { start: {}, end: {} }],
};
mixedFile.statementMap = {
	0: { start: { line: 1133, column: 18 }, end: { line: 1133, column: 57 } },
	1: { start: { line: 1134, column: 18 }, end: { line: 1134, column: 43 } },
};
mixedFile.s = { 0: 2, 1: 3 };
const mixedBefore = structuredClone(mixed),
	estimated = auditReports([mixed], root);
assert.deepEqual(Object.values(estimated.reports[0].data)[0].b[0], [2, 1]);
assert.deepEqual(mixed, mixedBefore, "estimated coverage mutated raw input");
assert.equal(estimated.audit[0].classification, "estimated-covered");
assert.equal(estimated.audit[0].estimate.difference, 1);
const planner = input("t3/planner", 277, [89, -2]),
	plannerFile = Object.values(planner.data)[0];
const plannerBranch = {
	start: { line: 277, column: 4 },
	end: { line: 289, column: 5 },
};
plannerFile.branchMap[0] = {
	type: "if",
	loc: plannerBranch,
	locations: [plannerBranch, { start: {}, end: {} }],
};
plannerFile.statementMap = {
	0: { start: { line: 278, column: 6 }, end: { line: 283, column: 8 } },
	1: { start: { line: 292, column: 20 }, end: { line: 292, column: 98 } },
	2: { start: { line: 303, column: 4 }, end: { line: 303, column: 18 } },
};
plannerFile.s = { 0: 89, 1: 92, 2: 92 };
const plannerEstimated = auditReports([planner], root);
assert.deepEqual(
	Object.values(plannerEstimated.reports[0].data)[0].b[0],
	[89, 1],
	"boolean indicator, not difference3",
);
assert.equal(plannerEstimated.audit[0].estimate.finalReturn, 92);
for (const value of [91, 93]) {
	const contradicted = structuredClone(planner);
	Object.values(contradicted.data)[0].s[2] = value;
	const fallback = auditReports([contradicted], root);
	assert.equal(
		Object.values(fallback.reports[0].data)[0].b[0][1],
		0,
		"return disagreement must not invent coverage",
	);
	assert.equal(
		fallback.audit[0].estimate.reason,
		"downstream-return-disagreement",
	);
}
for (const fixture of [mixed, planner]) {
	const unchanged = structuredClone(fixture),
		raw = Object.values(fixture.data)[0],
		out = Object.values(auditReports([fixture], root).reports[0].data)[0];
	for (const key of ["statementMap", "fnMap", "branchMap", "s", "f"])
		assert.deepEqual(out[key], raw[key]);
	assert.deepEqual(fixture, unchanged);
	// All true calls reach the following statement: no false visit exists.
	const trueOnly = structuredClone(fixture),
		trueFile = Object.values(trueOnly.data)[0];
	trueFile.s[1] = trueFile.b[0][0];
	if (fixture === planner) trueFile.s[2] = trueFile.b[0][0];
	assert.equal(
		Object.values(auditReports([trueOnly], root).reports[0].data)[0].b[0][1],
		0,
	);
	for (const key of ["0", "1", ...(fixture === planner ? ["2"] : [])]) {
		const missing = structuredClone(fixture),
			file = Object.values(missing.data)[0];
		delete file.s[key];
		delete file.statementMap[key];
		assert.equal(
			Object.values(auditReports([missing], root).reports[0].data)[0].b[0][1],
			0,
		);
		const duplicate = structuredClone(fixture),
			twice = Object.values(duplicate.data)[0];
		twice.statementMap.extra = twice.statementMap[key];
		twice.s.extra = twice.s[key];
		assert.equal(
			Object.values(auditReports([duplicate], root).reports[0].data)[0].b[0][1],
			0,
		);
	}
	const mismatch = structuredClone(fixture);
	Object.values(mismatch.data)[0].s[0]++;
	assert.equal(
		auditReports([mismatch], root).audit[0].estimate.reason,
		"true-body-disagreement",
	);
	for (const count of [0, 3]) {
		const measured = structuredClone(fixture);
		Object.values(measured.data)[0].b[0][1] = count;
		assert.deepEqual(
			auditReports([measured], root),
			{ reports: [measured], audit: [] },
			"measured nonnegative counts untouched",
		);
	}
	for (const kind of ["s", "f", "b"])
		for (const bad of [
			NaN,
			Infinity,
			"3",
			-0.5,
			...(kind === "b" ? [] : [-1]),
		]) {
			const invalid = structuredClone(fixture);
			Object.values(invalid.data)[0][kind][0] = kind === "b" ? [bad, -1] : bad;
			assert.throws(
				() => auditReports([invalid], root),
				/Invalid|invalid|Nonfinite/,
			);
		}
}
assert.equal(
	auditReports([mixed, planner], root).audit.filter((a) => a.published === 1)
		.length,
	2,
);
assert.throws(
	() => auditReports([mixed, planner, mixed], root),
	/budget|Repeated/,
);
const corruptTrue = structuredClone(mixed);
Object.values(corruptTrue.data)[0].b[0] = [-1, 1];
assert.throws(
	() => auditReports([corruptTrue], root),
	/Unaudited/,
	"known-site true arms are never normalized",
);
// Literal outcomes promoted from the small executed diagnostic controls.
// This seam consumes their measurements; it does not reinterpret V8 ranges.
for (const fixture of [mixed, planner])
	for (const scenario of [
		{
			name: "true-only resolved",
			trueVisits: 2,
			following: 2,
			rawFalse: -1,
			falseVisits: 0,
			published: 0,
		},
		{
			name: "false-only resolved",
			trueVisits: 0,
			following: 2,
			rawFalse: 1,
			falseVisits: 2,
			published: 1,
		},
		{
			name: "two true plus one false",
			trueVisits: 2,
			following: 3,
			rawFalse: -1,
			falseVisits: 1,
			published: 1,
		},
		{
			name: "synchronous throw before guard",
			trueVisits: 1,
			following: 1,
			rawFalse: 0,
			falseVisits: 0,
			published: 0,
		},
		{
			name: "rejected initializer",
			trueVisits: 1,
			following: 1,
			rawFalse: 0,
			falseVisits: 0,
			published: 0,
		},
		{
			name: "pending initializer",
			trueVisits: 1,
			following: 1,
			rawFalse: 0,
			falseVisits: 0,
			published: 0,
		},
		{
			name: "mixed true-body rejection",
			trueVisits: 1,
			following: 1,
			rawFalse: 0,
			falseVisits: 1,
			published: 0,
		},
		{
			name: "mixed true-body pending",
			trueVisits: 1,
			following: 1,
			rawFalse: 0,
			falseVisits: 1,
			published: 0,
		},
	]) {
		const candidate = structuredClone(fixture),
			file = Object.values(candidate.data)[0];
		file.b[0] = [scenario.trueVisits, scenario.rawFalse];
		file.s[0] = scenario.trueVisits;
		file.s[1] = scenario.following;
		if (fixture === planner) file.s[2] = scenario.following;
		const result = auditReports([candidate], root),
			published = Object.values(result.reports[0].data)[0].b[0][1];
		assert.equal(published, scenario.published, scenario.name);
		if (scenario.falseVisits === 0)
			assert.equal(published, 0, `false covered label: ${scenario.name}`);
	}
const sandbox = mkdtempSync(resolve(tmpdir(), "audit-source-"));
try {
	const copied = structuredClone(mixed),
		path = resolve(sandbox, "apps/factory/src/adapters/github/joins.ts");
	const file = Object.values(copied.data)[0];
	file.path = path;
	copied.data = { [path]: file };
	assert.equal(
		auditReports([copied], sandbox).audit[0].estimate.reason,
		"source-unavailable",
	);
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(
		path,
		readFileSync(Object.keys(mixed.data)[0], "utf8") + "\n// changed source\n",
	);
	const fallback = auditReports([copied], sandbox);
	assert.equal(fallback.audit[0].estimate.reason, "source-identity-mismatch");
	assert.equal(fallback.audit[0].published, 0);
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}
for (const kind of ["s", "f", "b"])
	for (const bad of [NaN, Infinity, "1", -0.5, ...(kind === "b" ? [] : [-1])]) {
		const x = input("github/joins", 1133, [1, 0]);
		Object.values(x.data)[0][kind][0] = kind === "b" ? [1, bad] : bad;
		assert.throws(() => auditReports([x], root), /Invalid|invalid|Nonfinite/);
	}
console.log(
	"Audited boolean estimates and zero fallbacks preserve raw data/maps/denominator; measured positive/zero unchanged; corruption rejected",
);
