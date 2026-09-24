// THROWAWAY PROTOTYPE: exact joint hard-region allocation from sparse membership atoms.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import {
	JOINT_PROPERTIES,
	unionKey,
	jointQuery,
	jointReference,
} from "./global-joint.mjs";
import { minCostTransport } from "./proportions.mjs";
import {
	api,
	bulk,
	recreateIndex,
	saveJson,
	metadataProperties,
	randomGenerator,
} from "./global-common.mjs";
import { openPit, closePit } from "./global-bounded.mjs";
import { jointTieThreshold } from "./global-joint-bounded.mjs";
import { FAST_MULTI_SCRIPT } from "./global-multi-fast-source.mjs";

export const ATOM_COUNT_BASE = 2 ** 32;
export const SYNTHETIC_TOTAL = 1_000_000_000;
export const MULTI_EPSILON = 1e-10;
export const MULTI_FAMILY_IDS = NATIVE_FAMILIES.map((f) => f.id);
const familyPosition = new Map(MULTI_FAMILY_IDS.map((id, i) => [id, i]));
const familyCount = MULTI_FAMILY_IDS.length;
assert.ok(
	familyCount <= 18,
	"Packed mask schema currently supports 18 fixed families.",
);
const pairs = MULTI_FAMILY_IDS.flatMap((a, i) =>
	MULTI_FAMILY_IDS.slice(i + 1).map((b, j) => ({
		a,
		b,
		i,
		j: i + j + 1,
		key: unionKey(a, b),
	})),
);
export const MULTI_PROPERTIES = {
	...JOINT_PROPERTIES,
	packed_atoms: { type: "long", index: false, doc_values: true },
	atom_total: { type: "long", index: false, doc_values: true },
};

function validatedAtoms(doc) {
	const total = doc.total ?? doc.atom_total;
	if (!Number.isInteger(total) || total <= 0 || total >= ATOM_COUNT_BASE)
		throw new Error("Atom total must be a positive integer below 2^32.");
	const atoms =
		doc.atoms ??
		doc.packed_atoms?.map((packed) => ({
			mask: Math.floor(packed / ATOM_COUNT_BASE),
			count: packed % ATOM_COUNT_BASE,
		}));
	if (!Array.isArray(atoms) || !atoms.length)
		throw new Error("A nonempty atom histogram is required.");
	const seen = new Set();
	let sum = 0;
	for (const atom of atoms) {
		if (
			!Number.isInteger(atom.mask) ||
			atom.mask < 0 ||
			atom.mask >= 2 ** familyCount ||
			seen.has(atom.mask)
		)
			throw new Error(
				"Atom masks must be unique and within the frozen family bank.",
			);
		if (
			!Number.isInteger(atom.count) ||
			atom.count <= 0 ||
			atom.count >= ATOM_COUNT_BASE
		)
			throw new Error("Atom counts must be positive integers below 2^32.");
		seen.add(atom.mask);
		sum += atom.count;
	}
	if (sum !== total) throw new Error("Atom counts must sum exactly to total.");
	return { atoms, total };
}

/** Largest-remainder quantization preserves total area exactly and deterministically. */
export function quantizeAtoms(entries, total = SYNTHETIC_TOTAL) {
	if (!Number.isInteger(total) || total <= 0 || total >= ATOM_COUNT_BASE)
		throw new Error("Invalid atom quantization total.");
	const merged = new Map();
	for (const entry of entries) {
		if (
			!Number.isInteger(entry.mask) ||
			entry.mask < 0 ||
			entry.mask >= 2 ** familyCount ||
			!Number.isFinite(entry.weight) ||
			entry.weight < 0
		)
			throw new Error("Invalid weighted membership atom.");
		if (entry.weight)
			merged.set(entry.mask, (merged.get(entry.mask) ?? 0) + entry.weight);
	}
	const mass = [...merged.values()].reduce((a, b) => a + b, 0);
	if (!mass) throw new Error("No atom mass.");
	const rows = [...merged].map(([mask, weight]) => {
		const exact = (weight / mass) * total;
		return {
			mask,
			count: Math.floor(exact),
			remainder: exact - Math.floor(exact),
		};
	});
	let remaining = total - rows.reduce((sum, row) => sum + row.count, 0);
	if (remaining < 0 || remaining > rows.length)
		throw new Error("Invalid largest-remainder residual.");
	rows.sort((a, b) => b.remainder - a.remainder || a.mask - b.mask);
	for (let i = 0; i < remaining; i++) rows[i].count++;
	const atoms = rows
		.filter((row) => row.count > 0)
		.map(({ mask, count }) => ({ mask, count }))
		.sort((a, b) => a.mask - b.mask);
	validatedAtoms({ atoms, total });
	return { atoms, total };
}

/** Every filter feature is derived from the exact same integer atoms as the scorer. */
export function describeAtoms(doc) {
	const { atoms, total } = validatedAtoms(doc);
	const coverage = new Float64Array(familyCount),
		intersections = new Float64Array(familyCount * familyCount);
	for (const { mask, count } of atoms) {
		const matched = [];
		for (let bits = mask; bits; bits &= bits - 1) {
			const i = 31 - Math.clz32(bits & -bits);
			coverage[i] += count;
			matched.push(i);
		}
		for (let a = 0; a < matched.length; a++)
			for (let b = a + 1; b < matched.length; b++)
				intersections[matched[a] * familyCount + matched[b]] += count;
	}
	const features = Object.fromEntries(
		MULTI_FAMILY_IDS.map((id, i) => [id, coverage[i] / total]),
	);
	const unions = Object.fromEntries(
		pairs.map(({ i, j, key }) => [
			key,
			(coverage[i] + coverage[j] - intersections[i * familyCount + j]) / total,
		]),
	);
	return { ...doc, atoms, total, features, unions };
}

export function toMultiDocument(input) {
	if (typeof input.id !== "string" || !input.id)
		throw new Error("Multi documents need a stable id.");
	const doc = describeAtoms(input);
	return {
		id: doc.id,
		packed_atoms: doc.atoms.map(
			(atom) => atom.mask * ATOM_COUNT_BASE + atom.count,
		),
		atom_total: doc.total,
		...Object.fromEntries(
			MULTI_FAMILY_IDS.map((id) => [`covj_${id}`, doc.features[id]]),
		),
		...Object.fromEntries(
			pairs.map(({ key }) => [`unionj_${key}`, doc.unions[key]]),
		),
	};
}

export function normalizeMultiQuery(input) {
	if (!Array.isArray(input) || !input.length || input.length > 18)
		throw new Error("Choose between 1 and 5 fixed color families.");
	const merged = new Map();
	for (const color of input) {
		if (
			!familyPosition.has(color?.family) ||
			!Number.isFinite(color.amount) ||
			color.amount < 0 ||
			color.amount > 1
		)
			throw new Error("Unknown family or invalid requested fraction.");
		merged.set(color.family, (merged.get(color.family) ?? 0) + color.amount);
	}
	if (merged.size > 5)
		throw new Error("This prototype supports at most 5 distinct families.");
	const colors = [...merged]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([family, amount]) => ({ family, amount }));
	const total = colors.reduce((sum, c) => sum + c.amount, 0);
	if (total > 1 + MULTI_EPSILON)
		throw new Error("Requested proportions exceed 100%.");
	if (total > 1)
		colors.reduce((a, b) => (a.amount > b.amount ? a : b)).amount -= total - 1;
	return colors;
}

function configuration(input, options) {
	const colors = normalizeMultiQuery(input),
		mode = options.mode ?? "target",
		maxError = options.maxError;
	if (!["target", "minimum"].includes(mode))
		throw new Error("Unknown matching mode.");
	if (options.boundary !== undefined && options.boundary !== "hard")
		throw new Error("Membership atoms support hard region boundaries only.");
	if (options.qualityTieBreak)
		throw new Error("Center-quality tie-breaking is not implemented.");
	if (!["original", "typed"].includes(options.scriptVariant ?? "original"))
		throw new Error("Unknown membership scoring script variant.");
	if (
		maxError !== undefined &&
		(!Number.isFinite(maxError) || maxError < 0 || maxError > 1)
	)
		throw new Error("maxError must be between 0 and 1.");
	const requested = colors.reduce((sum, c) => sum + c.amount, 0),
		bits = colors.map((c) => 1 << familyPosition.get(c.family)),
		cells = 1 << colors.length;
	const demands = Array.from({ length: cells }, (_, mask) =>
		colors.reduce((sum, c, i) => sum + (mask & (1 << i) ? c.amount : 0), 0),
	);
	return { colors, mode, maxError, requested, bits, cells, demands };
}

export function multiReference(doc, input, options = {}) {
	const config = configuration(input, options),
		{ atoms, total } = validatedAtoms(doc),
		histogram = new Float64Array(config.cells);
	for (const { mask, count } of atoms) {
		let local = 0;
		config.bits.forEach((bit, i) => {
			if (mask & bit) local |= 1 << i;
		});
		histogram[local] += count;
	}
	const unionAll = (total - histogram[0]) / total,
		full = config.cells - 1;
	for (let bit = 1; bit < config.cells; bit <<= 1)
		for (let mask = 0; mask < config.cells; mask++)
			if (mask & bit) histogram[mask] += histogram[mask ^ bit];
	let deficit = 0;
	for (let selected = 1; selected < config.cells; selected++)
		deficit = Math.max(
			deficit,
			config.demands[selected] - (total - histogram[full ^ selected]) / total,
		);
	const cost = Math.max(
		0,
		Math.min(
			1,
			deficit +
				(config.mode === "minimum"
					? 0
					: Math.max(0, unionAll - config.requested)),
		),
	);
	const score = Math.fround(1 - cost);
	return {
		cost,
		error: cost,
		score,
		exactScore: 1 - cost,
		sort: [score, doc.id],
		eligible:
			config.maxError === undefined || cost <= config.maxError + MULTI_EPSILON,
		colors: config.colors,
		mode: config.mode,
	};
}

export const MULTI_SCRIPT = `
long total = doc['atom_total'].value;
double[] histogram = new double[params.cells];
for (int p=0;p<doc['packed_atoms'].size();p++) {
  long atom = doc['packed_atoms'].get(p);
  int mask = (int)(atom >>> 32);
  long count = atom & 4294967295L;
  int local = 0;
  for (int i=0;i<params.bits.length;i++) if ((mask & (int)params.bits[i])!=0) local |= 1 << i;
  histogram[local] += count;
}
double unionAll = (total-histogram[0])/total;
int full = params.cells-1;
for (int bit=1;bit<params.cells;bit<<=1) for (int mask=0;mask<params.cells;mask++) if ((mask & bit)!=0) histogram[mask] += histogram[mask ^ bit];
double deficit = 0;
for (int selected=1;selected<params.cells;selected++) deficit = Math.max(deficit,(double)params.demands[selected]-(total-histogram[full ^ selected])/total);
double error = Math.max(0,Math.min(1,deficit+(params.minimum?0:Math.max(0,unionAll-(double)params.requested))));
if (params.bounded && error > (double)params.maxError+0.0000000001) return 0;
return Math.max(0,Math.min(1,1-error));
`.trim();

export function multiQuery(input, options = {}) {
	const config = configuration(input, options),
		{ colors, mode, maxError, requested } = config;
	const size = options.size ?? 20,
		metadataFilters = options.filters ?? options.filter ?? [];
	if (!Array.isArray(metadataFilters))
		throw new Error("Metadata filters must be an array.");
	const filters = [...metadataFilters];
	if (!Number.isInteger(size) || size < 1 || size > 10000)
		throw new Error("Page size must be between 1 and 10000.");
	if (colors.length <= 2 && !options.forceGeneral)
		return {
			...jointQuery(colors, {
				...options,
				filters,
				track_total_hits: options.track_total_hits ?? false,
			}),
			timeout: options.timeout ?? "15s",
		};
	if (maxError !== undefined) {
		const tolerance = maxError + MULTI_EPSILON;
		const range = (amount) => ({
			gte: Math.max(0, amount - tolerance),
			...(mode === "target" ? { lte: Math.min(1, requested + tolerance) } : {}),
		});
		for (const color of colors)
			filters.push({
				range: { [`covj_${color.family}`]: range(color.amount) },
			});
		for (let i = 0; i < colors.length; i++)
			for (let j = i + 1; j < colors.length; j++)
				filters.push({
					range: {
						[`unionj_${unionKey(colors[i].family, colors[j].family)}`]: range(
							colors[i].amount + colors[j].amount,
						),
					},
				});
	}
	const query = {
		script_score: {
			query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
			script: {
				lang: "painless",
				source: options.scriptVariant === "typed" ? FAST_MULTI_SCRIPT : MULTI_SCRIPT,
				params: {
					cells: config.cells,
					bits: config.bits,
					demands: config.demands,
					requested,
					minimum: mode === "minimum",
					bounded: maxError !== undefined,
					maxError: maxError ?? 1,
				},
			},
		},
	};
	return {
		size,
		_source: options._source ?? false,
		track_total_hits: options.track_total_hits ?? false,
		query,
		sort: [{ _score: "desc" }, { id: "asc" }],
		timeout: options.timeout ?? "15s",
		...(maxError !== undefined
			? { min_score: Math.max(0, 1 - maxError - MULTI_EPSILON) }
			: {}),
		...(options.pit ? { pit: options.pit } : {}),
		...(options.search_after ? { search_after: options.search_after } : {}),
		...(options.profile ? { profile: true } : {}),
	};
}

/** Same deterministic three-basis choices and weights as nativeMixture. */
export function multiMixture(i, bases) {
	if (!Number.isInteger(i) || i < 0 || !Array.isArray(bases) || !bases.length)
		throw new Error(
			"Mixtures need a nonnegative integer ID and at least one basis.",
		);
	const random = randomGenerator(
		(Math.imul(i + 1, 2654435761) ^ 0x60160917) >>> 0,
	);
	const parts = [0, 1, 2].map(() => bases[Math.floor(random() * bases.length)]);
	const raw = [random() + 0.01, random() + 0.01, random() + 0.01],
		total = raw.reduce((a, b) => a + b, 0),
		weights = raw.map((w) => w / total);
	const combined = parts.flatMap((part, j) =>
		part.atoms.map((atom) => ({
			mask: atom.mask,
			weight: (weights[j] * atom.count) / part.total,
		})),
	);
	return describeAtoms({
		id: `mix-${String(i).padStart(9, "0")}`,
		cohort: "synthetic",
		partition: i % 100,
		reference_id: parts[0].id,
		...quantizeAtoms(combined),
	});
}

/** Direct adaptive bounds: no coarse token seed, every full page globally certified. */
export async function boundedMultiSearch(index, input, options = {}) {
	if (typeof index !== "string" || !/^color-global-[a-z0-9_-]+$/.test(index))
		throw new Error("Only color-global- scratch indexes are allowed.");
	const started = performance.now(),
		config = configuration(input, options),
		{ colors, mode } = config;
	const size = options.size ?? 20,
		filter = options.filter ?? options.filters ?? [],
		cursor = options.search_after;
	if (!Array.isArray(filter))
		throw new Error("Metadata filters must be an array.");
	if (!Number.isInteger(size) || size < 1 || size > 10000)
		throw new Error("Page size must be between 1 and 10000.");
	if (options.from !== undefined)
		throw new Error("Use search_after for multi pagination.");
	const suppliedPit =
		typeof options.pit === "string" ? options.pit : options.pit?.id;
	if (
		cursor !== undefined &&
		(!Array.isArray(cursor) ||
			cursor.length < 2 ||
			!Number.isFinite(cursor[0]) ||
			cursor[0] < 0 ||
			cursor[0] > 1 ||
			typeof cursor[1] !== "string")
	)
		throw new Error("search_after must be a returned score/id cursor.");
	if (cursor && !suppliedPit)
		throw new Error("Pagination requires the previous PIT.");
	const queryFingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				index,
				colors,
				mode,
				filter,
				forceGeneral: options.forceGeneral ?? false,
				scriptVariant: options.scriptVariant ?? "original",
			}),
		)
		.digest("hex");
	if (options.queryFingerprint && options.queryFingerprint !== queryFingerprint)
		throw new Error("Cursor belongs to a different multi query.");
	let threshold = options.threshold ?? 0.01;
	if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
		throw new Error("Threshold must be between 0 and 1.");
	const keepAlive =
		typeof options.pit === "object"
			? (options.pit.keep_alive ?? "2m")
			: (options.keep_alive ?? "2m");
	let pitId = suppliedPit,
		created = false;
	const timing = { pitMs: 0, seedMs: 0, finalMs: 0, totalMs: 0, requests: 0 };
	const diagnostics = {
		seedCount: 0,
		iterations: [],
		maximumThreshold: 1,
		eligibleTotalKnown: false,
	};
	try {
		if (!pitId) {
			const opened = await openPit(index, keepAlive);
			pitId = opened.pitId;
			created = true;
			timing.pitMs = opened.wallMs;
			timing.requests++;
		}
		for (;;) {
			const body = multiQuery(colors, {
				...options,
				size,
				mode,
				maxError: threshold,
				filters: filter,
				pit: { id: pitId, keep_alive: keepAlive },
				search_after: cursor,
				track_total_hits: options.track_total_hits ?? false,
			});
			body.timeout = options.timeout ?? "15s";
			const response = await api(
				"/_search?allow_partial_search_results=false",
				body,
			);
			timing.finalMs += response.wallMs;
			timing.requests++;
			if (response.body.timed_out || response.body._shards?.failed > 0)
				throw new Error("Incomplete search cannot certify global results.");
			pitId = response.body.pit_id ?? pitId;
			const hits = response.body.hits.hits,
				tieThreshold = hits.length
					? jointTieThreshold(hits.at(-1)._score)
					: null;
			diagnostics.iterations.push({
				threshold,
				hits: hits.length,
				tieThreshold,
				wallMs: response.wallMs,
				took: response.body.took,
				boundedTotal: response.body.hits.total ?? null,
			});
			if (
				threshold === 1 ||
				(hits.length === size && threshold >= tieThreshold)
			) {
				const exhausted = hits.length < size;
				timing.totalMs = performance.now() - started;
				return {
					hits,
					pitId,
					threshold,
					queryFingerprint,
					exhausted,
					next: exhausted
						? null
						: {
								pit: pitId,
								pitId,
								threshold,
								search_after: hits.at(-1).sort,
								queryFingerprint,
							},
					diagnostics,
					timing,
					...(response.body.profile ? { profile: response.body.profile } : {}),
				};
			}
			threshold =
				hits.length === size
					? Math.min(1, Math.max(threshold + MULTI_EPSILON, tieThreshold))
					: Math.min(1, Math.max(1e-6, threshold * 2));
		}
	} catch (error) {
		if (created && pitId) await closePit(pitId).catch(() => {});
		throw error;
	}
}

export async function probeMulti() {
	const index = "color-global-multi-probe",
		random = randomGenerator(0x5c01a),
		selected = ["red", "orange", "yellow", "green", "blue"];
	const bits = selected.map((id) => 1 << familyPosition.get(id));
	const globalMask = (local) =>
		bits.reduce((mask, bit, i) => mask | (local & (1 << i) ? bit : 0), 0);
	const source = [];
	let transportChecks = 0,
		maxDifference = 0;
	for (let i = 0; i < 160; i++) {
		const weighted = Array.from({ length: 32 }, (_, mask) => ({
			mask: globalMask(mask),
			weight: random() < 0.4 ? 0 : random(),
		}));
		const doc = describeAtoms({
			id: `p-${String(i).padStart(4, "0")}`,
			cohort: i % 2 ? "odd" : "even",
			partition: i % 3,
			...quantizeAtoms(weighted),
		});
		source.push(doc);
		for (let k = 1; k <= 5; k++) {
			const weights = Array.from({ length: k + 1 }, () => random() + 0.01),
				total = weights.reduce((a, b) => a + b, 0),
				colors = selected
					.slice(0, k)
					.map((family, j) => ({ family, amount: weights[j] / total }));
			for (const mode of ["target", "minimum"]) {
				const oracle = minCostTransport(
					doc.atoms.map((a) => a.count / doc.total),
					[
						...colors.map((c) => c.amount),
						1 - colors.reduce((s, c) => s + c.amount, 0),
					],
					doc.atoms.map((atom) => [
						...colors.map((c) =>
							atom.mask & (1 << familyPosition.get(c.family)) ? 0 : 1,
						),
						mode === "minimum"
							? 0
							: colors.some(
										(c) => atom.mask & (1 << familyPosition.get(c.family)),
									)
								? 1
								: 0,
					]),
				).cost;
				const difference = Math.abs(
					multiReference(doc, colors, { mode }).cost - oracle,
				);
				maxDifference = Math.max(maxDifference, difference);
				assert.ok(difference < 1e-9);
				transportChecks++;
			}
		}
	}
	source.push(
		describeAtoms({
			id: "exact-rainbow",
			cohort: "fixture",
			partition: 0,
			...quantizeAtoms(bits.map((mask) => ({ mask, weight: 0.2 }))),
		}),
	);
	source.push(
		describeAtoms({
			id: "overlap-rainbow",
			cohort: "fixture",
			partition: 0,
			...quantizeAtoms([
				{ mask: globalMask(31), weight: 0.2 },
				{ mask: 0, weight: 0.8 },
			]),
		}),
	);
	source.push(
		describeAtoms({
			id: "all-overlap-three",
			cohort: "fixture",
			partition: 0,
			...quantizeAtoms([{ mask: globalMask(7), weight: 1 }]),
		}),
	);
	// Same single/pair statistics, different three-way feasibility.
	for (const parity of [0, 1])
		source.push(
			describeAtoms({
				id: `parity-${parity}`,
				cohort: "fixture",
				partition: 0,
				...quantizeAtoms(
					Array.from({ length: 8 }, (_, mask) => ({
						mask: globalMask(mask),
						weight:
							mask.toString(2).replaceAll("0", "").length % 2 === parity
								? 1
								: 0,
					})),
				),
			}),
		);
	const rainbow = selected.map((family) => ({ family, amount: 0.2 }));
	assert.ok(
		Math.abs(
			multiReference(
				source.find((d) => d.id === "exact-rainbow"),
				rainbow,
			).cost,
		) < 1e-12,
	);
	assert.ok(
		Math.abs(
			multiReference(
				source.find((d) => d.id === "overlap-rainbow"),
				rainbow,
			).cost - 0.8,
		) < 1e-12,
	);
	// The highest supported mask and count retain their association through long packing.
	const widest = describeAtoms({
		id: "widest",
		atoms: [{ mask: 2 ** familyCount - 1, count: ATOM_COUNT_BASE - 1 }],
		total: ATOM_COUNT_BASE - 1,
	});
	assert.ok(Number.isSafeInteger(toMultiDocument(widest).packed_atoms[0]));
	assert.deepEqual(describeAtoms(toMultiDocument(widest)).atoms, widest.atoms);
	for (const doc of source)
		assert.equal(
			multiReference(doc, rainbow).score,
			multiReference(toMultiDocument(doc), rainbow).score,
		);
	const mixture = multiMixture(17, source);
	assert.deepEqual(mixture, multiMixture(17, source));
	assert.equal(mixture.total, SYNTHETIC_TOTAL);
	assert.equal(
		mixture.atoms.reduce((sum, atom) => sum + atom.count, 0),
		SYNTHETIC_TOTAL,
	);
	await recreateIndex(
		index,
		{ ...metadataProperties, ...MULTI_PROPERTIES },
		{ number_of_shards: 3, refresh_interval: "-1" },
	);
	await bulk(
		index,
		source.map((d) => ({
			...toMultiDocument(d),
			cohort: d.cohort,
			partition: d.partition,
		})),
	);
	await api(`/${index}/_refresh`, {}, "POST");
	const queries = [
		[{ family: "red", amount: 0.4 }],
		[
			{ family: "red", amount: 0.5 },
			{ family: "orange", amount: 0.5 },
		],
		selected.slice(0, 3).map((family) => ({ family, amount: 1 / 3 })),
		[
			{ family: "red", amount: 0.2 },
			{ family: "orange", amount: 0.2 },
			{ family: "yellow", amount: 0.6 },
		],
		rainbow,
		selected.slice(0, 3).map((family) => ({ family, amount: 0.2 })),
	];
	let queriesChecked = 0;
	const oracle = (colors, options = {}) =>
		source
			.filter((d) => !options.filtered || d.cohort === "even")
			.map((d) => ({ id: d.id, ...multiReference(d, colors, options) }))
			.filter((d) => d.eligible)
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	for (const scriptVariant of ["original", "typed"])
	for (const colors of queries)
		for (const mode of ["target", "minimum"])
			for (const maxError of [undefined, 0, 0.1, 0.4, 1])
				for (const filtered of [false, true]) {
					const options = {
						scriptVariant,
						mode,
						maxError,
						filtered,
						size: 1000,
						filters: filtered ? [{ term: { cohort: "even" } }] : [],
						track_total_hits: true,
						forceGeneral: true,
					};
					const expected = oracle(colors, options),
						response = (
							await api(
								`/${index}/_search?allow_partial_search_results=false`,
								multiQuery(colors, options),
							)
						).body;
					assert.equal(response.timed_out, false);
					assert.equal(response._shards.failed, 0);
					assert.deepEqual(
						response.hits.hits.map((h) => h._id),
						expected.map((d) => d.id),
					);
					response.hits.hits.forEach((h, i) =>
						assert.equal(Math.fround(h._score), expected[i].score),
					);
					queriesChecked++;
				}
	// Compare the one/two-family optimized path with the general script on identical atoms.
	let fastPathChecks = 0;
	for (const colors of queries.slice(0, 2)) {
		const body = multiQuery(colors, { size: 1000, track_total_hits: true }),
			response = (await api(`/${index}/_search`, body)).body;
		assert.deepEqual(
			response.hits.hits.map((h) => h._id),
			oracle(colors).map((d) => d.id),
		);
		for (const doc of source)
			assert.ok(
				Math.abs(
					multiReference(doc, colors).cost - jointReference(doc, colors).cost,
				) < 1e-9,
			);
		fastPathChecks++;
	}
	const pits = new Set(),
		pagination = [];
	try {
		for (const mode of ["target", "minimum"]) {
			const expected = oracle(rainbow, { mode });
			let response = await boundedMultiSearch(index, rainbow, {
					size: 13,
					mode,
					threshold: 0,
				}),
				all = [],
				pages = 0,
				widenings = 0;
			for (;;) {
				pits.add(response.pitId);
				assert.deepEqual(
					response.hits.map((h) => h._id),
					expected.slice(all.length, all.length + 13).map((d) => d.id),
				);
				all.push(...response.hits.map((h) => h._id));
				pages++;
				widenings += response.diagnostics.iterations.length - 1;
				if (response.exhausted) break;
				assert.ok(pages < 100);
				response = await boundedMultiSearch(index, rainbow, {
					size: 13,
					mode,
					...response.next,
				});
			}
			assert.equal(all.length, source.length);
			assert.equal(new Set(all).size, source.length);
			pagination.push({ mode, documents: all.length, pages, widenings });
		}
		const snapshot = await boundedMultiSearch(index, rainbow, { size: 10 });
		pits.add(snapshot.pitId);
		const inserted = {
			...source.find((d) => d.id === "exact-rainbow"),
			id: "000-inserted-rainbow",
		};
		await bulk(index, [
			{ ...toMultiDocument(inserted), cohort: "fixture", partition: 0 },
		]);
		await api(`/${index}/_refresh`, {}, "POST");
		const old = await boundedMultiSearch(index, rainbow, {
			size: 10,
			pit: snapshot.pitId,
			threshold: snapshot.threshold,
		});
		assert.deepEqual(
			old.hits.map((h) => h._id),
			oracle(rainbow)
				.slice(0, 10)
				.map((d) => d.id),
		);
		const fresh = await boundedMultiSearch(index, rainbow, { size: 10 });
		pits.add(fresh.pitId);
		assert.equal(fresh.hits[0]._id, inserted.id);
	} finally {
		for (const pitId of pits) await closePit(pitId);
	}
	const adversarialTies = await probeMultiTies();
	const output = {
		generatedAt: new Date().toISOString(),
		version: (await api("/")).body.version,
		documents: source.length,
		families: familyCount,
		transportChecks,
		maxDifference,
		queriesChecked,
		fastPathChecks,
		pagination,
		adversarialTies,
		snapshotPassed: true,
		exactRainbowError: 0,
		overlappingRainbowError: 0.8,
		passed: true,
	};
	await saveJson("global-multi-probe.json", output);
	console.log(JSON.stringify(output, null, 2));
	return output;
}

/** Partial three-family request whose score tie crosses an exact error bound. */
async function probeMultiTies() {
	const index = "color-global-multi-tie-probe";
	const colors = ["red", "orange", "yellow"].map((family) => ({ family, amount: 0.2 }));
	const bits = colors.map((color) => 1 << familyPosition.get(color.family));
	const docs = [["z-better", 0], ["a-tied-worse", 15], ["000-next-bin", 40]].map(([id, delta]) => describeAtoms({
		id, total: SYNTHETIC_TOTAL,
		atoms: [
			{ mask: bits[0], count: 400_000_000 + delta },
			{ mask: bits[1], count: 200_000_000 },
			{ mask: bits[2], count: 200_000_000 },
			{ mask: 0, count: 200_000_000 - delta },
		],
	}));
	const expected = docs.map((doc) => ({ id: doc.id, ...multiReference(doc, colors) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	assert.deepEqual(expected.map((doc) => doc.id), ["a-tied-worse", "z-better", "000-next-bin"]);
	assert.equal(expected[0].score, 0.800000011920929);
	assert.equal(expected[0].score, expected[1].score);
	assert.ok(expected[2].score < expected[1].score);
	for (const doc of docs) assert.equal(multiReference(doc, colors, { mode: "minimum" }).cost, 0);
	await recreateIndex(index, MULTI_PROPERTIES, { number_of_shards: 3, refresh_interval: "-1" });
	await bulk(index, docs.map(toMultiDocument));
	await api(`/${index}/_refresh`, {}, "POST");
	const results = [];
	for (const scriptVariant of ["original", "typed"]) {
		const exactBound = (await api(`/${index}/_search?allow_partial_search_results=false`, multiQuery(colors, { scriptVariant, size: 3, maxError: 0.2 }))).body;
		assert.deepEqual(exactBound.hits.hits.map((hit) => hit._id), ["z-better"]);
		let page, pitId;
		try {
			page = await boundedMultiSearch(index, colors, { scriptVariant, size: 1, threshold: 0.2 });
			pitId = page.pitId;
			assert.equal(page.hits[0]._id, "a-tied-worse");
			assert.ok(page.threshold > 0.2);
			assert.equal(page.diagnostics.iterations.length, 2);
			const ids = [page.hits[0]._id], firstThreshold = page.threshold;
			for (let i = 1; i < expected.length; i++) {
				page = await boundedMultiSearch(index, colors, { scriptVariant, size: 1, ...page.next });
				pitId = page.pitId;
				assert.equal(page.hits[0]._id, expected[i].id);
				assert.equal(Math.fround(page.hits[0]._score), expected[i].score);
				ids.push(page.hits[0]._id);
			}
			results.push({ scriptVariant, requestedTotal: 0.6, initialThreshold: 0.2, certifiedThreshold: firstThreshold, ids, scores: expected.map((doc) => doc.score), passed: true });
		} finally {
			if (pitId) await closePit(pitId);
		}
	}
	return results;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href &&
	process.argv.includes("--probe")
)
	await probeMulti();
