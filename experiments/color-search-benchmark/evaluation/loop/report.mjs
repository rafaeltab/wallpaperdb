/** Standalone reports for measured runs. No method selection or combined score. */
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const percent = (value) =>
	finite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
const milliseconds = (value) =>
	finite(value) ? `${value.toFixed(2)} ms` : "n/a";
const points = (value) =>
	finite(value)
		? `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`
		: "n/a";
const signedMs = (value) =>
	finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)} ms` : "n/a";
const difference = (current, previous) =>
	finite(current) && finite(previous) ? current - previous : null;
const canonical = (value) => JSON.stringify(normalize(value));
function normalize(value) {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, normalize(value[key])]),
		);
	return value;
}
const same = (a, b) => canonical(a) === canonical(b);
const present = (value) => value !== undefined && value !== null;
const sorted = (values) => [...(values ?? [])].sort();
const summaryAgreement = (candidate) =>
	candidate?.summary?.accuracy?.allPairs?.queryMacroAgreement;
const caseAgreement = (row) => row?.accuracy?.allPairs?.agreement;

function requireSame(reasons, current, previous, name) {
	if (!present(current) || !present(previous))
		reasons.push(`${name} metadata is missing`);
	else if (!same(current, previous)) reasons.push(`${name} differs`);
}

function evidenceCompatibility(run, previous) {
	const reasons = [];
	requireSame(reasons, run.schemaVersion, previous.schemaVersion, "Run schema");
	requireSame(
		reasons,
		run.dataset?.hash,
		previous.dataset?.hash,
		"Dataset fingerprint",
	);
	requireSame(
		reasons,
		run.dataset?.corpusHash,
		previous.dataset?.corpusHash,
		"Corpus fingerprint",
	);
	requireSame(
		reasons,
		run.dataset?.sourceHashes,
		previous.dataset?.sourceHashes,
		"Judgment source fingerprints",
	);
	return { comparable: reasons.length === 0, reasons };
}

// A changed ranking is the experiment; changed assessed evidence is a different denominator.
function assessedEvidence(row) {
	return {
		caseId: row.caseId,
		metricPolicy: row.accuracy?.metricPolicy,
		assessedPairs: row.accuracy?.allPairs?.assessedPairs,
		totalPairs: row.accuracy?.allPairs?.totalPairs,
		expectedIds: sorted(row.accuracy?.coverage?.expectedIds),
		missingIds: sorted(row.accuracy?.coverage?.missingIds),
	};
}

function candidateAssessedEvidence(candidate) {
	return (candidate?.cases ?? [])
		.map(assessedEvidence)
		.sort((a, b) => a.caseId.localeCompare(b.caseId));
}

function timedAccuracyComparison(run, previous, current, before, evidence) {
	const reasons = [...evidence.reasons];
	requireSame(
		reasons,
		run.workload?.limit,
		previous.workload?.limit,
		"Timed result limit",
	);
	if (!current.summary?.timedAccuracy || !before.summary?.timedAccuracy)
		reasons.push("Timed-search accuracy is unavailable");
	const signature = (candidate) =>
		candidateAssessedEvidence({
			cases: (candidate.cases ?? []).map((row) => ({
				...row,
				accuracy: row.timedAccuracy,
			})),
		});
	if (!same(signature(current), signature(before)))
		reasons.push("Timed assessed cases/pairs differ");
	return {
		comparable: reasons.length === 0,
		reasons,
		delta: reasons.length
			? null
			: difference(
					current.summary?.timedAccuracy?.allPairs?.queryMacroAgreement,
					before.summary?.timedAccuracy?.allPairs?.queryMacroAgreement,
				),
	};
}

function timingCompatibility(run, previous, current, before, evidence) {
	const reasons = [...evidence.reasons];
	requireSame(reasons, run.workload, previous.workload, "Workload");
	requireSame(
		reasons,
		run.environment,
		previous.environment,
		"Runtime/hardware fingerprint",
	);
	for (const key of [
		"node",
		"platform",
		"cpuCount",
		"cpuModel",
		"totalMemoryBytes",
	]) {
		if (
			!present(run.environment?.[key]) ||
			!present(previous.environment?.[key])
		)
			reasons.push(`Runtime/hardware ${key} is missing`);
	}
	requireSame(
		reasons,
		current.execution,
		before.execution,
		"Execution class/backend environment",
	);
	if (!current.execution?.kind || !before.execution?.kind)
		reasons.push("Execution kind is missing");
	const backendKind = /opensearch|clickhouse/i.exec(`${current.execution?.kind} ${before.execution?.kind}`)?.[0].toLowerCase();
	if (backendKind) {
		for (const key of ["version", "topology"]) {
			if (
				!present(current.execution?.[key]) ||
				!present(before.execution?.[key])
			)
				reasons.push(`${backendKind === "clickhouse" ? "ClickHouse" : "OpenSearch"} ${key} is missing`);
		}
	}
	const currentCases = current.cases ?? [];
	const previousCases = before.cases ?? [];
	const measuredCases = (rows) =>
		rows
			.filter(
				(row) => row.status === "ok" && row.performance?.samplesMs?.length,
			)
			.map((row) => ({
				caseId: row.caseId,
				samples: row.performance.samplesMs.length,
			}))
			.sort((a, b) => a.caseId.localeCompare(b.caseId));
	if (!same(measuredCases(currentCases), measuredCases(previousCases)))
		reasons.push("Timed case/sample coverage differs");
	if (
		!current.summary?.performance?.samplesMs?.length ||
		!before.summary?.performance?.samplesMs?.length
	)
		reasons.push("Measured latency samples are unavailable");
	if (
		current.summary?.performance?.failures > 0 ||
		before.summary?.performance?.failures > 0
	)
		reasons.push("Warmup or measured searches failed");
	return { comparable: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Configuration and source changes remain comparable: they are optimization inputs. */
export function compareRuns(run, previous) {
	if (!previous) return null;
	const accuracy = evidenceCompatibility(run, previous);
	const oldCandidates = new Map(
		(previous.candidates ?? []).map((candidate) => [candidate.id, candidate]),
	);
	const candidates = (run.candidates ?? []).map((current) => {
		const before = oldCandidates.get(current.id);
		oldCandidates.delete(current.id);
		if (!before)
			return {
				id: current.id,
				status: "new",
				accuracy: {
					comparable: false,
					reasons: ["No previous candidate with this ID"],
					delta: null,
				},
				performance: {
					comparable: false,
					reasons: ["No previous candidate with this ID"],
					p95DeltaMs: null,
				},
				cases: [],
			};
		const accuracyReasons = [...accuracy.reasons];
		if (
			!same(
				candidateAssessedEvidence(current),
				candidateAssessedEvidence(before),
			)
		)
			accuracyReasons.push(
				"Assessed cases/pairs differ; compare coverage and individual cases",
			);
		const beforeCases = new Map(
			(before.cases ?? []).map((row) => [row.caseId, row]),
		);
		const cases = (current.cases ?? []).map((row) => {
			const old = beforeCases.get(row.caseId);
			beforeCases.delete(row.caseId);
			const reasons = [...accuracy.reasons];
			if (!old) reasons.push("New case");
			else {
				if (row.status !== "ok" || old.status !== "ok")
					reasons.push(`Case status: ${old.status} → ${row.status}`);
				if (!same(assessedEvidence(row), assessedEvidence(old)))
					reasons.push("Assessed pairs differ");
			}
			const delta = reasons.length
				? null
				: difference(caseAgreement(row), caseAgreement(old));
			return {
				caseId: row.caseId,
				status: old ? "matched" : "new",
				previousStatus: old?.status,
				currentStatus: row.status,
				previousAgreement: caseAgreement(old) ?? null,
				currentAgreement: caseAgreement(row) ?? null,
				comparable: reasons.length === 0,
				reasons,
				delta,
			};
		});
		for (const old of beforeCases.values())
			cases.push({
				caseId: old.caseId,
				status: "removed",
				comparable: false,
				reasons: ["Removed case"],
				delta: null,
				previousAgreement: caseAgreement(old) ?? null,
				currentAgreement: null,
			});
		const performance = timingCompatibility(
			run,
			previous,
			current,
			before,
			accuracy,
		);
		return {
			id: current.id,
			status: "matched",
			configurationChanged: !same(current.configuration, before.configuration),
			sourceChanged: !same(current.sourceHashes, before.sourceHashes),
			accuracy: {
				comparable: accuracyReasons.length === 0,
				reasons: accuracyReasons,
				delta: accuracyReasons.length
					? null
					: difference(summaryAgreement(current), summaryAgreement(before)),
			},
			timedAccuracy: timedAccuracyComparison(
				run,
				previous,
				current,
				before,
				accuracy,
			),
			performance: {
				...performance,
				p95DeltaMs: performance.comparable
					? difference(
							current.summary?.performance?.p95Ms,
							before.summary?.performance?.p95Ms,
						)
					: null,
			},
			cases,
		};
	});
	for (const old of oldCandidates.values())
		candidates.push({
			id: old.id,
			status: "removed",
			accuracy: {
				comparable: false,
				reasons: ["Candidate absent from current run"],
				delta: null,
			},
			performance: {
				comparable: false,
				reasons: ["Candidate absent from current run"],
				p95DeltaMs: null,
			},
			cases: [],
		});
	return { previousRunId: previous.id, accuracy, candidates };
}

const queryText = (row) => {
	const text =
		typeof row.query === "string"
			? row.query
			: (row.query?.text ??
				row.query?.userText ??
				JSON.stringify(row.query ?? {}));
	return row.rankingCondition
		? `${text} (Condition: ${row.rankingCondition})`
		: text;
};
const count = (value) => (present(value) ? String(value) : "n/a");
const ratio = (numerator, denominator) =>
	present(numerator) && present(denominator)
		? `${numerator}/${denominator}`
		: "n/a";
const sampleLatency = (performance, name) =>
	performance?.samplesMs?.length ? milliseconds(performance[name]) : "n/a";
const mebibytes = (value) =>
	finite(value) ? `${(value / 1024 / 1024).toFixed(2)} MiB` : "n/a";
const measurement = (value) => (present(value) ? JSON.stringify(value) : "n/a");

function accuracyCells(value) {
	return [
		percent(value?.allPairs?.queryMacroAgreement),
		percent(value?.withoutUncertain?.queryMacroAgreement),
		percent(value?.allPairs?.pairCoverage),
		percent(value?.imageCoverage?.fraction),
		count(value?.eligibilityViolations),
	];
}

function visualComparison(row) {
	if (!["image", "controlled-fixture"].includes(row.inputKind)) return null;
	const expected = row.accuracy?.coverage?.expectedIds ?? [];
	const judged = [...new Set([...expected, ...(row.orderGroups ?? []).flat()])];
	const available = new Set(
		row.availableImageIds ?? (row.status === "ok" ? expected : []),
	);
	const imageIds = judged.filter((id) => available.has(id));
	if (!imageIds.length) return null;
	const included = new Set(imageIds);
	const humanGroups = (row.orderGroups ?? [])
		.map((group) => group.filter((id) => included.has(id)))
		.filter((group) => group.length);
	const humanOrdered = new Set(humanGroups.flat());
	const sortedHits = [...(row.hits ?? [])]
		.filter((hit) => finite(hit.score))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const modelGroups = [];
	for (const hit of sortedHits.filter((hit) => included.has(hit.id))) {
		if (modelGroups.at(-1)?.score !== hit.score)
			modelGroups.push({ score: hit.score, ids: [] });
		modelGroups.at(-1).ids.push(hit.id);
	}
	const returned = new Set(modelGroups.flatMap((group) => group.ids));
	const unjudged = sortedHits
		.slice(0, 20)
		.filter(
			(hit) =>
				!judged.includes(hit.id) &&
				!row.accuracy?.eligibility?.excludedReturned?.includes(hit.id),
		)
		.map((hit) => hit.id);
	return {
		caseId: row.caseId,
		query: queryText(row),
		status: row.status,
		reason: row.reason,
		humanGroups,
		modelGroups,
		unranked: imageIds.filter((id) => !humanOrdered.has(id)),
		missing: imageIds.filter((id) => !returned.has(id)),
		unjudged,
		notes: row.notes,
		warnings: row.searchEvidence?.semanticsWarnings ?? [],
	};
}

function documentSections(run, previous) {
	const candidates = run.candidates ?? [];
	const sections = [
		{
			title: "Evidence and interpretation",
			paragraphs: [
				"No combined score or automatic winner. Accuracy, coverage, latency and resource costs remain separate.",
				"Agreement measures recorded preferences on assessed pairs. Missing comparisons remain unassessed; high agreement with low coverage is incomplete evidence. The sensitivity column excludes explicitly uncertain pairs; it does not invent confidence weights.",
				"These development judgments are not independent population samples or a held-out benchmark. Repeated optimization against them can overfit.",
				"Timing describes this harness, corpus, environment and execution path. Local-reference timing excludes search-backend execution. These measurements do not establish performance for 1 million or 100 million wallpapers. Do not compare speed across different execution classes or workloads.",
			],
			code: run.dataset?.evidenceContext ?? null,
		},
		{
			title: "Run conditions",
			code: {
				id: run.id,
				createdAt: run.createdAt,
				dataset: { ...run.dataset, evidenceContext: undefined },
				environment: run.environment,
				workload: run.workload,
			},
		},
		{
			title: "Method scope and approximation warnings",
			paragraphs: [
				"A method can return rankings while approximating the requested query semantics. Read these declarations beside agreement and coverage; successful execution does not establish that the intended query is implemented.",
			],
			headers: ["Candidate", "Declared approximation", "Declared limitations"],
			rows: candidates.map((candidate) => [
				candidate.label ?? candidate.id,
				candidate.metadata?.approximation ??
					"No approximation statement supplied",
				(candidate.metadata?.limitations ?? []).join(" ") ||
					"No limitation statement supplied",
			]),
		},
		{
			title: "Per-query semantic warnings",
			headers: ["Candidate", "Case", "Warnings"],
			rows: candidates.flatMap((candidate) =>
				(candidate.cases ?? [])
					.filter((row) => row.searchEvidence?.semanticsWarnings?.length)
					.map((row) => [
						candidate.label ?? candidate.id,
						row.caseId,
						row.searchEvidence.semanticsWarnings.join(" "),
					]),
			),
		},
		{
			title: "Large-window ranking diagnostic",
			paragraphs: [
				`These accuracy calls use a separate result limit (${run.workload?.accuracyLimit ?? "not recorded"}). They help inspect the scoring formula and coverage. Do not pair this agreement with latency measured at the timed result limit (${run.workload?.limit ?? "not recorded"}), especially for approximate retrieval.`,
			],
			headers: [
				"Candidate",
				"Execution",
				"OK / total",
				"Unsupported",
				"Errors",
				"Agreement",
				"Without uncertain pairs",
				"Pair coverage",
				"Image coverage",
				"Eligibility violations",
			],
			rows: candidates.map((candidate) => [
				candidate.label ?? candidate.id,
				candidate.execution?.kind ?? "unknown",
				ratio(
					candidate.summary?.coverage?.ok,
					candidate.summary?.coverage?.total,
				),
				count(candidate.summary?.coverage?.unsupported),
				count(candidate.summary?.coverage?.error),
				...accuracyCells(candidate.summary?.accuracy),
			]),
		},
		{
			title: "Timed-search accuracy (first measured sample)",
			paragraphs: [
				`This quality view uses the first successful measured search per case at the same result limit (${run.workload?.limit ?? "not recorded"}) as the performance samples. It is not an average across repeated searches; approximate or nondeterministic methods may vary. Repeated raw trial results remain in diagnostics. Missing judged images are unassessed, so agreement must be read alongside pair and image coverage.`,
			],
			headers: [
				"Candidate",
				"Assessed / total cases",
				"Agreement",
				"Without uncertain pairs",
				"Pair coverage",
				"Image coverage",
				"Eligibility violations",
			],
			rows: candidates.map((candidate) => [
				candidate.label ?? candidate.id,
				ratio(
					candidate.summary?.timedAccuracy?.allPairs?.assessedCases,
					candidate.summary?.timedAccuracy?.totalCases,
				),
				...accuracyCells(candidate.summary?.timedAccuracy),
			]),
		},
		{
			title: "Measured performance",
			paragraphs: [
				"Setup is measured separately. Latency percentiles pool measured query samples in this workload; inspect case details for slow queries. Warmup, cache control, repetitions and execution metadata are recorded above and below. Small sample counts do not establish stable tail latency.",
			],
			headers: [
				"Candidate",
				"Execution",
				"Samples",
				"p50",
				"p95",
				"Maximum",
				"Failures",
				"Setup",
			],
			rows: candidates.map((candidate) => {
				const performance = candidate.summary?.performance;
				return [
					candidate.label ?? candidate.id,
					candidate.execution?.kind ?? "unknown",
					count(performance?.samplesMs?.length),
					sampleLatency(performance, "p50Ms"),
					sampleLatency(performance, "p95Ms"),
					sampleLatency(performance, "maxMs"),
					count(performance?.failures),
					milliseconds(candidate.setup?.elapsedMs),
				];
			}),
		},
		{
			title: "Resource observations",
			paragraphs: [
				"Harness CPU covers the measured block, including warmups. Memory values are process snapshots, not isolated candidate peaks; retained allocations from earlier candidates can affect them. Backend resources and index storage remain n/a when unmeasured. Scope and raw values are preserved in diagnostics.",
			],
			headers: [
				"Candidate",
				"Harness CPU",
				"RSS before",
				"RSS after",
				"Heap used after",
				"Backend CPU",
				"Backend memory",
				"Index store",
			],
			rows: candidates.map((candidate) => [
				candidate.label ?? candidate.id,
				milliseconds(candidate.resources?.serviceCpuMs),
				mebibytes(candidate.resources?.memoryBefore?.rss),
				mebibytes(candidate.resources?.memoryAfter?.rss),
				mebibytes(candidate.resources?.memoryAfter?.heapUsed),
				measurement(candidate.resources?.backendCpu ?? candidate.resources?.openSearchCpu),
				measurement(candidate.resources?.backendMemory ?? candidate.resources?.openSearchMemory),
				mebibytes(candidate.setup?.storeBytes),
			]),
		},
	];
	const comparison = compareRuns(run, previous);
	if (comparison) {
		sections.push({
			title: `Changes since ${comparison.previousRunId}`,
			paragraphs: [
				"Agreement deltas are percentage points. Positive latency deltas mean slower. Configuration and implementation changes are intentional experiment inputs. Deltas require comparable evidence; latency also requires matching workload, measured coverage, hardware/runtime and backend environment.",
				comparison.accuracy.comparable
					? "Dataset and corpus fingerprints match."
					: `Accuracy comparison unavailable: ${comparison.accuracy.reasons.join("; ")}.`,
			],
			headers: [
				"Candidate",
				"Status",
				"Changed inputs",
				"Large-window agreement change",
				"Timed first-sample agreement change",
				"p95 change",
				"Unavailable comparisons",
			],
			rows: comparison.candidates.map((candidate) => [
				candidate.id,
				candidate.status,
				[
					candidate.configurationChanged && "configuration changed",
					candidate.sourceChanged && "implementation/source changed",
				]
					.filter(Boolean)
					.join("; ") || "—",
				points(candidate.accuracy.delta),
				points(candidate.timedAccuracy?.delta),
				signedMs(candidate.performance.p95DeltaMs),
				[
					...candidate.accuracy.reasons.map(
						(reason) => `Large-window accuracy: ${reason}`,
					),
					...(candidate.timedAccuracy?.reasons ?? []).map(
						(reason) => `Timed-search accuracy: ${reason}`,
					),
					...candidate.performance.reasons.map((reason) => `Timing: ${reason}`),
				].join("; ") || "—",
			]),
		});
		sections.push({
			title: "Case changes and regressions",
			headers: [
				"Candidate",
				"Case",
				"Status",
				"Previous agreement",
				"Current agreement",
				"Change",
				"Interpretation",
			],
			rows: comparison.candidates.flatMap((candidate) =>
				candidate.cases.map((row) => [
					candidate.id,
					row.caseId,
					`${row.previousStatus ?? row.status} → ${row.currentStatus ?? row.status}`,
					percent(row.previousAgreement),
					percent(row.currentAgreement),
					points(row.delta),
					row.reasons.join("; ") ||
						(row.delta < 0
							? "Lower preference agreement"
							: row.delta > 0
								? "Higher preference agreement"
								: "Unchanged or unscored"),
				]),
			),
		});
	}
	for (const candidate of candidates) {
		const categoryEntries = Object.entries(
			candidate.summary?.accuracy?.categories ?? {},
		);
		sections.push({
			title: `${candidate.label ?? candidate.id}: categories`,
			headers: [
				"Category",
				"Assessed / total cases",
				"Agreement",
				"Without uncertain pairs",
				"Pair coverage",
				"Image coverage",
				"Eligibility violations",
			],
			rows: categoryEntries.map(([category, value]) => [
				category,
				ratio(
					value.allPairs?.assessedCases,
					value.totalCases ?? value.allPairs?.totalCases,
				),
				...accuracyCells(value),
			]),
		});
		sections.push({
			title: `${candidate.label ?? candidate.id}: cases`,
			headers: [
				"Case",
				"Query",
				"Status / reason",
				"Large-window agreement",
				"Without uncertain pairs",
				"Assessed / total pairs",
				"Missing judged images",
				"Eligibility violations",
				"Timed first-sample agreement",
				"Timed pair coverage",
				"p95",
			],
			rows: (candidate.cases ?? []).map((row) => [
				row.caseId,
				queryText(row),
				[row.status, row.reason].filter(Boolean).join(": "),
				percent(caseAgreement(row)),
				percent(row.accuracy?.withoutUncertain?.agreement),
				ratio(
					row.accuracy?.allPairs?.assessedPairs,
					row.accuracy?.allPairs?.totalPairs,
				),
				(row.accuracy?.coverage?.missingIds ?? []).join(", ") || "—",
				count(row.accuracy?.eligibility?.violations),
				percent(row.timedAccuracy?.allPairs?.agreement),
				percent(row.timedAccuracy?.allPairs?.coverage),
				sampleLatency(row.performance, "p95Ms"),
			]),
		});
		const visualCases = (candidate.cases ?? [])
			.map(visualComparison)
			.filter(Boolean);
		if (visualCases.length)
			sections.push({
				title: `${candidate.label ?? candidate.id}: visual comparisons`,
				paragraphs: [
					"This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.",
				],
				visualCases,
			});
		sections.push({
			title: `${candidate.label ?? candidate.id}: configuration and diagnostics`,
			details: [
				{
					title: "Configuration, execution, source fingerprints and setup",
					value: {
						id: candidate.id,
						configuration: candidate.configuration,
						metadata: candidate.metadata,
						execution: candidate.execution,
						sourceHashes: candidate.sourceHashes,
						setup: candidate.setup,
						resources: candidate.resources,
						summary: candidate.summary,
					},
				},
				...(candidate.cases ?? []).map((row) => ({
					title: `${row.caseId}: ${row.status}`,
					value: {
						query: row.query,
						status: row.status,
						reason: row.reason,
						rankingCondition: row.rankingCondition,
						orderGroups: row.orderGroups,
						notes: row.notes,
						evidenceContext: row.evidenceContext,
						searchEvidence: row.searchEvidence,
						accuracy: row.accuracy,
						timedAccuracy: row.timedAccuracy,
						hits: row.hits,
						performance: row.performance,
					},
				})),
			],
		});
	}
	return sections;
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
function markdownText(value) {
	return escapeHtml(value)
		.replaceAll("\\", "\\\\")
		.replaceAll("|", "\\|")
		.replaceAll("`", "\\`")
		.replaceAll("[", "\\[")
		.replaceAll("]", "\\]")
		.replaceAll("*", "\\*")
		.replaceAll("_", "\\_")
		.replace(/\r?\n/g, " ");
}
function diagnosticJson(value) {
	const content = JSON.stringify(value, null, 2);
	if (content.length <= 8192) return content;
	return JSON.stringify({
		note: "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
		characters: content.length,
		keys: Object.keys(value),
	}, null, 2);
}
function codeBlock(value) {
	const content = diagnosticJson(value);
	const longestFence = Math.max(
		2,
		...(content.match(/`+/g) ?? []).map((match) => match.length),
	);
	const fence = "`".repeat(longestFence + 1);
	return `${fence}json\n${content}\n${fence}`;
}

export function renderMarkdown(run, previous = null) {
	const parts = [`# Color evaluation: ${markdownText(run.id)}\n`, "[Complete raw measurements and diagnostics](./run.json). Large diagnostic payloads are kept in that artifact instead of duplicated in this report.\n"];
	for (const section of documentSections(run, previous)) {
		parts.push(`## ${markdownText(section.title)}\n`);
		for (const paragraph of section.paragraphs ?? [])
			parts.push(`${markdownText(paragraph)}\n`);
		if (section.headers) {
			parts.push(
				`| ${section.headers.map(markdownText).join(" | ")} |\n| ${section.headers.map(() => "---").join(" | ")} |\n${section.rows.map((row) => `| ${row.map(markdownText).join(" | ")} |`).join("\n")}\n`,
			);
			if (!section.rows.length) parts.push("No observations available.\n");
		}
		if (present(section.code)) parts.push(`${codeBlock(section.code)}\n`);
		for (const row of section.visualCases ?? [])
			parts.push(
				`### ${markdownText(row.caseId)}\n\n${markdownText(row.query)}\n\nSubmitted preference groups: ${markdownText(row.humanGroups.map((group) => group.join(" = ")).join(" > ") || "No submitted order")}\n\nMethod score groups: ${markdownText(row.modelGroups.map((group) => group.ids.join(" = ")).join(" > ") || "No judged images returned")}\n\nNo submitted ordering for: ${markdownText(row.unranked.join(", ") || "—")}\n\nNot returned by this method: ${markdownText(row.missing.join(", ") || "—")}\n\nUnjudged retrieved IDs among the first 20 results: ${markdownText(row.unjudged.join(", ") || "—")}\n`,
			);
		for (const detail of section.details ?? [])
			parts.push(
				`### ${markdownText(detail.title)}\n\n${codeBlock(detail.value)}\n`,
			);
	}
	return `${parts.join("\n")}\n`;
}

function visualComparisonHtml(row) {
	const images = (ids) =>
		`<div class="image-group">${ids.map((id) => `<figure><a href="./images/${escapeHtml(encodeURIComponent(id))}"><img loading="lazy" src="./images/${escapeHtml(encodeURIComponent(id))}" alt="${escapeHtml(id)}"></a><figcaption>${escapeHtml(id)}</figcaption></figure>`).join("")}</div>`;
	const groups = (values, human) =>
		values.length
			? values
					.map((group, index) => {
						const ids = human ? group : group.ids;
						return `<div class="preference-group"><p>Group ${index + 1}${ids.length > 1 ? (human ? " · Human tie" : " · Model score tie") : ""}${human ? "" : ` · Score ${escapeHtml(group.score)}`}</p>${images(ids)}</div>`;
					})
					.join("")
			: "<p>No ordered images available.</p>";
	return `<details class="visual-case"><summary>${escapeHtml(row.caseId)} · ${escapeHtml(row.status)} · ${escapeHtml(row.query)}</summary>${row.reason ? `<p>${escapeHtml(row.reason)}</p>` : ""}${row.warnings.length ? `<p class="warning">${escapeHtml(row.warnings.join(" "))}</p>` : ""}<div class="comparison-columns"><div><h3>Submitted preference groups</h3>${groups(row.humanGroups, true)}${row.unranked.length ? `<h4>No submitted ordering for</h4>${images(row.unranked)}` : ""}</div><div><h3>Method score groups</h3>${groups(row.modelGroups, false)}${row.missing.length ? `<h4>Not returned by this method</h4>${images(row.missing)}` : ""}</div></div>${row.notes?.length ? `<p>Reviewer notes: ${escapeHtml(Array.isArray(row.notes) ? row.notes.join(" ") : row.notes)}</p>` : ""}${row.unjudged.length ? `<p>Unjudged retrieved IDs among the first 20 results: ${escapeHtml(row.unjudged.join(", "))}. No human relevance judgment is inferred.</p>` : ""}</details>`;
}

export function renderHtml(run, previous = null) {
	const sections = documentSections(run, previous)
		.map(
			(section) =>
				`<section><h2>${escapeHtml(section.title)}</h2>${(section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${section.headers ? `<div class="table-scroll"><table><thead><tr>${section.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${section.rows.length ? "" : "<p>No observations available.</p>"}` : ""}${present(section.code) ? `<pre>${escapeHtml(diagnosticJson(section.code))}</pre>` : ""}${(section.visualCases ?? []).map(visualComparisonHtml).join("")}${(section.details ?? []).map((detail) => `<details><summary>${escapeHtml(detail.title)}</summary><pre>${escapeHtml(diagnosticJson(detail.value))}</pre></details>`).join("")}</section>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>Color evaluation: ${escapeHtml(run.id)}</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5;background:#10151c;color:#e8edf4}body{margin:0;padding:28px;max-width:1500px;margin-inline:auto}h1{font-size:1.8rem}h2{font-size:1.2rem}section{margin-block:28px;padding:20px;background:#19212c;border-radius:10px;border:1px solid #334156}p{max-width:100ch}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #3b4859;min-width:75px}th{color:#b9d8fc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#10151c;padding:16px;border-radius:6px;font-size:.85rem}details{margin-block:10px}summary{cursor:pointer;padding:8px;color:#b9d8fc}@media(max-width:600px){body{padding:12px}section{padding:12px}}@media print{:root,section,pre{background:white;color:black}body{padding:0}section{break-inside:avoid}th,summary{color:black}}
.comparison-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.image-group{display:flex;flex-wrap:wrap;gap:8px}.preference-group{padding:8px;border:1px solid #3b4859;margin-block:10px}.preference-group p{margin:0 0 8px}.image-group figure{margin:0;width:calc(50% - 4px);min-width:100px}.image-group img{display:block;width:100%;height:180px;object-fit:contain;background:#080b10}.image-group figcaption{font-size:.8rem;overflow-wrap:anywhere}.warning{border-left:3px solid #e7ba68;padding-left:12px}.visual-case>summary{font-weight:600}.visual-case h3{font-size:1rem}@media(max-width:700px){.comparison-columns{grid-template-columns:1fr}.image-group img{height:150px}}
*{box-sizing:border-box}body{width:100%;min-width:0;overflow-wrap:anywhere}section,details,pre,.table-scroll{max-width:100%;min-width:0}summary,p,h1,h2,h3,h4{overflow-wrap:anywhere}.comparison-columns>div{min-width:0}.image-group{max-width:100%;min-width:0}@media(min-width:701px){.comparison-columns{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><h1>Color evaluation: ${escapeHtml(run.id)}</h1><p><a href="./run.json">Complete raw measurements and diagnostics</a>. Large diagnostic payloads are kept in that artifact instead of duplicated here.</p>${sections}</body></html>\n`;
}
