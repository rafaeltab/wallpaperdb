// PROTOTYPE #416. Seed dependencies/mocks in disposable copies of real test graphs.
// This is boundary-analysis calibration, not mutation testing of application behavior.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./analyzer.mjs";
import { pilot } from "./pilot.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const baseline = pilot.map((selection) => ({
	...selection,
	...analyze({ root: repository, ...selection }),
}));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-pilot-416-"));
const seeded = [];
try {
	for (const { workspace } of pilot) {
		const destination = path.join(root, workspace);
		fs.mkdirSync(destination, { recursive: true });
		for (const item of [
			"src",
			"test",
			"tsconfig.json",
			"quality.config.json",
		]) {
			const original = path.join(repository, workspace, item);
			if (fs.existsSync(original))
				fs.cpSync(original, path.join(destination, item), {
					recursive: true,
					filter: (file) =>
						fs.statSync(file).isDirectory() || /\.(?:tsx?|json)$/.test(file),
				});
		}
		fs.symlinkSync(
			path.join(repository, workspace, "node_modules"),
			path.join(destination, "node_modules"),
			"dir",
		);
	}
	const cases = [
		{
			name: "backend private import",
			workspace: "apps/gateway",
			append: 'import "../src/capabilities/catalogue/implementation.js";',
			code: "private-entry",
		},
		{
			name: "backend helper re-export",
			workspace: "apps/gateway",
			append: 'import "./prototype-helper";',
			helper:
				'export * from "../src/capabilities/catalogue/implementation.js";',
			code: "private-entry",
		},
		{
			name: "backend production adapter via existing helper",
			workspace: "apps/gateway",
			append: 'import "./helpers/controlled-search.js";',
			code: "capability-infrastructure",
		},
		{
			name: "backend subject mock",
			workspace: "apps/gateway",
			append:
				'import { vi } from "vitest"; vi.mock("../src/capabilities/catalogue/index.js", () => ({}));',
			code: "subject-mock",
		},
		{
			name: "frontend private alias",
			workspace: "apps/web",
			append: 'import "@/features/authentication/policy";',
			code: "private-entry",
		},
		{
			name: "frontend subject mock",
			workspace: "apps/web",
			append:
				'import { vi } from "vitest"; vi.mock("@/features/authentication", () => ({}));',
			code: "subject-mock",
		},
		{
			name: "known miss: destructured mock",
			workspace: "apps/gateway",
			append:
				'import { vi } from "vitest"; const { mock } = vi; mock("../src/capabilities/catalogue/index.js", () => ({}));',
			violation: true,
		},
		{
			name: "known miss: unlisted infrastructure",
			workspace: "apps/gateway",
			append: 'import "pg";',
			violation: true,
		},
		{
			name: "known false positive: unused helper loader",
			workspace: "apps/gateway",
			append: 'import "./prototype-helper";',
			helper: 'export const unused = () => import("nats");',
			violation: false,
			code: "capability-infrastructure",
		},
	];
	for (const control of cases) {
		const selection = pilot.find(
			(item) => item.workspace === control.workspace,
		);
		const entry = selection.tests[0];
		const filename = path.join(root, control.workspace, entry.file);
		const original = fs.readFileSync(
			path.join(repository, control.workspace, entry.file),
			"utf8",
		);
		fs.writeFileSync(filename, `${original}\n${control.append}\n`);
		if (control.helper)
			fs.writeFileSync(
				path.join(path.dirname(filename), "prototype-helper.ts"),
				control.helper,
			);
		const result = analyze({ root, ...selection, tests: [entry] });
		const detected = result.diagnostics.some((d) => d.severity === "error");
		assert.equal(detected, Boolean(control.code), control.name);
		if (control.code)
			assert.ok(
				result.diagnostics.some((d) => d.code === control.code),
				control.name,
			);
		seeded.push({
			name: control.name,
			violation: control.violation ?? true,
			detected,
			...result,
		});
		fs.writeFileSync(filename, original);
	}
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
const actual = baseline.flatMap((r) =>
	r.tests.map((entry) => ({
		name: `${r.workspace}/${entry.file}`,
		reason: entry.reason,
		violation: false,
		detected: r.diagnostics.some(
			(d) => d.test === entry.file && d.severity === "error",
		),
	})),
);
const samples = [...actual, ...seeded];
const counts = {
	truePositive: samples.filter((c) => c.violation && c.detected).length,
	falsePositive: samples.filter((c) => !c.violation && c.detected).length,
	trueNegative: samples.filter((c) => !c.violation && !c.detected).length,
	falseNegative: samples.filter((c) => c.violation && !c.detected).length,
};
console.log(
	JSON.stringify(
		{
			baseline,
			seeded,
			counts,
			falsePositiveRate:
				counts.falsePositive / (counts.falsePositive + counts.trueNegative),
			missedCaseRate:
				counts.falseNegative / (counts.falseNegative + counts.truePositive),
			peakRssMiB: process.resourceUsage().maxRSS / 1024,
			note: "Hand-classified purposive sample, not a repository-wide accuracy estimate. Seeded controls are analyzed, not run as application tests.",
		},
		null,
		2,
	),
);
