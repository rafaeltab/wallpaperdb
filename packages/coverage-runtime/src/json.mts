import assert from "node:assert/strict";
import type { FileCoverageData } from "istanbul-lib-coverage";
import { z } from "zod";
import {
	isRecord,
	normalizeVitestCoverage,
	validateFileCoverage,
} from "./coverage-validation.js";

// Validate raw shape without replacing serialized Vitest ranges or negative
// branch evidence. Publication separately requires nonnegative audited counts.
const rawFile = z.custom<FileCoverageData>((value: unknown) => {
	try {
		const copy: unknown = structuredClone(value);
		assert(isRecord(copy));
		for (const kind of ["s", "f", "b"]) {
			const counts: unknown = copy[kind];
			assert(isRecord(counts));
			for (const [id, count] of Object.entries(counts)) {
				if (kind === "b") {
					assert(
						Array.isArray(count) &&
							count.every(
								(hit: unknown) =>
									typeof hit === "number" && Number.isSafeInteger(hit),
							),
					);
					counts[id] = count.map(Math.abs);
				} else
					assert(
						typeof count === "number" &&
							Number.isSafeInteger(count) &&
							count >= 0,
					);
			}
		}
		normalizeVitestCoverage(copy);
		validateFileCoverage(copy);
		return true;
	} catch {
		return false;
	}
}, "Invalid raw coverage file");
export const reportSchema = z.record(rawFile);
export const sourceIdentitiesSchema = z.record(z.string());
export const tierSchema = z.object({
	id: z.string(),
	workspace: z.string(),
	coverage: z.boolean(),
	runtime: z.string(),
	script: z.string(),
	config: z.string(),
	args: z.array(z.string()),
	strategy: z.enum(["compiled-native", "source-vite"]),
	containers: z.boolean(),
});
export const inventorySchema = z.object({
	workspaces: z.array(z.object({ directory: z.string(), name: z.string() })),
	tiers: z.array(tierSchema),
});
const pointSchema = z.object({ line: z.number(), column: z.number() });
const rangeSchema = z.object({ start: pointSchema, end: pointSchema });
const estimateSchema = z.object({
	trueBody: z.number(),
	following: z.number().nullable(),
	difference: z.number().nullable(),
	bodyStatement: z.number().nullable().optional(),
	sourceSHA256: z.string().optional(),
	finalReturn: z.number().nullable().optional(),
	reason: z.string().optional(),
});
const auditEntrySchema = z.object({
	report: z.string(),
	file: z.string(),
	branch: z.string(),
	arm: z.number(),
	location: rangeSchema,
	raw: z.number(),
	published: z.number(),
	classification: z.string(),
	estimate: estimateSchema,
	policy: z.string(),
});
export const receiptSchema = z.object({
	identity: z.string(),
	id: z.string(),
	revision: z.string(),
	coverage: z.boolean(),
	passed: z.boolean(),
	workspace: z.string(),
	sourceHashes: sourceIdentitiesSchema,
	raw: reportSchema.nullable(),
	data: reportSchema.nullable(),
	audit: z.array(auditEntrySchema),
	generated: z
		.record(
			z.object({
				sourceBase64: z.string(),
				sha256: z.string(),
				coverage: rawFile,
			}),
		)
		.default({}),
	reportHash: z.string(),
	rawHash: z.string(),
});
export const selectionSchema = z.object({
	originalCoverage: z
		.object({
			reportsDirectory: z.string().optional(),
			include: z.array(z.string()).optional(),
			exclude: z.array(z.string()).optional(),
		})
		.optional(),
});
export async function readJson(path: string): Promise<unknown> {
	const { readFile } = await import("node:fs/promises");
	return JSON.parse(await readFile(path, "utf8"));
}

export const sourceMapSchema = z
	.object({
		version: z.literal(3),
		sources: z.array(z.string().nullable()),
		sourcesContent: z.array(z.string().nullable()).optional(),
		mappings: z.string(),
		names: z.array(z.string()),
		file: z.string().nullable().optional(),
		sourceRoot: z.string().optional(),
	})
	.passthrough();
export const generatedRecordSchema = z.object({
	url: z.string(),
	code: z.string(),
});
export const workspaceManifestSchema = z.object({
	name: z.string().optional(),
	scripts: z.record(z.string()).optional(),
});
