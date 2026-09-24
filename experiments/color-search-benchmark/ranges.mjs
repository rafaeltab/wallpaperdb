// THROWAWAY PROTOTYPE: image-area queries against user-defined color regions.
import { hexToLab, minCostTransport } from "./proportions.mjs";

const EPS = 1e-7;
const MASS_EPS = 1e-11;
const clamp = (value) => Math.max(0, Math.min(1, value));
const norm = (values) => Math.hypot(...values);
const finiteUnit = (value) =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= 1;

export function rgbToChannels(rgb) {
	if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(finiteUnit))
		throw new Error("RGB channels must be three numbers between 0 and 1.");
	const [r, g, b] = rgb,
		high = Math.max(...rgb),
		low = Math.min(...rgb),
		delta = high - low;
	const l = (high + low) / 2;
	// Rounded OKLab inverse coefficients can perturb neutral RGB by ~1e-7.
	// Near white, dividing that drift by the tiny HSL denominator would create
	// a spurious saturated color. This is far below one 8-bit channel step.
	const neutral = delta <= 1e-6;
	let h = null;
	if (!neutral) {
		const sector =
			high === r
				? (g - b) / delta
				: high === g
					? (b - r) / delta + 2
					: (r - g) / delta + 4;
		h = (((sector / 6) % 1) + 1) % 1;
	}
	return {
		rgb,
		hsl: { h, s: neutral ? 0 : delta / (1 - Math.abs(2 * l - 1)), l },
		hsv: { h, s: neutral ? 0 : delta / high, v: high },
	};
}

export function labToRgb([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map((c) =>
		clamp(
			c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055,
		),
	);
}

export function rgbToLab(rgb) {
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

const rgbFromHex = (color) =>
	[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);

function normalizeRange(range, anchor) {
	if (!range || typeof range !== "object")
		throw new Error("Choose a color range.");
	if (range.space === "oklab") {
		if (
			typeof range.distance !== "number" ||
			!Number.isFinite(range.distance) ||
			range.distance < 0 ||
			range.distance > 1.5
		)
			throw new Error("OKLab radius must be between 0 and 1.5.");
		return { space: "oklab", distance: range.distance };
	}
	const keys = {
		rgb: ["r", "g", "b"],
		hsl: ["h", "s", "l"],
		hsv: ["h", "s", "v"],
	}[range.space];
	if (!keys) throw new Error("Range space must be oklab, rgb, hsl, or hsv.");
	if (!keys.every((key) => finiteUnit(range[key])))
		throw new Error("Each channel range must be between 0 and 100%.");
	if (range.space !== "rgb" && anchor[range.space].h === null && range.h < 1)
		throw new Error(
			"Hue is undefined for an achromatic anchor; set hue range to 100% (all hues).",
		);
	return Object.fromEntries([
		["space", range.space],
		...keys.map((key) => [key, range[key]]),
	]);
}

export function normalizeRangeQuery(colors) {
	if (!Array.isArray(colors) || !colors.length || colors.length > 10)
		throw new Error("Choose between 1 and 10 color portions.");
	const merged = new Map();
	for (const entry of colors) {
		if (
			!entry ||
			typeof entry.color !== "string" ||
			!/^#[0-9a-f]{6}$/i.test(entry.color)
		)
			throw new Error("Colors must use six-digit hex.");
		if (!finiteUnit(entry.amount))
			throw new Error("Each image percentage must be between 0 and 100.");
		if (
			!Array.isArray(entry.ranges) ||
			!entry.ranges.length ||
			entry.ranges.length > 4
		)
			throw new Error("Each portion needs between 1 and 4 range constraints.");
		const color = entry.color.toUpperCase(),
			anchor = rgbToChannels(rgbFromHex(color));
		const ranges = entry.ranges
			.map((range) => normalizeRange(range, anchor))
			.sort((a, b) => a.space.localeCompare(b.space));
		if (new Set(ranges.map((range) => range.space)).size !== ranges.length)
			throw new Error("Use at most one constraint for each color space.");
		const key = JSON.stringify({ color, ranges });
		const old = merged.get(key);
		if (old) old.amount += entry.amount;
		else merged.set(key, { color, amount: entry.amount, ranges });
	}
	const result = [...merged.values()].filter((entry) => entry.amount > 0);
	const total = result.reduce((s, entry) => s + entry.amount, 0);
	if (total > 1 + MASS_EPS)
		throw new Error("Requested image percentages must add up to at most 100%.");
	if (!total) throw new Error("Request a positive image percentage.");
	if (total > 1)
		result.reduce((a, b) => (a.amount > b.amount ? a : b)).amount -= total - 1;
	return result;
}

export function compileRangeQuery(colors) {
	const targets = normalizeRangeQuery(colors);
	const compiled = targets.map((target) => ({
		...target,
		...rgbToChannels(rgbFromHex(target.color)),
		lab: hexToLab(target.color),
	}));
	const requested = targets.reduce((s, t) => s + t.amount, 0);
	return {
		kind: "range-query",
		targets,
		compiled,
		requested,
		remainder: Math.max(0, 1 - requested),
	};
}

function outside(point, target) {
	let distance = 0;
	for (const range of target.ranges) {
		let d;
		if (range.space === "oklab") {
			d = Math.max(
				0,
				norm(point.lab.map((x, i) => x - target.lab[i])) - range.distance - EPS,
			);
		} else if (range.space === "rgb") {
			d =
				norm(
					["r", "g", "b"].map((key, i) =>
						Math.max(
							0,
							Math.abs(point.rgb[i] - target.rgb[i]) - range[key] - EPS,
						),
					),
				) / Math.sqrt(3);
		} else {
			const p = point[range.space],
				t = target[range.space];
			let hue = 0;
			if (range.h < 1) {
				// An achromatic candidate has no hue and cannot meet a restricted hue.
				if (p.h === null) hue = 1;
				else {
					const raw = Math.abs(p.h - t.h);
					hue = Math.max(0, 2 * Math.min(raw, 1 - raw) - range.h - EPS);
				}
			}
			const axis = range.space === "hsl" ? "l" : "v";
			d = Math.max(
				hue,
				Math.max(0, Math.abs(p.s - t.s) - range.s - EPS),
				Math.max(0, Math.abs(p[axis] - t[axis]) - range[axis] - EPS),
			);
		}
		distance = Math.max(distance, d);
	}
	return distance;
}

export function distanceOutsideRange(rgb, target) {
	const point = { ...rgbToChannels(rgb), lab: rgbToLab(rgb) };
	const compiled = compileRangeQuery([{ ...target, amount: 1 }]);
	return outside(point, compiled.compiled[0]);
}

export function containsRange(rgb, target) {
	return distanceOutsideRange(rgb, target) === 0;
}

function centerDistance(point, target) {
	const scaled = (delta, tolerance) =>
		tolerance >= 1
			? 0
			: tolerance === 0
				? delta <= EPS
					? 0
					: Infinity
				: delta / tolerance;
	let distance = 0;
	for (const range of target.ranges) {
		let d;
		if (range.space === "oklab") {
			const delta = norm(point.lab.map((x, i) => x - target.lab[i]));
			d =
				range.distance === 0
					? delta <= EPS
						? 0
						: Infinity
					: delta / range.distance;
		} else if (range.space === "rgb") {
			d = Math.max(
				...["r", "g", "b"].map((key, i) =>
					scaled(Math.abs(point.rgb[i] - target.rgb[i]), range[key]),
				),
			);
		} else {
			const p = point[range.space],
				t = target[range.space],
				axis = range.space === "hsl" ? "l" : "v";
			let hue = 0;
			if (range.h < 1) {
				const raw = p.h === null ? Infinity : Math.abs(p.h - t.h);
				hue =
					p.h === null ? Infinity : scaled(2 * Math.min(raw, 1 - raw), range.h);
			}
			d = Math.max(
				hue,
				scaled(Math.abs(p.s - t.s), range.s),
				scaled(Math.abs(p[axis] - t[axis]), range[axis]),
			);
		}
		distance = Math.max(distance, d);
	}
	return distance;
}

export function rangePreference(rgb, target) {
	const point = { ...rgbToChannels(rgb), lab: rgbToLab(rgb) };
	const compiled = compileRangeQuery([{ ...target, amount: 1 }]).compiled[0];
	return outside(point, compiled) > 0
		? 0
		: 2 ** -(Math.min(1, centerDistance(point, compiled)) ** 2);
}

/** Minimize (area error, color penalty) lexicographically, without mixing units. */
export function minCostRangeTransport(
	supply,
	demand,
	primaryCosts,
	secondaryCosts,
) {
	const n = supply.length,
		m = demand.length;
	if (
		!n ||
		!m ||
		[primaryCosts, secondaryCosts].some(
			(matrix) => matrix.length !== n || matrix.some((row) => row.length !== m),
		)
	)
		throw new Error("Invalid lexicographic transport dimensions.");
	if (
		[
			...supply,
			...demand,
			...primaryCosts.flat(),
			...secondaryCosts.flat(),
		].some((x) => !Number.isFinite(x) || x < 0)
	)
		throw new Error("Transport inputs must be finite and nonnegative.");
	const total = supply.reduce((s, x) => s + x, 0);
	if (Math.abs(total - demand.reduce((s, x) => s + x, 0)) > 1e-8)
		throw new Error("Transport supply must equal demand.");
	const source = n + m,
		sink = source + 1,
		size = sink + 1,
		graph = Array.from({ length: size }, () => []);
	const add = (from, to, capacity, p, q) => {
		const edge = { to, capacity, p, q, reverse: graph[to].length };
		graph[from].push(edge);
		graph[to].push({
			to: from,
			capacity: 0,
			p: -p,
			q: -q,
			reverse: graph[from].length - 1,
		});
		return edge;
	};
	supply.forEach((mass, i) => add(source, i, mass, 0, 0));
	const edges = supply.map((mass, i) =>
		demand.map((_, j) =>
			add(i, n + j, mass, primaryCosts[i][j], secondaryCosts[i][j]),
		),
	);
	demand.forEach((mass, j) => add(n + j, sink, mass, 0, 0));
	const potentialP = new Float64Array(size),
		potentialQ = new Float64Array(size);
	const less = (ap, aq, bp, bq) =>
		ap < bp - 1e-12 || (Math.abs(ap - bp) <= 1e-12 && aq < bq - 1e-14);
	let flow = 0,
		iterations = 0;
	while (flow < total - MASS_EPS) {
		if (++iterations > 100000)
			throw new Error("Lexicographic transport did not converge.");
		const dp = new Float64Array(size).fill(Infinity),
			dq = new Float64Array(size).fill(Infinity),
			visited = new Uint8Array(size),
			previousNode = new Int32Array(size).fill(-1),
			previousEdge = new Int32Array(size).fill(-1);
		dp[source] = dq[source] = 0;
		for (let step = 0; step < size; step++) {
			let u = -1,
				bp = Infinity,
				bq = Infinity;
			for (let v = 0; v < size; v++)
				if (!visited[v] && less(dp[v], dq[v], bp, bq)) {
					u = v;
					bp = dp[v];
					bq = dq[v];
				}
			if (u < 0) break;
			visited[u] = 1;
			for (let k = 0; k < graph[u].length; k++) {
				const edge = graph[u][k];
				if (edge.capacity <= 0 || visited[edge.to]) continue;
				let rp = edge.p + potentialP[u] - potentialP[edge.to],
					rq = edge.q + potentialQ[u] - potentialQ[edge.to];
				if (rp < -1e-8 || (Math.abs(rp) < 1e-12 && rq < -1e-8))
					throw new Error("Invalid lexicographic residual potential.");
				if (Math.abs(rp) < 1e-12) rp = 0;
				if (rp === 0 && rq < 0 && rq > -1e-8) rq = 0;
				const nextP = dp[u] + rp,
					nextQ = dq[u] + rq;
				if (less(nextP, nextQ, dp[edge.to], dq[edge.to])) {
					dp[edge.to] = nextP;
					dq[edge.to] = nextQ;
					previousNode[edge.to] = u;
					previousEdge[edge.to] = k;
				}
			}
		}
		if (previousNode[sink] < 0)
			throw new Error("No feasible lexicographic transport path.");
		for (let v = 0; v < size; v++)
			if (Number.isFinite(dp[v])) {
				potentialP[v] += dp[v];
				potentialQ[v] += dq[v];
			}
		let amount = total - flow;
		for (let v = sink; v !== source; v = previousNode[v])
			amount = Math.min(
				amount,
				graph[previousNode[v]][previousEdge[v]].capacity,
			);
		for (let v = sink; v !== source; v = previousNode[v]) {
			const edge = graph[previousNode[v]][previousEdge[v]];
			edge.capacity -= amount;
			graph[v][edge.reverse].capacity += amount;
		}
		flow += amount;
	}
	const plan = edges.map((row) =>
		row.map((edge) => graph[edge.to][edge.reverse].capacity),
	);
	const sum = (matrix) =>
		plan.reduce(
			(s, row, i) => s + row.reduce((v, mass, j) => v + mass * matrix[i][j], 0),
			0,
		);
	return {
		cost: sum(primaryCosts),
		colorCost: sum(secondaryCosts),
		plan,
		flow,
		iterations,
	};
}

export function prepareRangePalette(palette) {
	if (
		!Array.isArray(palette) ||
		!palette.length ||
		palette.some(
			(p) =>
				!Array.isArray(p.lab) ||
				p.lab.length !== 3 ||
				!p.lab.every(Number.isFinite) ||
				!Number.isFinite(p.weight) ||
				p.weight < 0,
		)
	)
		throw new Error("Invalid image palette.");
	const total = palette.reduce((s, p) => s + p.weight, 0);
	if (!(total > 0)) throw new Error("Image palette has no visible area.");
	const points = palette
		.filter((p) => p.weight > 0)
		.map((p) => ({
			...rgbToChannels(labToRgb(p.lab)),
			lab: [...p.lab],
			weight: p.weight / total,
		}));
	return { kind: "range-palette", points };
}

export function scoreRangePalette(palette, colors, options = {}) {
	const prepared =
		palette?.kind === "range-palette" ? palette : prepareRangePalette(palette);
	const query =
		colors?.kind === "range-query" ? colors : compileRangeQuery(colors);
	const { targets, compiled, requested, remainder } = query,
		{ points } = prepared;
	const mode = options.mode ?? "target",
		boundary = options.boundary ?? "graded",
		softness = options.softness ?? 0.04;
	if (!["target", "minimum"].includes(mode))
		throw new Error("Unknown proportion mode.");
	if (!["hard", "soft", "graded"].includes(boundary))
		throw new Error("Unknown boundary mode.");
	if (!Number.isFinite(softness) || softness <= 0 || softness > 1)
		throw new Error("Outside softness must be greater than 0 and at most 1.");
	const distances = points.map((p) => compiled.map((t) => outside(p, t)));
	const affinities = distances.map((row, i) =>
		row.map((d, j) =>
			boundary === "hard"
				? d === 0
					? 1
					: 0
				: boundary === "graded"
					? d === 0
						? 2 ** -(Math.min(1, centerDistance(points[i], compiled[j])) ** 2)
						: 0
					: Math.exp(-0.5 * (d / softness) ** 2),
		),
	);
	const available = targets.map(() => 0),
		assigned = targets.map(() => 0),
		supported = targets.map(() => 0);
	let overlap = 0,
		uncovered = 0;
	distances.forEach((row, i) => {
		let memberships = 0;
		row.forEach((d, j) => {
			if (d === 0) {
				available[j] += points[i].weight;
				memberships++;
			}
		});
		if (memberships > 1) overlap += points[i].weight;
		if (memberships === 0) uncovered += points[i].weight;
	});
	const demand = targets.map((t) => t.amount),
		costs = affinities.map((row, i) =>
			row.map((a, j) =>
				boundary === "graded" ? (distances[i][j] === 0 ? 0 : 1) : 1 - a,
			),
		);
	const secondary = affinities.map((row) => row.map((a) => 1 - a));
	if (remainder > 0) {
		demand.push(remainder);
		costs.forEach((row, i) =>
			row.push(
				mode === "target"
					? boundary === "graded"
						? distances[i].some((d) => d === 0)
							? 1
							: 0
						: Math.max(...affinities[i])
					: 0,
			),
		);
		secondary.forEach((row) => row.push(0));
	}
	// Hard memberships have only 2^m patterns. Coalesce identical rows before
	// solving, including when the caller uses source pixels as its reference.
	const groups = new Map();
	costs.forEach((row, i) => {
		const key =
			boundary === "graded"
				? `${row.join(",")};${secondary[i].join(",")}`
				: row.join(",");
		let group = groups.get(key);
		if (!group) {
			group = { costs: row, secondary: secondary[i], mass: 0, indices: [] };
			groups.set(key, group);
		}
		group.mass += points[i].weight;
		group.indices.push(i);
	});
	const grouped = [...groups.values()];
	const solution =
		boundary === "graded"
			? minCostRangeTransport(
					grouped.map((g) => g.mass),
					demand,
					grouped.map((g) => g.costs),
					grouped.map((g) => g.secondary),
				)
			: minCostTransport(
					grouped.map((g) => g.mass),
					demand,
					grouped.map((g) => g.costs),
				);
	const plan = Array.from({ length: points.length }, () =>
		Array(demand.length).fill(0),
	);
	grouped.forEach((group, g) => {
		// Identical cost rows are interchangeable. Proportional expansion is a
		// diagnostic allocation, not unique image segmentation.
		for (const i of group.indices)
			for (let j = 0; j < demand.length; j++)
				plan[i][j] = (solution.plan[g][j] * points[i].weight) / group.mass;
	});
	for (let i = 0; i < points.length; i++)
		for (let j = 0; j < targets.length; j++) {
			if (distances[i][j] === 0) assigned[j] += plan[i][j];
			supported[j] += plan[i][j] * affinities[i][j];
		}
	const cost = clamp(solution.cost);
	const colorCost = solution.colorCost ?? 0;
	return {
		cost,
		score: 1 - cost,
		colorCost,
		preference: boundary === "graded" ? clamp(1 - colorCost / requested) : null,
		targets,
		available,
		assigned,
		supported,
		overlap,
		outside: uncovered,
		plan,
		requested,
		remainder,
		mode,
		boundary,
		groups: groups.size,
	};
}

export const RANGE_PRESETS = [
	{
		id: "red-dark-radius",
		label: "70% near red · 30% near black",
		colors: [
			{
				color: "#FF0000",
				amount: 0.7,
				ranges: [{ space: "oklab", distance: 0.2 }],
			},
			{
				color: "#000000",
				amount: 0.3,
				ranges: [{ space: "oklab", distance: 0.5 }],
			},
		],
	},
	{
		id: "dark-gray",
		label: "70% dark grayscale",
		colors: [
			{
				color: "#000000",
				amount: 0.7,
				ranges: [{ space: "hsl", h: 1, s: 0.02, l: 0.1 }],
			},
		],
	},
	{
		id: "any-dark",
		label: "70% dark · any hue or saturation",
		colors: [
			{
				color: "#000000",
				amount: 0.7,
				ranges: [{ space: "hsv", h: 1, s: 1, v: 0.25 }],
			},
		],
	},
	{
		id: "redish-dark",
		label: "70% red/orange shades · 30% dark",
		colors: [
			{
				color: "#FF0000",
				amount: 0.7,
				ranges: [{ space: "hsl", h: 0.2, s: 0.55, l: 0.35 }],
			},
			{
				color: "#000000",
				amount: 0.3,
				ranges: [{ space: "hsv", h: 1, s: 1, v: 0.25 }],
			},
		],
	},
	{
		id: "rgb-box",
		label: "60% within an RGB box",
		colors: [
			{
				color: "#F08020",
				amount: 0.6,
				ranges: [{ space: "rgb", r: 0.2, g: 0.15, b: 0.12 }],
			},
		],
	},
	{
		id: "combined",
		label: "70% dark red · HSV and RGB",
		colors: [
			{
				color: "#800000",
				amount: 0.7,
				ranges: [
					{ space: "hsv", h: 0.17, s: 0.25, v: 0.25 },
					{ space: "rgb", r: 0.3, g: 0.2, b: 0.2 },
				],
			},
		],
	},
	{
		id: "all-gray",
		label: "100% grayscale · any lightness",
		colors: [
			{
				color: "#000000",
				amount: 1,
				ranges: [{ space: "hsl", h: 1, s: 0.02, l: 1 }],
			},
		],
	},
];
