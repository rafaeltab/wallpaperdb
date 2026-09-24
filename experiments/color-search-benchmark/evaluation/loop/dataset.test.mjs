import assert from "node:assert/strict";
import test from "node:test";
import { loadDataset } from "./dataset.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { searchQuery } from "./runner.mjs";
import { interpretQuery } from "../../exploration/query.mjs";
import { buildCutoffQuery } from "../../exploration/methods-cutoff.mjs";

test("normalizes 37 logical cases once, preserving the 24 quick-pass judgments", async () => {
	const dataset = await loadDataset();
	assert.equal(dataset.cases.length, 37);
	assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 37);
	assert.equal(
		dataset.cases.filter((item) => item.evidenceContext.quickPass).length,
		24,
	);
	assert.equal(
		dataset.cases.filter((item) => item.id === "composition-green-red-real-002")
			.length,
		1,
	);
	assert.equal(dataset.evidenceContext.independentSampleCount, null);
	assert.ok(
		dataset.sourceFiles.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)),
	);
});

test("an optional shade follow-up adds exactly one explicit pair without altering legacy cases", async () => {
	const sourceFile = "evaluation/perceived-red-pagoda-001.json";
	const baseline = await loadDataset();
	const enriched = await loadDataset({ extraImageFiles: [sourceFile] });
	assert.equal(enriched.cases.length, 38);
	const withoutSplitGroups = ({ groupId, relatedCaseIds, ...record }) => record;
	assert.deepEqual(enriched.cases.slice(0, 37).map(withoutSplitGroups), baseline.cases.map(withoutSplitGroups));
	assert.equal(enriched.sourceFiles.length, baseline.sourceFiles.length + 1);
	const source = await readFile(new URL("../perceived-red-pagoda-001.json", import.meta.url));
	assert.deepEqual(enriched.sourceFiles.at(-1), {
		path: sourceFile,
		sha256: createHash("sha256").update(source).digest("hex"),
	});
	const followup = enriched.cases.at(-1);
	assert.equal(followup.id, "perceived-red-pagoda-001");
	assert.equal(followup.evaluationGroup, "shade-followup-pagoda");
	assert.deepEqual(followup.preferencePairs, [{
		preferred: "madness-wallhaven-ogg7ql", other: "wallpaper-031", uncertain: false,
	}]);
	assert.equal(followup.query.preciseHex, "#ff0000");
	assert.equal(followup.evidenceContext.quickPass, false);
	assert.equal(followup.evidenceContext.rawUserResponses.length, 2);
	assert.match(JSON.stringify(followup.evidenceContext), /hue has to be more similar to count/);
	assert.match(JSON.stringify(followup.evidenceContext), /inferred.*ongoing/i);
	assert.match(JSON.stringify(followup.evidenceContext), /not blind/i);
	assert.deepEqual(followup.observations, []);
	assert.equal(followup.numericGrades, undefined);
	assert.equal(followup.numericConfidence, undefined);
	assert.equal(followup.absoluteRelevance, undefined);
	for (const existing of enriched.cases.slice(0, 37).filter(item => item.judgedIds.includes("wallpaper-031"))) {
		assert.equal(existing.groupId, followup.groupId);
	}
	assert.equal((await loadDataset()).cases.length, 37);
});

test("optional image-case inputs reject invalid lists and duplicated logical cases", async () => {
	for (const extraImageFiles of [null, "evaluation/perceived-red-pagoda-001.json", [null], [""]]) {
		await assert.rejects(loadDataset({ extraImageFiles }), /extra image case/i);
	}
	await assert.rejects(loadDataset({ extraImageFiles: ["evaluation/perceived-red-001.json"] }), /duplicate logical case/i);
	await assert.rejects(loadDataset({ extraImageFiles: ["evaluation/perceived-red-pagoda-001.json", "evaluation/perceived-red-pagoda-001.json"] }), /duplicate logical case/i);
});

test("the optional red case crosses the feedback-to-search boundary and compiles all compared methods", async () => {
	const { cases } = await loadDataset({ extraImageFiles: ["evaluation/perceived-red-pagoda-001.json"] });
	const followup = cases.find(item => item.id === "perceived-red-pagoda-001");
	const normalized = searchQuery(followup.query);
	assert.equal(normalized.text, "red");
	assert.equal(normalized.swatchHex, "#ff0000");
	assert.equal(normalized.intent, undefined);
	const compiled = interpretQuery(normalized);
	assert.equal(compiled.supported, true);
	assert.equal(compiled.mode, "vibe");
	assert.equal(compiled.targets.length, 1);
	assert.equal(compiled.targets[0].color, "#ff0000");
	for (const method of ["cutoff-all-levels", "cutoff-shade-all-levels", "cutoff-shade-hue-all-levels"]) {
		const body = buildCutoffQuery({ method, query: normalized, parameters: { bucketCount: 64, qualityCurve: "power", cutoffBlendExponent: 0 } });
		assert.ok(body.query);
	}
});

test("human ties impose no pair order and conceptual acceptable alternatives gain no invented grades", async () => {
	const { cases } = await loadDataset();
	const precision = cases.find((item) => item.id === "precision-shade-001");
	assert.equal(precision.preferencePairs.length, 5);
	assert.ok(
		!precision.preferencePairs.some((pair) =>
			[pair.preferred, pair.other].every((id) =>
				precision.orderGroups[0].includes(id),
			),
		),
	);
	const conceptual = cases.find((item) => item.id === "composition-002");
	assert.equal(conceptual.inputKind, "conceptual");
	assert.match(conceptual.unsupportedReason, /no image/i);
	assert.deepEqual(conceptual.preferencePairs, []);
	assert.deepEqual(conceptual.orderGroups, []);
	assert.equal(conceptual.absoluteRelevance.A, "good");
	assert.equal(conceptual.numericGrades, undefined);
});

test("preserves five explicitly uncertain pairs without promoting quick-pass caveats into numeric confidence", async () => {
	const { cases } = await loadDataset();
	const uncertain = cases.flatMap((item) =>
		item.preferencePairs.filter((pair) => pair.uncertain),
	);
	assert.equal(uncertain.length, 5);
	assert.ok(cases.every((item) => item.numericConfidence === undefined));
	const green = cases.find((item) => item.id === "perceived-green-batch-001");
	assert.ok(
		green.preferencePairs.some(
			(pair) =>
				pair.uncertain &&
				[pair.preferred, pair.other].includes("wallpaper-083") &&
				[pair.preferred, pair.other].includes("wallpaper-093"),
		),
	);
});

test("semantic exclusion remains distinct from a conditional ranking assumption", async () => {
	const { cases } = await loadDataset();
	const semantic = cases.find((item) => item.id === "semantic-red-city-001");
	assert.deepEqual(semantic.excludedIds, ["wallpaper-082"]);
	assert.deepEqual(semantic.eligibleIds, ["wallpaper-022", "wallpaper-029"]);
	assert.equal(semantic.conditionalEligibility[0].wallpaperId, "wallpaper-027");
	assert.match(semantic.rankingCondition, /assuming c matches/i);
	assert.ok(semantic.expectedRankedIds.includes("wallpaper-027"));
	assert.ok(!semantic.expectedRankedIds.includes("wallpaper-082"));
	assert.ok(
		!semantic.preferencePairs.some((pair) =>
			[pair.preferred, pair.other].includes("wallpaper-082"),
		),
	);
});

test("query amounts and raw observations are preserved, and shared-image cases have the same split group", async () => {
	const { cases } = await loadDataset();
	const partial = cases.find(
		(item) => item.id === "composition-green-red-real-002",
	);
	assert.deepEqual(
		partial.query.colorTargets.map((target) => target.targetImagePercent),
		[40, 40],
	);
	assert.equal(partial.query.unspecifiedRemainderPercent, 20);
	assert.equal(
		partial.groupId,
		cases.find((item) => item.id === "composition-green-red-real-001").groupId,
	);
	const blind = cases.find((item) => item.id === "proportion-green-002");
	assert.equal(blind.orderGroups[0][0], "proportion-green-002-f");
	assert.match(JSON.stringify(blind.evidenceContext), /tentative/);
	assert.equal(
		blind.groupId,
		cases.find((item) => item.id === "proportion-green-001").groupId,
	);
});
