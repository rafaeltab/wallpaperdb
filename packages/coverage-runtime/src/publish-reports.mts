import type { CoverageMapData } from "istanbul-lib-coverage";
import type { Report } from "./contract.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
	isEmptyCoverage,
	normalizeVitestCoverage,
	validateFileCoverage,
} from "./coverage-validation.js";

const require = createRequire(import.meta.url),
	provider = createRequire(require.resolve("@vitest/coverage-v8"));
const istanbul: typeof import("istanbul-lib-coverage") = createRequire(
	import.meta.url,
)("istanbul-lib-coverage");
const report = provider("@vitest/istanbul-lib-report"),
	reporters = provider("istanbul-reports");
export function coverageMap(data: Report | CoverageMapData) {
	const normalized: Report = {};
	for (const [path, input] of Object.entries(data)) {
		const file: unknown = structuredClone(
			"toJSON" in input && typeof input.toJSON === "function"
				? input.toJSON()
				: input,
		);
		normalizeVitestCoverage(file);
		validateFileCoverage(file);
		normalized[path] = isEmptyCoverage(file)
			? { ...file, fnMap: {}, branchMap: {}, f: {}, b: {} }
			: file;
	}
	return istanbul.createCoverageMap(normalized);
}
export async function publishReports(data: Report, directory: string) {
	const map = coverageMap(data);
	await mkdir(directory, { recursive: true });
	// Keep the producer's original maps in tier JSON. Counts are the same ones
	// used by all renderers; format normalization matches the normal CRAP reader.
	await writeFile(directory + "/coverage-final.json", JSON.stringify(data));
	const context = report.createContext({ dir: directory, coverageMap: map });
	for (const name of ["lcovonly", "json-summary", "html"])
		reporters.create(name).execute(context);
	return map;
}
