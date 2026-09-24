// Existing HSV64 controls only. This module has no import-time I/O or benchmark run.
// Faithful formula port of ColorSortService, HsvEmbeddingStrategy and
// SharpHistogramProvider; provenance is emitted for every run. No preference
// judgments, expected rankings, or case-specific tuning enter these adapters.
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCE_FILES = [
	"evaluation/loop/adapters.mjs",
	"../../apps/gateway/src/services/color-sort.service.ts",
	"../../apps/color-extractor/src/services/hsv-embedding-strategy.ts",
	"../../apps/color-extractor/src/services/sharp-histogram-provider.ts",
	"models.ts",
];
const NAMED_COLORS = Object.freeze({
	red: "#FF0000",
	orange: "#FF8000",
	yellow: "#FFFF00",
	lime: "#80FF00",
	green: "#00B040",
	teal: "#008080",
	cyan: "#00FFFF",
	sky: "#60BFFF",
	blue: "#0040FF",
	navy: "#102040",
	purple: "#8020C0",
	magenta: "#FF00FF",
	pink: "#FF80B0",
	rose: "#C06070",
	brown: "#805030",
	tan: "#C0A070",
	olive: "#708030",
	forest: "#205030",
	black: "#101010",
	gray: "#808080",
	white: "#F0F0F0",
	cream: "#FFF0C0",
	lavender: "#C0A0E0",
	slate: "#607080",
});
const HEX = /^#[0-9a-f]{6}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const squaredDistance = (a, b) =>
	a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0);
const unitSum = (values) => {
	const total = values.reduce((sum, value) => sum + value, 0);
	return values.map((value) => (total ? value / total : 0));
};

export function hsvHistogram(pixels) {
	if (pixels.length % 4 !== 0)
		throw new Error("Histogram requires RGBA pixels");
	const bins = new Array(64).fill(0);
	for (let i = 0; i < pixels.length; i += 4) {
		const [r, g, b, alpha] = [
			pixels[i],
			pixels[i + 1],
			pixels[i + 2],
			pixels[i + 3],
		].map((v) => v / 255);
		if (alpha === 0) continue;
		const max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			delta = max - min;
		const saturation = max === 0 ? 0 : delta / max;
		if (saturation < 0.1) {
			bins[48 + Math.min(15, Math.floor(max * 16))] += alpha;
		} else {
			let hue =
				max === r
					? ((g - b) / delta) * 60
					: max === g
						? ((b - r) / delta + 2) * 60
						: ((r - g) / delta + 4) * 60;
			if (hue < 0) hue += 360;
			const index =
				Math.min(11, Math.floor(hue / 30)) * 4 +
				(saturation < 0.5 ? 0 : 2) +
				(max < 0.5 ? 0 : 1);
			bins[index] += alpha;
		}
	}
	return unitSum(bins);
}

function oklab(rgb) {
	const [r, g, b] = rgb.map((c) =>
		c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}
function hsvRgb(h, s, v) {
	const c = v * s,
		x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
		m = v - c;
	const rgb =
		h < 60
			? [c, x, 0]
			: h < 120
				? [x, c, 0]
				: h < 180
					? [0, c, x]
					: h < 240
						? [0, x, c]
						: h < 300
							? [x, 0, c]
							: [c, 0, x];
	return rgb.map((channel) => channel + m);
}
const CENTERS = [];
for (let hue = 0; hue < 12; hue++)
	for (let sat = 0; sat < 2; sat++)
		for (let val = 0; val < 2; val++) {
			CENTERS.push(
				oklab(
					hsvRgb(
						hue * 30 + 15,
						sat === 0 ? 0.3 : 0.75,
						val === 0 ? 0.25 : 0.75,
					),
				),
			);
		}
for (let val = 0; val < 16; val++)
	CENTERS.push(oklab(hsvRgb(0, 0, (val + 0.5) / 16)));

export function buildQueryVector(colors, config = {}) {
	const values = new Array(64).fill(0);
	for (const color of colors) {
		if (
			!HEX.test(color.color) ||
			!Number.isFinite(color.amount) ||
			color.amount <= 0
		)
			throw new Error("Invalid color or amount");
		const spread = color.spread ?? 0.5;
		if (!Number.isFinite(spread) || spread < 0 || spread > 1)
			throw new Error("Invalid color spread");
		const sigma = config.sigma ?? 0.1 + spread * (0.5 - 0.1);
		if (!Number.isFinite(sigma) || sigma <= 0)
			throw new Error("sigma must be positive");
		const rgb = [1, 3, 5].map(
			(offset) =>
				Number.parseInt(color.color.slice(offset, offset + 2), 16) / 255,
		);
		const target = oklab(rgb);
		CENTERS.forEach((center, i) => {
			values[i] +=
				color.amount *
				Math.exp(-squaredDistance(center, target) / (2 * sigma * sigma));
		});
	}
	if (values.every((value) => value === 0))
		throw new Error("Query vector is zero; sigma is too narrow");
	return config.queryNormalization === "unit-sum" ? unitSum(values) : values;
}

export function interpretQuery(query = {}, namedColors = NAMED_COLORS) {
	const unsupported = (reason) => ({ supported: false, reason });
	if (!query || typeof query !== "object" || Array.isArray(query))
		return unsupported("Query must be a search-intent object.");
	const knownKeys = new Set([
		"text",
		"detail",
		"colorTargets",
		"swatchHex",
		"unspecifiedRemainderPercent",
		"colors",
		"colorSpace",
		"subjectRequest",
		"subjectConstraint",
	]);
	const unknownKeys = Object.keys(query).filter((key) => !knownKeys.has(key));
	if (unknownKeys.length)
		return unsupported(
			`Unsupported HSV query fields: ${unknownKeys.join(", ")}. Color ranges and other constraints must not be silently ignored.`,
		);
	if (query.subjectRequest != null || query.subjectConstraint != null)
		return unsupported(
			"This baseline has no semantic subject model; subject-constrained queries require an adapter that explicitly handles their eligibility.",
		);
	if (
		query.colorSpace != null &&
		(typeof query.colorSpace !== "string" ||
			query.colorSpace.toLowerCase() !== "srgb")
	)
		return unsupported(
			"This baseline interprets picked hex colors in sRGB only.",
		);
	if (query.text != null && typeof query.text !== "string")
		return unsupported("Query text must be a string.");
	const warnings = [];
	let colors;
	const named = (name) =>
		typeof name === "string" ? namedColors[name.toLowerCase()] : undefined;
	if (Array.isArray(query.colorTargets) && query.colorTargets.length) {
		colors = [];
		for (const target of query.colorTargets) {
			if (
				Object.keys(target).some(
					(key) =>
						!["colorName", "targetImagePercent", "colorHex", "spread"].includes(
							key,
						),
				)
			)
				return unsupported(
					"Color ranges or unrecognized target fields are not supported by this HSV baseline.",
				);
			const color = target.colorHex ?? named(target.colorName);
			if (!color || !HEX.test(color))
				return unsupported(
					`No baseline reference color for ${target.colorName ?? target.colorHex}; grayscale/vibe categories are not a single gray swatch.`,
				);
			if (
				!Number.isFinite(target.targetImagePercent) ||
				target.targetImagePercent <= 0 ||
				target.targetImagePercent > 100
			)
				return unsupported("Target percentages must be in (0, 100].");
			colors.push({
				color,
				amount: target.targetImagePercent / 100,
				...(target.spread === undefined ? {} : { spread: target.spread }),
			});
		}
		if (colors.reduce((sum, color) => sum + color.amount, 0) > 1 + 1e-10)
			return unsupported(
				"Portion percentages exceed 100%; overlapping properties are unsupported.",
			);
		warnings.push(
			"Percentage inputs enter the historical query as mixture weights; this baseline does not implement whole-image target errors or unrestricted remainder semantics.",
		);
		if (query.colorTargets.some((target) => target.colorName))
			warnings.push(
				"Named categories use fixed historical reference swatches, without perceptual category calibration.",
			);
	} else if (Array.isArray(query.colors) && query.colors.length) {
		if (
			query.colors.some((c) =>
				Object.keys(c).some(
					(key) => !["color", "amount", "spread"].includes(key),
				),
			)
		)
			return unsupported(
				"Color ranges or unknown color fields are not supported.",
			);
		colors = query.colors.map((color) => ({ ...color }));
		warnings.push(
			"Amounts are historical mixture weights, not whole-image target errors.",
		);
	} else if (query.swatchHex && HEX.test(query.swatchHex)) {
		colors = [{ color: query.swatchHex, amount: 1 }];
	} else {
		const color = named(query.text?.trim());
		if (!color)
			return unsupported(
				"This baseline supports named single colors, picked hex swatches and simple color mixtures; it has no vibe, grayscale-composition, rainbow or semantic model.",
			);
		colors = [{ color, amount: 1 }];
		warnings.push(
			"Named color uses a fixed historical reference swatch, without perceptual category calibration.",
		);
	}
	if (
		colors.some(
			(c) =>
				!HEX.test(c.color) ||
				!Number.isFinite(c.amount) ||
				c.amount <= 0 ||
				(c.spread !== undefined &&
					(!Number.isFinite(c.spread) || c.spread < 0 || c.spread > 1)),
		)
	)
		return unsupported("Invalid baseline color, amount or spread.");
	return { supported: true, colors, warnings };
}

export async function createCandidate({ config, context }) {
	const parameterKeys = new Set([
		"metric",
		"sigma",
		"queryNormalization",
		"namedColors",
	]);
	for (const key of Object.keys(config.parameters ?? {})) {
		if (!parameterKeys.has(key))
			throw new Error(`Unsupported HSV adapter parameter: ${key}`);
	}
	const effective = {
		metric: "cosine",
		queryNormalization: "none",
		execution: "local-exhaustive",
		...config,
		...config.parameters,
	};
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(effective.id ?? ""))
		throw new Error("Candidate id must be a safe file-name component");
	if (!["cosine", "l2"].includes(effective.metric))
		throw new Error(
			"HSV adapter metric must be cosine or l2; register another module for another method",
		);
	if (!["none", "unit-sum"].includes(effective.queryNormalization))
		throw new Error("Invalid queryNormalization");
	if (!["local-exhaustive", "opensearch-exact"].includes(effective.execution))
		throw new Error("Unsupported HSV adapter execution");
	if (
		effective.sigma !== undefined &&
		(!Number.isFinite(effective.sigma) || effective.sigma <= 0)
	)
		throw new Error("sigma must be positive");
	const useOpenSearch = effective.execution === "opensearch-exact";
	const os = effective.opensearch ?? {};
	const index =
		os.index ?? `color-eval-${effective.id.toLowerCase()}-${randomUUID()}`;
	if (useOpenSearch && !/^color-eval-[a-z0-9._-]+$/.test(index))
		throw new Error(
			"Evaluation index must begin with color-eval- and contain lowercase safe characters",
		);
	if (useOpenSearch && os.allowCreateIndex !== true)
		throw new Error(
			"OpenSearch execution requires explicit allowCreateIndex:true; existing indexes are never overwritten",
		);
	if (
		useOpenSearch &&
		(!os.url || !["http:", "https:"].includes(new URL(os.url).protocol))
	)
		throw new Error("OpenSearch url must be HTTP(S)");
	const names = { ...NAMED_COLORS, ...effective.namedColors };
	const metadata = {
		id: effective.id,
		label: effective.label ?? effective.id,
		config: effective,
		sourceFiles: SOURCE_FILES.map((file) =>
			path.resolve(context.experimentRoot, file),
		),
		execution: effective.execution,
		approximation:
			"Exact exhaustive ranking for the historical HSV64 formula, over a resized and quantized image descriptor; not exact human perception.",
		limitations: [
			"No learned or calibrated perceived-color category boundaries; named colors map to historical reference swatches.",
			"No grayscale/vibe, salience, spatial, semantic-text, or arbitrary color-range scoring.",
			"Amount/remainder intent is not implemented: these controls pass percentages into historical mixture weights.",
			"Cosine is invariant to single-color amount; unit-sum query normalization removes overall mixture magnitude.",
			useOpenSearch
				? "OpenSearch exact scoring scans every eligible descriptor; small-corpus latency is not evidence of production-scale latency."
				: "Local timing includes an exhaustive service-side scan and is not evidence of OpenSearch scalability.",
		],
		formulaPort:
			"HSV64/alpha-weighted/10000-target-pixels; production linear OKLab Gaussian query; port-v1",
		scoreDefinition:
			effective.metric === "cosine"
				? "1 + cosine(query,histogram), matching the OpenSearch exact knn_score transform"
				: "1 / (1 + squared Euclidean distance(query,histogram))",
		...(useOpenSearch ? { index, opensearchUrl: os.url } : {}),
	};
	let documents,
		setup,
		closed = false;
	const request = async (route, body, method = "POST", signal) => {
		const response = await fetch(`${os.url.replace(/\/$/, "")}/${route}`, {
			method,
			body:
				body === undefined
					? undefined
					: typeof body === "string"
						? body
						: JSON.stringify(body),
			headers: {
				"content-type":
					typeof body === "string"
						? "application/x-ndjson"
						: "application/json",
			},
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(os.timeoutMs ?? 30000)])
				: AbortSignal.timeout(os.timeoutMs ?? 30000),
		});
		const result = await response.json();
		if (!response.ok)
			throw new Error(
				`OpenSearch ${method} ${route}: ${response.status} ${JSON.stringify(result.error)}`,
			);
		return result;
	};
	return {
		metadata,
		supports(caseData) {
			const { supported, reason, warnings } = interpretQuery(
				caseData.query,
				names,
			);
			return {
				supported,
				...(reason ? { reason } : {}),
				...(warnings ? { warnings } : {}),
			};
		},
		async prepare() {
			if (closed) throw new Error("Candidate is closed");
			if (setup) return setup;
			const sharp = createRequire(
				path.resolve(
					context.experimentRoot,
					"../../apps/color-extractor/package.json",
				),
			)("sharp");
			const started = performance.now();
			const measured = [];
			const seen = new Set();
			for (const asset of context.corpus) {
				if (seen.has(asset.id))
					throw new Error(`Duplicate corpus id ${asset.id}`);
				seen.add(asset.id);
				const bytes = await readFile(
					path.resolve(context.experimentRoot, asset.filename),
				);
				const sha256 = hash(bytes);
				if (asset.sha256 && asset.sha256 !== sha256)
					throw new Error(`Corpus bytes changed for ${asset.id}`);
				const { width = 1, height = 1 } = await sharp(bytes).metadata();
				const aspect = width / height;
				const targetH = Math.max(1, Math.round(Math.sqrt(10000 / aspect)));
				const targetW = Math.max(1, Math.round(targetH * aspect));
				const rgba = await sharp(bytes)
					.ensureAlpha()
					.resize(targetW, targetH, { fit: "fill" })
					.raw()
					.toBuffer();
				const histogram = hsvHistogram(rgba);
				if (dot(histogram, histogram) === 0)
					throw new Error(
						`Empty visible histogram for ${asset.id}; zero vectors cannot use cosine`,
					);
				measured.push({ id: asset.id, sha256, histogram });
			}
			const extractionMs = performance.now() - started;
			const sourceHashes = await Promise.all(
				metadata.sourceFiles.map(async (filename) => ({
					filename,
					sha256: hash(await readFile(filename)),
				})),
			);
			const descriptorFingerprint = hash(
				JSON.stringify({
					sourceHashes,
					images: measured.map(({ id, sha256 }) => ({ id, sha256 })),
					sharp: sharp.versions,
				}),
			);
			await mkdir(context.runDirectory, { recursive: true });
			const descriptorFile = path.join(
				context.runDirectory,
				`${effective.id}.descriptors.json`,
			);
			await writeFile(
				descriptorFile,
				`${JSON.stringify({ descriptorFingerprint, documents: measured })}\n`,
			);
			const indexStart = performance.now();
			let serverVersion, storeBytes, topology;
			if (useOpenSearch) {
				const server = await request("", undefined, "GET");
				serverVersion = server.version?.number;
				const nodes = await request("_nodes/os,jvm", undefined, "GET");
				topology = {
					endpoint: os.url,
					shards: 1,
					replicas: 0,
					nodes: Object.values(nodes.nodes ?? {})
						.map((node) => ({
							name: node.name,
							roles: node.roles,
							availableProcessors: node.os?.available_processors,
							allocatedProcessors: node.os?.allocated_processors,
							heapMaxBytes: node.jvm?.mem?.heap_max_in_bytes,
						}))
						.sort((a, b) => String(a.name).localeCompare(String(b.name))),
				};
				// Atomic create: an existing index causes resource_already_exists and is untouched.
				await request(
					index,
					{
						settings: { number_of_shards: 1, number_of_replicas: 0 },
						mappings: {
							_meta: {
								colorEvaluation: true,
								descriptorFingerprint,
								candidateId: effective.id,
							},
							properties: {
								wallpaperId: { type: "keyword" },
								colorHistogram: { type: "knn_vector", dimension: 64 },
							},
						},
					},
					"PUT",
				);
				for (let offset = 0; offset < measured.length; offset += 500) {
					const body =
						measured
							.slice(offset, offset + 500)
							.flatMap(({ id, histogram }) => [
								JSON.stringify({ create: { _id: id } }),
								JSON.stringify({ wallpaperId: id, colorHistogram: histogram }),
							])
							.join("\n") + "\n";
					const result = await request(`${index}/_bulk`, body);
					if (result.errors)
						throw new Error(
							`OpenSearch bulk errors: ${JSON.stringify(result.items.filter((item) => item.create.error))}`,
						);
				}
				await request(`${index}/_refresh`, {});
				const stats = await request(`${index}/_stats/store`, undefined, "GET");
				storeBytes = stats._all?.total?.store?.size_in_bytes;
			}
			documents = measured;
			setup = {
				documents: measured.length,
				extractionMs,
				indexSetupMs: useOpenSearch ? performance.now() - indexStart : 0,
				descriptorFingerprint,
				descriptorFile,
				sourceHashes,
				sharpVersions: sharp.versions,
				execution: useOpenSearch
					? { kind: effective.execution, version: serverVersion, topology }
					: {
							kind: effective.execution,
							version: process.version,
							topology: {
								scoring: "single-process exhaustive scan",
								threads: 1,
							},
						},
				...(useOpenSearch
					? { index, serverVersion, storeBytes, retainedIndex: true }
					: {}),
			};
			return setup;
		},
		async search({ caseData, limit = 10, signal }) {
			if (!documents || closed)
				throw new Error("Call prepare before search on an open candidate");
			if (!Number.isInteger(limit) || limit <= 0)
				throw new Error("limit must be a positive integer");
			if (useOpenSearch && limit > 10000)
				throw new Error(
					"OpenSearch adapter limit must be <= 10000; deep pagination is not implemented",
				);
			signal?.throwIfAborted();
			const parsed = interpretQuery(caseData.query, names);
			if (!parsed.supported) throw new Error(parsed.reason);
			const vector = buildQueryVector(parsed.colors, effective);
			if (useOpenSearch) {
				const filters =
					caseData.eligibleIds === undefined
						? []
						: [{ terms: { wallpaperId: caseData.eligibleIds } }];
				const mustNot = caseData.excludedIds?.length
					? [{ terms: { wallpaperId: caseData.excludedIds } }]
					: [];
				const eligibility =
					filters.length || mustNot.length
						? { bool: { filter: filters, must_not: mustNot } }
						: { match_all: {} };
				const result = await request(
					`${index}/_search`,
					{
						size: limit,
						track_total_hits: true,
						_source: ["wallpaperId"],
						query: {
							script_score: {
								query: eligibility,
								script: {
									source: "knn_score",
									lang: "knn",
									params: {
										field: "colorHistogram",
										query_value: vector,
										space_type:
											effective.metric === "cosine" ? "cosinesimil" : "l2",
									},
								},
							},
						},
						sort: [{ _score: "desc" }, { wallpaperId: "asc" }],
					},
					"POST",
					signal,
				);
				if (result.timed_out || result._shards?.failed)
					throw new Error("OpenSearch search timed out or had shard failures");
				return {
					hits: result.hits.hits.map((hit) => ({
						id: hit._source.wallpaperId,
						score: hit._score,
					})),
					totalEligible: result.hits.total.value,
					exhaustive: true,
					backendTookMs: result.took,
					semanticsWarnings: parsed.warnings,
					index,
					execution: effective.execution,
				};
			}
			const eligible =
				caseData.eligibleIds === undefined
					? null
					: new Set(caseData.eligibleIds);
			const excluded = new Set(caseData.excludedIds ?? []);
			const norm = Math.sqrt(dot(vector, vector));
			const hits = [];
			for (const { id, histogram } of documents) {
				signal?.throwIfAborted();
				if ((eligible && !eligible.has(id)) || excluded.has(id)) continue;
				const score =
					effective.metric === "cosine"
						? 1 +
							dot(vector, histogram) /
								(norm * Math.sqrt(dot(histogram, histogram)))
						: 1 / (1 + squaredDistance(vector, histogram));
				hits.push({ id, score });
			}
			hits.sort(
				(a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
			);
			return {
				hits: hits.slice(0, limit),
				totalEligible: hits.length,
				exhaustive: true,
				semanticsWarnings: parsed.warnings,
				execution: effective.execution,
			};
		},
		async close() {
			documents = undefined;
			closed = true;
		},
	};
}
