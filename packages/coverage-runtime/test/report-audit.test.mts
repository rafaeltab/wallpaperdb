import type { Range } from "istanbul-lib-coverage";
import type { AuditPolicy } from "../src/contract.mjs";
import { expect, test as baseTest } from "vitest";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	repositoryConfiguration,
	repositoryRoot,
} from "../src/repository-root.mjs";
import { auditReports as audit } from "../src/report-audit.mjs";
const { estimates } = await repositoryConfiguration();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

baseTest.each([
	{
		name: "join",
		path: "apps/factory/src/adapters/github/joins.ts",
		site: "apps/factory/src/adapters/github/joins.ts:1230:4",
		branch: "if (proposed) await publish(dir, planName, proposed);",
		following: "await read(dir, planName)",
		finalReturn: undefined,
	},
	{
		name: "planner",
		path: "apps/factory/src/adapters/t3/planner.ts",
		site: "apps/factory/src/adapters/t3/planner.ts:272:4",
		branch: /^if \(!detail\.thread\.settled\) \{/,
		following:
			"record.retired === true || consume || !successful || completedAt === undefined",
		finalReturn: [299, 4, 299, 18],
	},
])(
	"$name audit policy remains bound to the actual application source",
	({ path, site, branch, following, finalReturn }) => {
		const source = readFileSync(resolve(repositoryRoot(), path), "utf8");
		const policy = estimates[site];
		const text = (span: number[]) => {
			const lines = source.split("\n").slice(span[0] - 1, span[2]);
			lines[lines.length - 1] = (lines.at(-1) || "").slice(0, span[3]);
			lines[0] = lines[0].slice(span[1]);
			return lines.join("\n");
		};
		expect(sha(source)).toBe(policy.sourceSHA256);
		if (typeof branch === "string") expect(text(policy.branch)).toBe(branch);
		else expect(text(policy.branch)).toMatch(branch);
		expect(text(policy.following)).toBe(following);
		expect(policy.finalReturn).toStrictEqual(finalReturn);
		if (finalReturn) {
			expect(text(policy.body).replace(/\s+/g, " ")).toBe(
				"await mcpCall( config, 't3_thread_organize', { action: 'settle', threadId: detail.thread.threadId }, signal );",
			);
			expect(text(finalReturn)).toBe("return result;");
		}
	},
);

function input(
	root: string,
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

function fixtures(root: string) {
	const mixed = input(root, "github/joins", 1189, [2, -1]);
	const mixedFile = Object.values(mixed.data)[0];
	const branch = {
		start: { line: 1189, column: 4 },
		end: { line: 1189, column: 57 },
	};
	mixedFile.branchMap[0] = {
		type: "if",
		loc: branch,
		locations: [branch, { start: {}, end: {} }],
	};
	mixedFile.statementMap = {
		0: { start: { line: 1189, column: 18 }, end: { line: 1189, column: 57 } },
		1: { start: { line: 1190, column: 18 }, end: { line: 1190, column: 43 } },
	};
	mixedFile.s = { 0: 2, 1: 3 };
	const planner = input(root, "t3/planner", 272, [89, -2]),
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
	plannerFile.s = { 0: 89, 1: 92, 2: 92 };
	return { mixed, planner };
}
const test = baseTest.extend<{
	fixture: {
		root: string;
		mixed: ReturnType<typeof input>;
		planner: ReturnType<typeof input>;
		auditReports: typeof audit;
	};
}>({
	fixture: async ({ task }, use) => {
		const root = mkdtempSync(resolve(tmpdir(), `audit-contract-${task.id}-`));
		// Algorithm controls own their source bytes and policy. Live application
		// pins are checked separately above, so a moved pin cannot mask these tests.
		const source = "export const auditFixture = true;\n";
		const policy: AuditPolicy = {
			"apps/factory/src/adapters/github/joins.ts:1189:4": {
				sourceSHA256: sha(source),
				branch: [1189, 4, 1189, 57],
				body: [1189, 18, 1189, 57],
				following: [1190, 18, 1190, 43],
			},
			"apps/factory/src/adapters/t3/planner.ts:272:4": {
				sourceSHA256: sha(source),
				branch: [272, 4, 285, 5],
				body: [273, 6, 278, 8],
				following: [288, 20, 288, 98],
				finalReturn: [299, 4, 299, 18],
			},
		};
		try {
			for (const name of ["github/joins", "t3/planner"]) {
				const path = resolve(root, `apps/factory/src/adapters/${name}.ts`);
				mkdirSync(resolve(path, ".."), { recursive: true });
				writeFileSync(path, source);
			}
			await use({
				root,
				...fixtures(root),
				auditReports: (inputs, root) => audit(inputs, root, policy),
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
});

test("uncertain arms preserve raw input, maps, denominator and genuine zeros", ({
	fixture: { root, auditReports },
}) => {
	const inputs = [
			input(root, "github/joins", 1189, [549, -310]),
			input(root, "t3/planner", 272, [89, -2]),
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
});

test("measured nonnegative branch counts remain unchanged", ({
	fixture: { root, auditReports },
}) => {
	for (const counts of [
		[4, 0],
		[0, 3],
		[0, 0],
	]) {
		const x = [input(root, "github/joins", 1189, counts)];
		expect(auditReports(x, root)).toStrictEqual({ reports: x, audit: [] });
	}
});

test("rejects unaudited sites and repeated audit families", ({
	fixture: { root, mixed, planner, auditReports },
}) => {
	expect(() => auditReports([mixed, planner, mixed], root)).toThrow(
		/budget|Repeated/,
	);
	expect(() =>
		auditReports([input(root, "github/joins", 99, [1, -1])], root),
	).toThrow(/Unaudited/);
});

test("join estimates a supported false visit without mutating raw input", ({
	fixture: { root, mixed, auditReports },
}) => {
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
});

test("planner publishes a boolean indicator rather than the visit difference", ({
	fixture: { root, planner, auditReports },
}) => {
	const plannerEstimated = auditReports([planner], root);
	expect(
		Object.values(plannerEstimated.reports[0].data)[0].b[0],
		"boolean indicator, not difference3",
	).toStrictEqual([89, 1]);
	expect(plannerEstimated.audit[0].estimate.finalReturn).toBe(92);
});

test("planner return disagreements preserve conservative zero", ({
	fixture: { root, planner, auditReports },
}) => {
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
});

for (const family of ["mixed", "planner"] as const) {
	test(`${family} audited estimates preserve input and measured maps`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
		const unchanged = structuredClone(fixture),
			raw = Object.values(fixture.data)[0],
			out = Object.values(auditReports([fixture], root).reports[0].data)[0];
		for (const key of ["statementMap", "fnMap", "branchMap", "s", "f"] as const)
			expect(out[key]).toStrictEqual(raw[key]);
		expect(fixture).toStrictEqual(unchanged);
	});
}

for (const family of ["mixed", "planner"] as const) {
	test(`${family} true-only visits preserve zero false coverage`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
		// All true calls reach the following statement: no false visit exists.
		const trueOnly = structuredClone(fixture),
			trueFile = Object.values(trueOnly.data)[0];
		trueFile.s[1] = trueFile.b[0][0];
		if (fixture === planner) trueFile.s[2] = trueFile.b[0][0];
		expect(
			Object.values(auditReports([trueOnly], root).reports[0].data)[0].b[0][1],
		).toBe(0);
	});
}

for (const family of ["mixed", "planner"] as const) {
	test(`${family} missing or ambiguous statement evidence preserves zero`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
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
	});
}

for (const family of ["mixed", "planner"] as const) {
	test(`${family} body disagreement prevents a false estimate`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
		const mismatch = structuredClone(fixture);
		const hit = Object.values(mismatch.data)[0].s[0];
		if (typeof hit !== "number")
			throw new Error("Expected numeric fixture counter");
		Object.values(mismatch.data)[0].s[0] = hit + 1;
		expect(auditReports([mismatch], root).audit[0].estimate.reason).toBe(
			"true-body-disagreement",
		);
	});
}

for (const family of ["mixed", "planner"] as const) {
	test(`${family} nonnegative measured alternatives bypass estimation`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
		for (const count of [0, 3]) {
			const measured = structuredClone(fixture);
			Object.values(measured.data)[0].b[0][1] = count;
			expect(
				auditReports([measured], root),
				"measured nonnegative counts untouched",
			).toStrictEqual({ reports: [measured], audit: [] });
		}
	});
}

for (const family of ["mixed", "planner"] as const) {
	test(`${family} corrupt measured counters are rejected`, ({
		fixture: { root, mixed, planner, auditReports },
	}) => {
		const fixture = family === "mixed" ? mixed : planner;
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
	});
}

test("both policy families respect the two-arm audit budget", ({
	fixture: { root, mixed, planner, auditReports },
}) => {
	expect(
		auditReports([mixed, planner], root).audit.filter((a) => a.published === 1)
			.length,
	).toBe(2);
	expect(() => auditReports([mixed, planner, mixed], root)).toThrow(
		/budget|Repeated/,
	);
});

test("negative true arms are never normalized", ({
	fixture: { root, mixed, auditReports },
}) => {
	const corruptTrue = structuredClone(mixed);
	Object.values(corruptTrue.data)[0].b[0] = [-1, 1];
	expect(
		() => auditReports([corruptTrue], root),
		"known-site true arms are never normalized",
	).toThrow(/Unaudited/);
});

for (const family of ["mixed", "planner"] as const)
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
		test(`${family} ${scenario.name} retains conservative coverage`, ({
			fixture: { root, mixed, planner, auditReports },
		}) => {
			const fixture = family === "mixed" ? mixed : planner;

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
		});
	}

test("unavailable or modified source bytes never support estimated coverage", ({
	fixture: { mixed, auditReports },
}) => {
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
});

test("corruption is rejected even when branch counts require no estimation", ({
	fixture: { root, auditReports },
}) => {
	for (const kind of ["s", "f", "b"] as const)
		for (const bad of [
			NaN,
			Infinity,
			"1",
			-0.5,
			...(kind === "b" ? [] : [-1]),
		]) {
			const x = input(root, "github/joins", 1189, [1, 0]);
			Object.values(x.data)[0][kind][0] = kind === "b" ? [1, bad] : bad;
			expect(() => auditReports([x], root)).toThrow(
				/Invalid|invalid|Nonfinite/,
			);
		}
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
