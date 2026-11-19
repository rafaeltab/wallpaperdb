import type {
	AuditEntry,
	ReportInput,
	AuditPolicy,
	Estimate,
} from "./contract.mjs";
import type {
	FileCoverageData,
	Range,
	BranchMapping,
} from "istanbul-lib-coverage";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

// Deliberately bounded to the two observed decisions. Moving these sites or
// encountering another anomaly requires review, rather than silently expanding
// a generic sanitizer. Estimated hits are boolean indicators, not exact counts.
function matches(span: Range | undefined, expected: number[]) {
	return (
		span?.start?.line === expected[0] &&
		span.start.column === expected[1] &&
		span.end?.line === expected[2] &&
		span.end.column === expected[3]
	);
}
function measurement(file: FileCoverageData, span: number[]) {
	const entries = Object.entries(file.statementMap || {}).filter(([, loc]) =>
		matches(loc, span),
	);
	if (entries.length !== 1) return undefined;
	const value = file.s[entries[0][0]];
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function estimateArm(
	file: FileCoverageData,
	path: string,
	branch: BranchMapping,
	counts: number[],
	site: string,
	estimates: AuditPolicy,
) {
	const policy = estimates[site],
		evidence: Estimate = {
			trueBody: counts[0],
			following: null,
			difference: null,
		};
	if (!policy || !matches(branch.loc, policy.branch))
		return { ...evidence, reason: "branch-identity-mismatch" };
	let sourceSHA256: string;
	try {
		sourceSHA256 = createHash("sha256")
			.update(readFileSync(path))
			.digest("hex");
	} catch {
		return { ...evidence, reason: "source-unavailable" };
	}
	if (sourceSHA256 !== policy.sourceSHA256)
		return { ...evidence, sourceSHA256, reason: "source-identity-mismatch" };
	const body = measurement(file, policy.body),
		following = measurement(file, policy.following);
	Object.assign(evidence, {
		sourceSHA256,
		bodyStatement: body ?? null,
		following: following ?? null,
		difference: following === undefined ? null : following - counts[0],
	});
	if (body === undefined || following === undefined)
		return { ...evidence, reason: "missing-or-ambiguous-statement" };
	if (body !== counts[0])
		return { ...evidence, reason: "true-body-disagreement" };
	if (policy.finalReturn) {
		const finalReturn = measurement(file, policy.finalReturn);
		evidence.finalReturn = finalReturn ?? null;
		if (finalReturn === undefined)
			return { ...evidence, reason: "missing-or-ambiguous-return" };
		if (finalReturn !== following)
			return { ...evidence, reason: "downstream-return-disagreement" };
	}
	return {
		...evidence,
		reason:
			following > counts[0]
				? "positive-neighbor-difference"
				: "no-positive-neighbor-difference",
	};
}
export function auditReports(
	inputs: ReportInput[],
	root: string,
	estimates: AuditPolicy = {},
) {
	const reports = inputs.map((input) => structuredClone(input)),
		audit: AuditEntry[] = [],
		seen = new Set();
	for (const { id, data } of reports)
		for (const [path, file] of Object.entries(data)) {
			assert.equal(file.path, path, "Coverage key/path mismatch");
			for (const kind of ["s", "f", "b"] as const) {
				assert.ok(
					file[kind] && typeof file[kind] === "object",
					`Missing ${kind} counters`,
				);
				for (const [key, value] of Object.entries(file[kind])) {
					const counts = kind === "b" ? value : [value];
					assert.ok(Array.isArray(counts), "Invalid branch counters");
					for (let arm = 0; arm < counts.length; arm++) {
						const count: number = counts[arm];
						assert.ok(
							Number.isSafeInteger(count),
							`Nonfinite/nonnumeric/invalid ${kind} count: ${path}`,
						);
						if (count >= 0) continue;
						assert.equal(kind, "b", `Invalid ${kind} count: ${path}`);
						const branch = file.branchMap[key],
							point = branch?.loc?.start;
						const site = `${relative(root, path).replaceAll("\\", "/")}:${point?.line}:${point?.column}`;
						assert.ok(
							branch?.type === "if" &&
								arm === 1 &&
								counts.length === 2 &&
								Object.hasOwn(estimates, site),
							`Unaudited negative branch: ${site}`,
						);
						assert.ok(
							audit.length < 2,
							"Negative branch audit budget exceeded (maximum2 arms)",
						);
						assert.ok(
							!seen.has(site),
							`Repeated negative branch site: ${site}`,
						);
						seen.add(site);
						const estimate = estimateArm(
								file,
								path,
								branch,
								counts,
								site,
								estimates,
							),
							published =
								estimate.reason === "positive-neighbor-difference" ? 1 : 0;
						audit.push({
							report: id,
							file: path,
							branch: key,
							arm,
							location: structuredClone(branch.loc),
							raw: count,
							published,
							classification: published
								? "estimated-covered"
								: "conservatively-uncovered",
							estimate,
							policy: published
								? "estimated covered indicator; not an exact corrected count"
								: "uncertain arm conservatively uncovered; not an exact corrected count",
						});
						counts[arm] = published;
					}
				}
			}
		}
	return { reports, audit };
}
