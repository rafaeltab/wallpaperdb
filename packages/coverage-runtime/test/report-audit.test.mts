import type { Range } from "istanbul-lib-coverage";
import { expect } from "vitest";
import {
	repositoryConfiguration,
	repositoryRoot,
} from "../src/repository-root.mjs";
const { estimates } = await repositoryConfiguration();
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

import { auditReports as audit } from "../src/report-audit.mjs";
const auditReports: typeof audit = (inputs, root) =>
	audit(inputs, root, estimates);

import { test } from "vitest";
test("report-audit preserves the coverage contract", async () => {
	const root = repositoryRoot();
	function input(
		name: string,
		line: number,
		counts: number[],
	): { id: string; data: Record<string, FixtureFile> } {
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
			input("github/joins", 1134, [549, -310]),
			input("t3/planner", 272, [89, -2]),
		],
		before = structuredClone(inputs);
	const result = auditReports(inputs, root);
	expect(inputs, "raw evidence mutated").toStrictEqual(before);
	expect(result.audit.length).toBe(2);
	for (let i = 0; i < inputs.length; i++) {
		const raw = Object.values(inputs[i].data)[0],
			out = Object.values(result.reports[i].data)[0];
		for (const key of ["statementMap", "fnMap", "branchMap", "s", "f"] as const)
			expect(out[key], key).toStrictEqual(raw[key]);
		expect(out.b[0]).toStrictEqual([raw.b[0][0], 0]);
		expect(out.branchMap[0].locations.length).toBe(2);
		expect(
			out.b[0].filter((n) => n > 0).length,
			"uncertain arm invented a hit",
		).toBe(1);
	}
	for (const counts of [
		[4, 0],
		[0, 3],
		[0, 0],
	]) {
		const x = [input("github/joins", 1134, counts)];
		expect(auditReports(x, root)).toStrictEqual({ reports: x, audit: [] });
	}
	expect(() => auditReports([...inputs, inputs[0]], root)).toThrow(
		/budget|Repeated/,
	);
	expect(() =>
		auditReports([input("github/joins", 99, [1, -1])], root),
	).toThrow(/Unaudited/);
	// Three completed calls: two true visits and one false visit. The incoming
	// continuation reports one visit, producing [2,-1]; following read runs three times.
	const mixed = input("github/joins", 1134, [2, -1]);
	const mixedFile = Object.values(mixed.data)[0];
	const branch = {
		start: { line: 1134, column: 4 },
		end: { line: 1134, column: 57 },
	};
	mixedFile.branchMap[0] = {
		type: "if",
		loc: branch,
		locations: [branch, { start: {}, end: {} }],
	};
	mixedFile.statementMap = {
		0: { start: { line: 1134, column: 18 }, end: { line: 1134, column: 57 } },
		1: { start: { line: 1135, column: 18 }, end: { line: 1135, column: 43 } },
	};
	mixedFile.s = { 0: 2, 1: 3 };
 const joinLines = readFileSync(mixedFile.path, "utf8").split("\n");
 expect(joinLines[branch.start.line - 1].slice(branch.start.column, branch.end.column)).toBe("if (proposed) await publish(dir, planName, proposed);");
 const followingJoin = mixedFile.statementMap[1];
 expect(joinLines[followingJoin.start.line - 1].slice(followingJoin.start.column, followingJoin.end.column)).toBe("await read(dir, planName)");
	const mixedBefore = structuredClone(mixed),
		estimated = auditReports([mixed], root);
	expect(Object.values(estimated.reports[0].data)[0].b[0]).toStrictEqual([
		2, 1,
	]);
	expect(mixed, "estimated coverage mutated raw input").toStrictEqual(
		mixedBefore,
	);
	expect(estimated.audit[0].classification).toBe("estimated-covered");
	expect(estimated.audit[0].estimate.difference).toBe(1);
	const planner = input("t3/planner", 272, [89, -2]),
		plannerFile = Object.values(planner.data)[0];
	const plannerBranch = {
		start: { line: 272, column: 4 },
		end: { line: 285, column: 5 },
	};
	plannerFile.branchMap[0] = {
		type: "if",
		loc: plannerBranch,
		locations: [plannerBranch, { start: {}, end: {} }],
	};
	plannerFile.statementMap = {
		0: { start: { line: 273, column: 6 }, end: { line: 278, column: 8 } },
		1: { start: { line: 288, column: 20 }, end: { line: 288, column: 98 } },
		2: { start: { line: 299, column: 4 }, end: { line: 299, column: 18 } },
	};
	// Bind the report fixture to the actual source, independently of audit policy.
	// Matching the source hash alone did not catch stale report coordinates.
	const plannerLines = readFileSync(plannerFile.path, "utf8").split("\n");
	function plannerText({ start, end }: Range) {
		const lines = plannerLines.slice(start.line - 1, end.line);
		lines[lines.length - 1] = (lines.at(-1) || "").slice(0, end.column);
		lines[0] = lines[0].slice(start.column);
		return lines.join("\n");
	}
	assert.match(
		plannerText(plannerBranch),
		/^if \(!detail\.thread\.settled\) \{/,
	);
	expect(plannerText(plannerFile.statementMap[0]).replace(/\s+/g, " ")).toBe(
		"await mcpCall( config, 't3_thread_organize', { action: 'settle', threadId: detail.thread.threadId }, signal );",
	);
	expect(plannerText(plannerFile.statementMap[1])).toBe(
		"record.retired === true || consume || !successful || completedAt === undefined",
	);
	expect(plannerText(plannerFile.statementMap[2])).toBe("return result;");
	plannerFile.s = { 0: 89, 1: 92, 2: 92 };
	const plannerEstimated = auditReports([planner], root);
	expect(
		Object.values(plannerEstimated.reports[0].data)[0].b[0],
		"boolean indicator, not difference3",
	).toStrictEqual([89, 1]);
	expect(plannerEstimated.audit[0].estimate.finalReturn).toBe(92);
	for (const value of [91, 93]) {
		const contradicted = structuredClone(planner);
		Object.values(contradicted.data)[0].s[2] = value;
		const fallback = auditReports([contradicted], root);
		expect(
			Object.values(fallback.reports[0].data)[0].b[0][1],
			"return disagreement must not invent coverage",
		).toBe(0);
		expect(fallback.audit[0].estimate.reason).toBe(
			"downstream-return-disagreement",
		);
	}
	for (const fixture of [mixed, planner]) {
		const unchanged = structuredClone(fixture),
			raw = Object.values(fixture.data)[0],
			out = Object.values(auditReports([fixture], root).reports[0].data)[0];
		for (const key of ["statementMap", "fnMap", "branchMap", "s", "f"] as const)
			expect(out[key]).toStrictEqual(raw[key]);
		expect(fixture).toStrictEqual(unchanged);
		// All true calls reach the following statement: no false visit exists.
		const trueOnly = structuredClone(fixture),
			trueFile = Object.values(trueOnly.data)[0];
		trueFile.s[1] = trueFile.b[0][0];
		if (fixture === planner) trueFile.s[2] = trueFile.b[0][0];
		expect(
			Object.values(auditReports([trueOnly], root).reports[0].data)[0].b[0][1],
		).toBe(0);
		for (const key of ["0", "1", ...(fixture === planner ? ["2"] : [])]) {
			const missing = structuredClone(fixture),
				file = Object.values(missing.data)[0];
			delete file.s[key];
			delete file.statementMap[key];
			expect(
				Object.values(auditReports([missing], root).reports[0].data)[0].b[0][1],
			).toBe(0);
			const duplicate = structuredClone(fixture),
				twice = Object.values(duplicate.data)[0];
			twice.statementMap.extra = twice.statementMap[key];
			twice.s.extra = twice.s[key];
			expect(
				Object.values(auditReports([duplicate], root).reports[0].data)[0]
					.b[0][1],
			).toBe(0);
		}
		const mismatch = structuredClone(fixture);
		const hit = Object.values(mismatch.data)[0].s[0];
		if (typeof hit !== "number")
			throw new Error("Expected numeric fixture counter");
		Object.values(mismatch.data)[0].s[0] = hit + 1;
		expect(auditReports([mismatch], root).audit[0].estimate.reason).toBe(
			"true-body-disagreement",
		);
		for (const count of [0, 3]) {
			const measured = structuredClone(fixture);
			Object.values(measured.data)[0].b[0][1] = count;
			expect(
				auditReports([measured], root),
				"measured nonnegative counts untouched",
			).toStrictEqual({ reports: [measured], audit: [] });
		}
		for (const kind of ["s", "f", "b"] as const)
			for (const bad of [
				NaN,
				Infinity,
				"3",
				-0.5,
				...(kind === "b" ? [] : [-1]),
			]) {
				const invalid = structuredClone(fixture);
				Object.values(invalid.data)[0][kind][0] =
					kind === "b" ? [bad, -1] : bad;
				expect(() => auditReports([invalid], root)).toThrow(
					/Invalid|invalid|Nonfinite/,
				);
			}
	}
	expect(
		auditReports([mixed, planner], root).audit.filter((a) => a.published === 1)
			.length,
	).toBe(2);
	expect(() => auditReports([mixed, planner, mixed], root)).toThrow(
		/budget|Repeated/,
	);
	const corruptTrue = structuredClone(mixed);
	Object.values(corruptTrue.data)[0].b[0] = [-1, 1];
	expect(
		() => auditReports([corruptTrue], root),
		"known-site true arms are never normalized",
	).toThrow(/Unaudited/);
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
			expect(published, scenario.name).toBe(scenario.published);
			if (scenario.falseVisits === 0)
				expect(published, `false covered label: ${scenario.name}`).toBe(0);
		}
	const sandbox = mkdtempSync(resolve(tmpdir(), "audit-source-"));
	try {
		const copied = structuredClone(mixed),
			path = resolve(sandbox, "apps/factory/src/adapters/github/joins.ts");
		const file = Object.values(copied.data)[0];
		file.path = path;
		copied.data = { [path]: file };
		expect(auditReports([copied], sandbox).audit[0].estimate.reason).toBe(
			"source-unavailable",
		);
		mkdirSync(resolve(path, ".."), { recursive: true });
		writeFileSync(
			path,
			`${readFileSync(Object.keys(mixed.data)[0], "utf8")}\n// changed source\n`,
		);
		const fallback = auditReports([copied], sandbox);
		expect(fallback.audit[0].estimate.reason).toBe("source-identity-mismatch");
		expect(fallback.audit[0].published).toBe(0);
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
	for (const kind of ["s", "f", "b"] as const)
		for (const bad of [
			NaN,
			Infinity,
			"1",
			-0.5,
			...(kind === "b" ? [] : [-1]),
		]) {
			const x = input("github/joins", 1134, [1, 0]);
			Object.values(x.data)[0][kind][0] = kind === "b" ? [1, bad] : bad;
			expect(() => auditReports([x], root)).toThrow(
				/Invalid|invalid|Nonfinite/,
			);
		}
	console.log(
		"Audited boolean estimates and zero fallbacks preserve raw data/maps/denominator; measured positive/zero unchanged; corruption rejected",
	);
});

interface FixtureFile {
	path: string;
	statementMap: Record<string, Range>;
	fnMap: Record<string, { name: string; loc: Range; decl: Range }>;
	branchMap: Record<
		string,
		{
			type: string;
			loc: Range;
			locations: (
				| Range
				| { start: Record<string, never>; end: Record<string, never> }
			)[];
		}
	>;
	s: Record<string, number | string>;
	f: Record<string, number | string>;
	b: Record<string, (number | string)[]>;
}
