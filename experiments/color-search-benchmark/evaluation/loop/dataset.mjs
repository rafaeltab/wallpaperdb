import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const priorFiles = [
	"perceived-red-001",
	"vibe-grayscale-001",
	"vibe-dark-001",
	"combination-gray-red-001",
	"combination-gray-red-002",
	"precision-shade-001",
	"semantic-red-city-001",
	"proportion-green-001",
	"proportion-green-002",
	"composition-green-red-001",
	"composition-green-red-real-001",
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const pairKey = (left, right) => JSON.stringify([left, right].sort());

// All transitive strict relations are derived from one judgment. They are not
// independent annotations, and there is no relation inside a human tie group.
function pairsFromGroups(groups, uncertainPairs = []) {
	const uncertain = new Set(
		uncertainPairs.map((pair) => pairKey(...pair.wallpaperIds)),
	);
	return groups.flatMap((group, index) =>
		group.flatMap((preferred) =>
			groups
				.slice(index + 1)
				.flat()
				.map((other) => ({
					preferred,
					other,
					uncertain: uncertain.has(pairKey(preferred, other)),
				})),
		),
	);
}

function orderGroups(record) {
	const judgment = record.judgments?.find(
		(item) =>
			item.orderedWallpaperGroups ||
			item.confirmedWallpaperGroups ||
			item.orderedWallpaperIds,
	);
	if (!judgment) throw new Error(`No recognized image ranking in ${record.id}`);
	return (
		judgment.orderedWallpaperGroups ??
		judgment.confirmedWallpaperGroups ??
		judgment.orderedWallpaperIds.map((id) => [id])
	);
}

function normalizeImage(record, sourceFile, batchContext = null) {
	const groups = record.orderedWallpaperIdGroups ?? orderGroups(record);
	const categories = Array.isArray(record.category)
		? record.category
		: [record.category];
	const excludedIds = record.subjectEligibility
		?.filter((item) => item.status === "excluded")
		.map((item) => item.wallpaperId);
	const eligibleIds = record.subjectEligibility
		?.filter((item) => item.status === "eligible")
		.map((item) => item.wallpaperId);
	const conditionalEligibility = record.subjectEligibility?.filter(
		(item) => item.status === "conditional",
	);
	const rawNotes = record.rawAnswer?.notes;
	const examples = record.examples;
	return {
		id: record.caseId ?? record.id,
		category: categories[0],
		categories,
		query: record.query,
		examples,
		judgedIds: examples.map((item) => item.wallpaperId),
		expectedRankedIds: examples
			.map((item) => item.wallpaperId)
			.filter((id) => !excludedIds?.includes(id)),
		...(eligibleIds
			? { eligibleIds, excludedIds, conditionalEligibility }
			: {}),
		rankingCondition:
			record.judgments?.find((item) => item.condition)?.condition ?? null,
		orderGroups: groups,
		preferencePairs: pairsFromGroups(groups, record.explicitPairUncertainty),
		inputKind: examples.some((item) => item.filename?.endsWith(".svg"))
			? "controlled-fixture"
			: "image",
		evaluationGroup: record.evaluationGroup ?? null,
		notes: [...(record.notes ?? []), ...(rawNotes ? [rawNotes] : [])],
		observations: examples
			.filter((item) => item.judgment)
			.map((item) => ({
				id: item.wallpaperId,
				judgment: item.judgment,
			})),
		evidenceContext: {
			quickPass: Boolean(batchContext),
			...(batchContext ? { batchCaveat: batchContext } : {}),
			originalJudgments: record.judgments ?? null,
			rawAnswer: record.rawAnswer ?? null,
			rawUserResponses: record.rawUserResponses ?? [],
			explicitPairUncertainty: record.explicitPairUncertainty ?? [],
			interpretationFlags: record.interpretationFlags ?? [],
			transferCaveats: record.transferCaveats ?? null,
			use: record.use ?? "development evidence",
		},
		sourceFile,
	};
}

function normalizeConceptual(record) {
	const examples = record.examples.map((item) => ({
		...item,
		wallpaperId: `${record.id}/${item.id}`,
	}));
	const mapping = new Map(examples.map((item) => [item.id, item.wallpaperId]));
	const preferencePairs = record.judgments.preferred
		? [
				{
					preferred: mapping.get(record.judgments.preferred),
					other: mapping.get(record.judgments.over),
					uncertain: false,
				},
			]
		: [];
	return {
		id: record.id,
		category: record.category,
		categories: [record.category],
		query: record.query,
		examples,
		judgedIds: examples.map((item) => item.wallpaperId),
		expectedRankedIds: examples.map((item) => item.wallpaperId),
		preferencePairs,
		orderGroups: preferencePairs.length
			? [[preferencePairs[0].preferred], [preferencePairs[0].other]]
			: [],
		inputKind: "conceptual",
		unsupportedReason:
			"Conceptual compositions have no image source; image-backed candidates must report this case unsupported.",
		evaluationGroup: "conceptual-gray-red-composition",
		absoluteRelevance: record.judgments.absolute_relevance,
		notes: [record.intent, record.limits],
		evidenceContext: {
			quickPass: false,
			originalJudgments: record.judgments,
			origin: record.origin,
		},
		sourceFile: "evaluation/cases.json",
	};
}

// Connected components prevent source-image overlaps and explicitly related
// fixture families from being silently split between tuning and validation.
// This records grouping; it does not invent an independent held-out set.
function assignGroups(cases) {
	const parent = cases.map((_, index) => index);
	function find(index) {
		if (parent[index] !== index) parent[index] = find(parent[index]);
		return parent[index];
	}
	const seen = new Map();
	for (const [index, item] of cases.entries()) {
		const keys = item.examples.flatMap((example) => [
			`id:${example.wallpaperId}`,
			...(example.sha256 ? [`sha256:${example.sha256}`] : []),
		]);
		if (item.evaluationGroup) keys.push(`family:${item.evaluationGroup}`);
		for (const key of keys) {
			if (seen.has(key)) parent[find(index)] = find(seen.get(key));
			else seen.set(key, index);
		}
	}
	const components = new Map();
	for (const [index, item] of cases.entries()) {
		const root = find(index);
		if (!components.has(root)) components.set(root, []);
		components.get(root).push(item.id);
	}
	for (const [index, item] of cases.entries()) {
		const relatedCaseIds = components.get(find(index)).toSorted();
		item.groupId = `source-group-${digest(JSON.stringify(relatedCaseIds)).slice(0, 12)}`;
		item.relatedCaseIds = relatedCaseIds;
	}
}

/** Normalize source annotations without changing or assigning human grades. */
export async function loadDataset({ root = defaultRoot, extraImageFiles = [] } = {}) {
	if (!Array.isArray(extraImageFiles) || extraImageFiles.some(file => typeof file !== "string" || !file.trim())) {
		throw new Error("Extra image case files must be an array of nonempty paths.");
	}
	const sourceFiles = [];
	async function read(relativePath) {
		const bytes = await readFile(resolve(root, relativePath));
		sourceFiles.push({ path: relativePath, sha256: digest(bytes) });
		return JSON.parse(bytes.toString("utf8"));
	}
	const conceptual = await read("evaluation/cases.json");
	const cases = conceptual.cases.map(normalizeConceptual);
	for (const name of priorFiles) {
		const path = `evaluation/${name}.json`;
		cases.push(normalizeImage(await read(path), path));
	}
	const batch = await read("evaluation/batch-001-results.json");
	const receiptPath = `evaluation/${batch.sourceSubmission.repositoryCopy}`;
	const receipt = await read(receiptPath);
	const receiptFile = sourceFiles.at(-1);
	if (receiptFile.sha256 !== batch.sourceSubmission.fileSha256) {
		throw new Error(`Raw submission integrity mismatch: ${receiptPath}`);
	}
	// Use the immutable receipt's presented source metadata instead of relying on
	// the live authoring manifest, which might later change for another review.
	const snapshotCases = receipt.batchSnapshot?.cases;
	if (!Array.isArray(snapshotCases))
		throw new Error("Submission receipt has no batchSnapshot cases");
	for (const result of batch.cases) {
		const snapshot = snapshotCases.find((item) => item.id === result.caseId);
		if (!snapshot)
			throw new Error(`Missing presented source case ${result.caseId}`);
		const snapshotExamples = new Map(
			snapshot.examples.map((item) => [item.wallpaperId, item]),
		);
		for (const example of result.examples) {
			const presented = snapshotExamples.get(example.wallpaperId);
			if (
				!presented ||
				presented.sha256 !== example.sha256 ||
				presented.label !== example.label
			) {
				throw new Error(
					`Presented image identity mismatch in ${result.caseId}`,
				);
			}
		}
		cases.push(
			normalizeImage(
				{
					...snapshot,
					...result,
					examples: result.examples.map((item) => ({
						...snapshotExamples.get(item.wallpaperId),
						...item,
					})),
				},
				"evaluation/batch-001-results.json",
				batch.evidenceContext,
			),
		);
	}
	for (const sourceFile of extraImageFiles) {
		cases.push(normalizeImage(await read(sourceFile), sourceFile));
	}
	if (new Set(cases.map((item) => item.id)).size !== cases.length)
		throw new Error("Duplicate logical case IDs");
	for (const item of cases) {
		const ids = new Set(item.judgedIds);
		if (ids.size !== item.judgedIds.length)
			throw new Error(`Duplicate source image in ${item.id}`);
		const ordered = item.orderGroups.flat();
		if (
			new Set(ordered).size !== ordered.length ||
			ordered.some((id) => !ids.has(id))
		) {
			throw new Error(`Invalid human ranking identities in ${item.id}`);
		}
	}
	assignGroups(cases);
	return {
		schemaVersion: 1,
		cases,
		sourceFiles,
		evidenceContext: {
			reviewerCount: 1,
			logicalCaseCount: cases.length,
			independentSampleCount: null,
			quickPass: batch.evidenceContext,
			notes: [
				"Development evidence from one reviewer; related queries and repeated images are not independent samples.",
				"Twenty-four batch rankings retain the quick-review caveat. Earlier records retain their own qualifications.",
				"Five explicitly uncertain pairs are retained in the full score and omitted in a separate sensitivity score.",
				"No numerical relevance grades, confidence weights, score margins or absolute acceptability thresholds are inferred.",
				"Connected source-image and fixture-family groups are recorded for future split design; no held-out split is claimed.",
				...(extraImageFiles.length ? ["Optional follow-up image cases are included in this run. Their case IDs and evidence groups distinguish them from the legacy 37; aggregate accuracy is not directly comparable to a legacy-only run."] : []),
			],
		},
	};
}
