import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { loadDataset } from "./dataset.mjs";
import {
	accuracyPolicy,
	evaluateRanking,
	summarizeAccuracy,
} from "./metrics.mjs";
import { renderMarkdown, renderHtml } from "./report.mjs";

export const EXPERIMENT_ROOT = fileURLToPath(
	new URL("../../", import.meta.url),
);
export const DEFAULT_OUTPUT_ROOT = path.join(
	os.homedir(),
	".local/share/wallpaperdb/color-evaluation/runs",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
	JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
				)
			: item,
	);
const fingerprint = (value) => sha(canonical(value));
const errorText = (error) =>
	error instanceof Error ? error.message : String(error);

export function expandCandidates(candidates) {
	if (!Array.isArray(candidates) || !candidates.length)
		throw Error("At least one candidate is required");
	const expanded = [];
	for (const candidate of candidates) {
		if (!candidate.id || typeof candidate.id !== "string")
			throw Error("Candidate id is required");
		let parameters = [candidate.parameters ?? {}];
		const axes = Object.entries(candidate.sweep ?? {});
		for (const [key, values] of axes) {
			if (!Array.isArray(values) || !values.length)
				throw Error(`Empty sweep axis: ${key}`);
			parameters = parameters.flatMap((p) =>
				values.map((value) => ({ ...p, [key]: value })),
			);
			if (parameters.length > 1000)
				throw Error(
					"A single sweep exceeds 1000 configurations; split into explicit runs",
				);
		}
		const { sweep, ...base } = candidate;
		for (const p of parameters)
			expanded.push({
				...base,
				...(axes.length
					? {
							id: `${candidate.id}-${fingerprint(p).slice(0, 12)}`,
							baseId: candidate.id,
						}
					: {}),
				parameters: p,
			});
	}
	if (new Set(expanded.map((c) => c.id)).size !== expanded.length)
		throw Error("Duplicate candidate id");
	return expanded;
}

export async function loadCorpus(experimentRoot, dataset) {
	const original = JSON.parse(
		await readFile(path.join(experimentRoot, "corpus-manifest.json"), "utf8"),
	);
	const records = new Map();
	for (const example of [
		...original,
		...dataset.cases.flatMap((c) => c.examples ?? []),
	]) {
		const id = example.id ?? example.wallpaperId;
		if (!id || !example.filename) continue;
		const filename = path.resolve(experimentRoot, example.filename);
		const previous = records.get(id);
		if (previous) {
			if (example.sha256 && previous.sha256 !== example.sha256)
				throw Error(`Conflicting source hash for ${id}`);
			continue;
		}
		const actual = sha(await readFile(filename));
		if (example.sha256 && example.sha256 !== actual)
			throw Error(`Image hash mismatch for ${id}`);
		// Pass source facts only. Human judgments and construction answers stay with the evaluator.
		records.set(id, {
			id,
			filename,
			sha256: actual,
			thumbnail: example.thumbnail
				? path.resolve(experimentRoot, example.thumbnail)
				: undefined,
		});
	}
	return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function fileHashes(files, root) {
	const hashes = {};
	for (const source of files) {
		const file = typeof source === "string" ? source : source.path;
		const absolute = path.resolve(root, file);
		const actual = sha(await readFile(absolute));
		if (typeof source === "object" && source.sha256 !== actual)
			throw Error(`Source hash mismatch for ${file}`);
		hashes[path.relative(root, absolute)] = actual;
	}
	return hashes;
}

export function distribution(samplesMs, failures = 0) {
	const values = [...samplesMs].sort((a, b) => a - b);
	const percentile = (q) =>
		values.length
			? values[Math.max(0, Math.ceil(values.length * q) - 1)]
			: null;
	return {
		samplesMs: [...samplesMs],
		sampleCount: values.length,
		p50Ms: percentile(0.5),
		p95Ms: percentile(0.95),
		maxMs: values.at(-1) ?? null,
		failures,
	};
}

export function searchQuery(source) {
	if (typeof source === "string") return { text: source };
	const allowed = new Set([
		"text",
		"userText",
		"detail",
		"colorTargets",
		"specifiedPercentages",
		"swatchHex",
		"preciseHex",
		"unspecifiedRemainderPercent",
		"colors",
		"colorSpace",
		"subjectRequest",
		"subjectConstraint",
		"intent",
		"priorEvidence",
		"priorClarification",
		"initialIntent",
		"clarificationSource",
		"subjectFilteringMode",
		"initialSubjectFilteringMode",
	]);
	const unknown = Object.keys(source).filter((key) => !allowed.has(key));
	if (unknown.length)
		throw Error(
			`Unrecognized search-input fields require explicit normalization: ${unknown.join(", ")}`,
		);
	// Historical case files mix search intent and human observations. Only these
	// explicit request fields cross into an adapter. Extend/version this boundary
	// when introducing new query controls; do not forward annotation objects.
	const query = {
		text: source.text ?? source.userText,
		detail: source.detail,
		colorTargets: source.colorTargets ?? source.specifiedPercentages,
		swatchHex: source.swatchHex ?? source.preciseHex,
		unspecifiedRemainderPercent: source.unspecifiedRemainderPercent,
		colors: source.colors,
		colorSpace: source.colorSpace,
		subjectRequest: source.subjectRequest,
		subjectConstraint: source.subjectConstraint,
	};
	return structuredClone(
		Object.fromEntries(
			Object.entries(query).filter(
				([, value]) => value !== undefined && value !== null,
			),
		),
	);
}

function requestCase(c) {
	const eligibleIds =
		c.rankingCondition && c.conditionalEligibility?.length
			? c.expectedRankedIds
			: c.eligibleIds;
	return structuredClone({
		id: c.id,
		query: searchQuery(c.query),
		inputKind: c.inputKind,
		...(eligibleIds ? { eligibleIds } : {}),
		...(c.excludedIds ? { excludedIds: c.excludedIds } : {}),
	});
}

async function timedSearch(candidate, caseData, limit, timeoutMs) {
	const controller = new AbortController();
	let timer;
	const start = performance.now();
	try {
		const result = await Promise.race([
			Promise.resolve().then(() =>
				candidate.search({
					caseData: requestCase(caseData),
					limit,
					signal: controller.signal,
				}),
			),
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					const error = Error(`Search timed out after ${timeoutMs} ms`);
					controller.abort(error);
					reject(error);
				}, timeoutMs);
			}),
		]);
		const elapsedMs = performance.now() - start;
		if (elapsedMs > timeoutMs)
			throw Error(
				`Search timed out after ${elapsedMs.toFixed(1)} ms (deadline ${timeoutMs} ms)`,
			);
		if (!result || !Array.isArray(result.hits))
			throw Error("Adapter must return a hits array");
		const ids = new Set();
		let previousScore = Infinity;
		for (const hit of result.hits) {
			if (
				typeof hit.id !== "string" ||
				!Number.isFinite(hit.score) ||
				ids.has(hit.id)
			)
				throw Error("Invalid or duplicate ranked hit");
			if (hit.score > previousScore)
				throw Error("Hits must be sorted by descending score");
			ids.add(hit.id);
			previousScore = hit.score;
		}
		if (result.timedOut || result.partialResults || result.shardFailures > 0)
			throw Error("Adapter returned partial or timed-out backend results");
		return { result, elapsedMs };
	} finally {
		clearTimeout(timer);
	}
}

function workloadConfig(input = {}) {
	const workload = {
		warmup: 1,
		repeats: 5,
		concurrency: 1,
		limit: 20,
		accuracyLimit: 1000,
		timeoutMs: 10000,
		...input,
	};
	for (const key of [
		"warmup",
		"repeats",
		"concurrency",
		"limit",
		"accuracyLimit",
		"timeoutMs",
	]) {
		if (
			!Number.isInteger(workload[key]) ||
			workload[key] < (key === "warmup" ? 0 : 1)
		)
			throw Error(`Invalid workload.${key}`);
	}
	return {
		...workload,
		timingScope: "adapter-end-to-end",
		cacheState: "uncontrolled; explicit warmup rounds",
		schedule: "rotating case order per round; candidates sequential",
		percentiles: "nearest-rank",
		setupExcluded: true,
	};
}

async function runCandidate({
	candidateConfig,
	configDirectory,
	context,
	dataset,
	workload,
	createCandidate,
}) {
	const started = performance.now();
	const record = {
		id: candidateConfig.id,
		label: candidateConfig.label ?? candidateConfig.id,
		configuration: candidateConfig,
		execution: { kind: "unknown" },
		sourceHashes: {},
		setup: { elapsedMs: null },
		cases: [],
		summary: {},
	};
	let candidate;
	try {
		let modulePath;
		if (createCandidate)
			candidate = await createCandidate({ config: candidateConfig, context });
		else {
			if (!candidateConfig.module) throw Error("Candidate module is required");
			modulePath = path.resolve(configDirectory, candidateConfig.module);
			const module = await import(pathToFileURL(modulePath));
			if (typeof module.createCandidate !== "function")
				throw Error("Candidate module must export createCandidate");
			candidate = await module.createCandidate({
				config: candidateConfig,
				context,
			});
		}
		if (typeof candidate.search !== "function")
			throw Error("Candidate must implement search");
		const prepared = (await candidate.prepare?.()) ?? {};
		const metadata = candidate.metadata ?? {};
		record.label =
			candidateConfig.label ?? metadata.label ?? candidateConfig.id;
		record.metadata = metadata;
		const execution = prepared.execution ?? metadata.execution ?? "unknown";
		record.execution =
			typeof execution === "string" ? { kind: execution } : execution;
		record.setup = { ...prepared, elapsedMs: performance.now() - started };
		record.sourceHashes = await fileHashes(
			[...(modulePath ? [modulePath] : []), ...(metadata.sourceFiles ?? [])],
			context.experimentRoot,
		);
		const available = new Set(context.corpus.map((c) => c.id));
		for (const c of dataset.cases) {
			const result = {
				caseId: c.id,
				category: c.category,
				groupId: c.groupId,
				inputKind: c.inputKind,
				query: c.query,
				status: "unsupported",
				notes: c.notes,
				rankingCondition: c.rankingCondition,
				evidenceContext: c.evidenceContext,
				orderGroups: c.orderGroups,
				availableImageIds: (c.judgedIds ?? []).filter((id) =>
					available.has(id),
				),
				accuracy: evaluateRanking(c, []),
				timedAccuracy: evaluateRanking(c, []),
				hits: [],
				performance: { ...distribution([]), trials: [] },
			};
			record.cases.push(result);
			if (c.inputKind === "conceptual") {
				result.reason =
					c.unsupportedReason ?? "Conceptual case has no image input";
				continue;
			}
			const missing = (c.expectedRankedIds ?? c.judgedIds ?? []).filter(
				(id) => !available.has(id),
			);
			if (missing.length) {
				result.reason = `Corpus lacks judged images: ${missing.join(", ")}`;
				continue;
			}
			try {
				const support = (await candidate.supports?.(requestCase(c))) ?? {
					supported: true,
				};
				if (!support.supported) {
					result.reason = support.reason ?? "Unsupported query";
					continue;
				}
				const { result: search } = await timedSearch(
					candidate,
					c,
					workload.accuracyLimit,
					workload.timeoutMs,
				);
				for (const hit of search.hits)
					if (!available.has(hit.id))
						throw Error(`Unknown corpus hit ${hit.id}`);
				result.accuracy = evaluateRanking(c, search.hits);
				result.hits = search.hits;
				result.searchEvidence = Object.fromEntries(
					Object.entries(search).filter(([key]) => key !== "hits"),
				);
				result.status = "ok";
			} catch (error) {
				result.status = "error";
				result.reason = errorText(error);
			}
		}

		// Accuracy calls are deliberately outside performance samples and warmups.
		const runnable = record.cases.filter((c) => c.status === "ok");
		const sourceById = new Map(dataset.cases.map((c) => [c.id, c]));
		const cpuStart = process.cpuUsage();
		const blockStart = performance.now();
		const memoryBefore = process.memoryUsage();
		const failedCases = new Set();
		const runPhase = async (warmup, rounds) => {
			const jobs = [];
			let next = 0;
			for (let round = 0; round < rounds; round++)
				for (let i = 0; i < runnable.length; i++)
					jobs.push({
						row: runnable[(i + round) % runnable.length],
						warmup,
						round,
					});
			await Promise.all(
				Array.from(
					{ length: Math.min(workload.concurrency, Math.max(1, jobs.length)) },
					async () => {
						while (next < jobs.length) {
							const job = jobs[next++];
							if (failedCases.has(job.row.caseId)) continue;
							try {
								const measured = await timedSearch(
									candidate,
									sourceById.get(job.row.caseId),
									workload.limit,
									workload.timeoutMs,
								);
								for (const hit of measured.result.hits)
									if (!available.has(hit.id))
										throw Error(`Unknown corpus hit ${hit.id}`);
								if (!job.warmup) {
									const accuracy = evaluateRanking(
										sourceById.get(job.row.caseId),
										measured.result.hits,
									);
									if (
										job.row.performance.firstSuccessfulRound === undefined ||
										job.round < job.row.performance.firstSuccessfulRound
									) {
										job.row.timedAccuracy = accuracy;
										job.row.performance.firstSuccessfulRound = job.round;
									}
									job.row.performance.samplesMs.push(measured.elapsedMs);
									job.row.performance.trials.push({
										round: job.round,
										elapsedMs: measured.elapsedMs,
										hits: measured.result.hits,
										accuracy,
										backendTookMs: measured.result.backendTookMs ?? null,
									});
								}
							} catch (error) {
								job.row.performance.failures++;
								(job.row.performance.errors ??= []).push({
									phase: job.warmup ? "warmup" : "measured",
									message: errorText(error),
								});
								failedCases.add(job.row.caseId);
							}
						}
					},
				),
			);
		};
		await runPhase(true, workload.warmup);
		await runPhase(false, workload.repeats);
		const cpu = process.cpuUsage(cpuStart);
		record.resources = {
			serviceCpuMs: (cpu.user + cpu.system) / 1000,
			measurementBlockMs: performance.now() - blockStart,
			memoryBefore,
			memoryAfter: process.memoryUsage(),
			scope:
				"Current harness process, warmups and measured searches; process memory snapshots, not isolated candidate peak",
			openSearchCpu: null,
			openSearchMemory: null,
		};
		for (const row of record.cases) {
			const extra = { ...row.performance };
			row.performance = {
				...extra,
				...distribution(extra.samplesMs, extra.failures),
				requestedSamples: row.status === "ok" ? workload.repeats : 0,
			};
		}
	} catch (error) {
		record.setup = {
			...record.setup,
			elapsedMs: performance.now() - started,
			error: errorText(error),
		};
		record.cases = dataset.cases.map((c) => ({
			caseId: c.id,
			category: c.category,
			groupId: c.groupId,
			query: c.query,
			status: "error",
			reason: `Setup: ${errorText(error)}`,
			accuracy: evaluateRanking(c, []),
			timedAccuracy: evaluateRanking(c, []),
			hits: [],
			performance: distribution([]),
		}));
	} finally {
		try {
			await candidate?.close?.();
		} catch (error) {
			record.cleanupError = errorText(error);
		}
	}
	record.summary.accuracy = summarizeAccuracy(record.cases);
	record.summary.timedAccuracy = summarizeAccuracy(
		record.cases.map((c) => ({
			...c,
			accuracy: c.timedAccuracy,
			status: c.performance.samplesMs.length
				? "ok"
				: c.status === "ok"
					? "error"
					: c.status,
		})),
	);
	record.summary.timedAccuracy.policy =
		"First successful measured request per case, at workload.limit; all repeated trial results preserved separately";
	record.summary.coverage = {
		total: record.cases.length,
		ok: record.cases.filter((c) => c.status === "ok").length,
		unsupported: record.cases.filter((c) => c.status === "unsupported").length,
		error: record.cases.filter((c) => c.status === "error").length,
	};
	record.summary.performance = distribution(
		record.cases.flatMap((c) => c.performance.samplesMs),
		record.cases.reduce((n, c) => n + c.performance.failures, 0),
	);
	return record;
}

export async function executeRun({
	config,
	configDirectory = process.cwd(),
	experimentRoot = EXPERIMENT_ROOT,
	outputRoot = DEFAULT_OUTPUT_ROOT,
	dataset,
	corpus,
	createCandidate,
	previous,
	onProgress = () => {},
}) {
	if (config.schemaVersion !== 1)
		throw Error("Unsupported configuration schemaVersion");
	const workload = workloadConfig(config.workload);
	const configurations = expandCandidates(config.candidates);
	dataset ??= await loadDataset({ root: experimentRoot });
	corpus ??= await loadCorpus(experimentRoot, dataset);
	const sourceHashes = await fileHashes(
		dataset.sourceFiles ?? [],
		experimentRoot,
	);
	const id = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
	const directory = path.join(outputRoot, id);
	await mkdir(directory, { recursive: true });
	const corpusHash = fingerprint(
		corpus
			.map(({ id, sha256 }) => ({ id, sha256 }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	);
	const snapshot = { ...dataset, sourceHashes, accuracyPolicy };
	const run = {
		schemaVersion: 1,
		id,
		createdAt: new Date().toISOString(),
		label: config.label ?? "Color search development evaluation",
		purpose: "development feedback; no method selected",
		configuration: config,
		dataset: {
			hash: fingerprint(snapshot),
			caseCount: dataset.cases.length,
			sourceHashes,
			corpusHash,
			corpusSize: corpus.length,
			evidenceContext: dataset.evidenceContext,
			accuracyPolicy,
		},
		environment: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			cpuCount: os.cpus().length,
			cpuModel: os.cpus()[0]?.model ?? "unknown",
			totalMemoryBytes: os.totalmem(),
			hostname: os.hostname(),
		},
		workload,
		candidates: [],
		previousRunId: previous?.id ?? null,
	};
	run.runnerSourceHashes = await fileHashes(
		["runner.mjs", "dataset.mjs", "metrics.mjs", "report.mjs"].map((f) =>
			fileURLToPath(new URL(f, import.meta.url)),
		),
		experimentRoot,
	);
	await writeFile(
		path.join(directory, "dataset.json"),
		JSON.stringify(snapshot, null, 2) + "\n",
		{ flag: "wx" },
	);
	await writeFile(
		path.join(directory, "corpus.json"),
		JSON.stringify(corpus, null, 2) + "\n",
		{ flag: "wx" },
	);
	for (const candidateConfig of configurations) {
		onProgress(`Evaluating ${candidateConfig.id}`);
		run.candidates.push(
			await runCandidate({
				candidateConfig,
				configDirectory,
				context: {
					experimentRoot,
					corpus: structuredClone(corpus),
					runDirectory: directory,
				},
				dataset,
				workload,
				createCandidate,
			}),
		);
	}
	await writeFile(
		path.join(directory, "run.json"),
		JSON.stringify(run, null, 2) + "\n",
		{ flag: "wx" },
	);
	await writeFile(
		path.join(directory, "report.md"),
		renderMarkdown(run, previous),
		{ flag: "wx" },
	);
	await writeFile(
		path.join(directory, "report.html"),
		renderHtml(run, previous),
		{ flag: "wx" },
	);
	const pointer = path.join(outputRoot, `.latest-${randomUUID()}.json`);
	await writeFile(
		pointer,
		JSON.stringify({ id, run: path.join(directory, "run.json") }) + "\n",
		{ flag: "wx" },
	);
	await rename(pointer, path.join(outputRoot, "latest.json"));
	onProgress(`Saved ${directory}`);
	return { run, directory };
}
