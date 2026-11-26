import { repositoryRoot } from "../src/repository-root.mjs";
import { expect } from "vitest";
import { repositoryConfiguration } from "../src/repository-root.mjs";
const { estimates } = await repositoryConfiguration();
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";

import { resolve } from "node:path";

import { coverageMap, publishReports } from "../src/publish-reports.mjs";

import { auditReports as audit } from "../src/report-audit.mjs";
const auditReports: typeof audit = (inputs, root) =>
	audit(inputs, root, estimates);

import { test } from "vitest";
test("publish-reports preserves the coverage contract", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "coverage-publication-"));
	try {
		const path = resolve(directory, "original.ts"),
			loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
		const measured = {
			path,
			statementMap: {
				0: loc,
				1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
			},
			fnMap: { 0: { name: "run", loc, decl: loc } },
			branchMap: { 0: { type: "if", loc, locations: [loc, loc] } },
			s: { 0: 2, 1: 0 },
			f: { 0: 2 },
			b: { 0: [2, 0] },
		};
		const merged = coverageMap({ [path]: measured });
		merged.merge(
			coverageMap({
				[path]: {
					...measured,
					s: { 0: 1, 1: 0 },
					f: { 0: 1 },
					b: { 0: [1, 0] },
				},
			}),
		);
		await publishReports(merged.toJSON(), `${directory}/merged`);
		const output = JSON.parse(
			await readFile(`${directory}/merged/coverage-final.json`, "utf8"),
		);
		expect(output[path].s).toStrictEqual({ 0: 3, 1: 0 });
		expect(output[path].b).toStrictEqual({ 0: [3, 0] });
		const lcov = await readFile(`${directory}/merged/lcov.info`, "utf8");
		assert.match(lcov, /DA:1,3/);
		assert.match(lcov, /DA:2,0/);
		assert.match(lcov, /BRDA:1,0,1,0/);
		const empty = {
			...measured,
			all: true,
			fnMap: { 0: { name: "(empty-report)", loc, decl: loc } },
			s: { 0: 0, 1: 0 },
			f: { 0: 0 },
			b: { 0: [0, 0] },
		};
		await publishReports({ [path]: empty }, `${directory}/empty`);
		const unloaded = await readFile(`${directory}/empty/lcov.info`, "utf8");
		assert.match(unloaded, /DA:1,0/);
		assert.match(unloaded, /DA:2,0/);
		assert.match(unloaded, /LF:2/);
		assert.match(unloaded, /FNF:0/);
		assert.match(unloaded, /BRF:0/);
		await expect(() =>
			publishReports(
				{ [path]: { ...measured, s: { 0: NaN, 1: 0 } } },
				`${directory}/invalid`,
			),
		).rejects.toThrow(/Invalid coverage counters/);
		await mkdir(`${directory}/coverage`);
		await writeFile(
			`${directory}/coverage/coverage-summary.json`,
			await readFile(`${directory}/merged/coverage-summary.json`),
		);
		await writeFile(
			`${directory}/coverage/compiled-manifest.json`,
			JSON.stringify({
				workspaces: ["apps/factory"],
				audit: [{ published: 1 }, { published: 0 }],
			}),
		);
		const summary = spawnSync(
			process.execPath,
			[resolve(repositoryRoot(), "scripts/coverage-summary.ts")],
			{ cwd: directory, encoding: "utf8" },
		);
		expect(summary.status, summary.stderr).toBe(0);
		assert.match(
			summary.stdout,
			/estimated-covered: 1; conservatively uncovered: 1/,
			"summary must distinguish estimated positives from zero fallbacks",
		);
		const factory = resolve(
				repositoryRoot(),
				"apps/factory/src/adapters/github/joins.ts",
			),
			decision = {
				start: { line: 1230, column: 4 },
				end: { line: 1230, column: 57 },
			};
		const raw = {
			[factory]: {
				path: factory,
				statementMap: {
					0: {
						start: { line: 1230, column: 18 },
						end: { line: 1230, column: 57 },
					},
					1: {
						start: { line: 1231, column: 18 },
						end: { line: 1231, column: 43 },
					},
				},
				s: { 0: 2, 1: 3 },
				fnMap: {},
				f: {},
				branchMap: {
					0: {
						type: "if",
						loc: decision,
						locations: [decision, { start: {}, end: {} }],
					},
				},
				b: { 0: [2, -1] },
			},
		};
		const before = structuredClone(raw),
			audited = auditReports(
				[{ id: "publication-control", data: raw }],
				repositoryRoot(),
			);
		await publishReports(audited.reports[0].data, `${directory}/estimated`);
		const estimatedJSON = JSON.parse(
			await readFile(`${directory}/estimated/coverage-final.json`, "utf8"),
		);
		expect(estimatedJSON[factory].b[0]).toStrictEqual([2, 1]);
		expect(estimatedJSON[factory].branchMap).toStrictEqual(
			raw[factory].branchMap,
		);
		expect(raw, "publication mutated raw evidence").toStrictEqual(before);
		assert.match(
			await readFile(`${directory}/estimated/lcov.info`, "utf8"),
			/BRDA:1230,0,1,1/,
		);
		const estimatedSummary = JSON.parse(
			await readFile(`${directory}/estimated/coverage-summary.json`, "utf8"),
		);
		expect(estimatedSummary.total.branches.total).toBe(2);
		expect(estimatedSummary.total.branches.covered).toBe(2);
		console.log(
			"Merged JSON and LCOV agree; unloaded zero lines retained; invalid counters rejected",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
