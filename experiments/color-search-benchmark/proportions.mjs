// PROTOTYPE: dependency-free color-proportion ranking shared by Node and browser.
const EPS = 1e-11;

export function normalizeQuery(colors) {
	if (!Array.isArray(colors) || !colors.length || colors.length > 16)
		throw new Error("Choose between 1 and 16 colors.");
	const merged = new Map();
	for (const entry of colors) {
		if (
			!entry ||
			typeof entry.color !== "string" ||
			!/^#[0-9a-f]{6}$/i.test(entry.color)
		)
			throw new Error("Colors must use six-digit hex, such as #008000.");
		if (
			typeof entry.amount !== "number" ||
			!Number.isFinite(entry.amount) ||
			entry.amount < 0 ||
			entry.amount > 1
		)
			throw new Error("Each percentage must be between 0 and 100.");
		const color = entry.color.toUpperCase();
		merged.set(color, (merged.get(color) ?? 0) + entry.amount);
	}
	const result = [...merged]
		.filter(([, amount]) => amount > 0)
		.map(([color, amount]) => ({ color, amount }));
	const total = result.reduce((s, c) => s + c.amount, 0);
	if (total > 1 + EPS)
		throw new Error("Requested percentages must add up to at most 100%.");
	if (!total)
		throw new Error("Request a positive percentage of at least one color.");
	// Remove only floating-point overshoot (e.g. ten additions of 0.1), never rescale the query.
	if (total > 1)
		result.reduce((a, b) => (a.amount > b.amount ? a : b)).amount -= total - 1;
	return result;
}

export function hexToLab(hex) {
	const linear = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	const [r, g, b] = linear;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

export function labToHex([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return (
		"#" +
		linear
			.map((c) =>
				Math.max(
					0,
					Math.min(
						255,
						Math.round(
							255 *
								(c <= 0.0031308
									? 12.92 * c
									: 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055),
						),
					),
				),
			)
			.map((x) => x.toString(16).padStart(2, "0"))
			.join("")
			.toUpperCase()
	);
}

/** Exact continuous min-cost flow. Residual edges allow earlier allocations to be undone. */
export function minCostTransport(supply, demand, costs) {
	if (
		!supply.length ||
		!demand.length ||
		costs.length !== supply.length ||
		costs.some((row) => row.length !== demand.length)
	)
		throw new Error("Invalid transport dimensions.");
	if (
		[...supply, ...demand, ...costs.flat()].some(
			(x) => !Number.isFinite(x) || x < 0,
		)
	)
		throw new Error(
			"Transport masses and costs must be finite and nonnegative.",
		);
	const supplyTotal = supply.reduce((a, b) => a + b, 0),
		demandTotal = demand.reduce((a, b) => a + b, 0);
	if (Math.abs(supplyTotal - demandTotal) > 1e-8)
		throw new Error("Transport supply must equal demand.");
	const n = supply.length,
		m = demand.length,
		source = n + m,
		sink = source + 1,
		size = sink + 1;
	const graph = Array.from({ length: size }, () => []);
	const add = (from, to, capacity, cost) => {
		const forward = { to, capacity, cost, reverse: graph[to].length };
		const reverse = {
			to: from,
			capacity: 0,
			cost: -cost,
			reverse: graph[from].length,
		};
		graph[from].push(forward);
		graph[to].push(reverse);
		return forward;
	};
	for (let i = 0; i < n; i++) add(source, i, supply[i], 0);
	const edges = supply.map((mass, i) =>
		demand.map((_, j) => add(i, n + j, mass, costs[i][j])),
	);
	for (let j = 0; j < m; j++) add(n + j, sink, demand[j], 0);
	const potential = new Float64Array(size);
	let flow = 0,
		iterations = 0;
	while (flow < supplyTotal - EPS) {
		if (++iterations > 100000)
			throw new Error("Transport solver did not converge.");
		const distance = new Float64Array(size).fill(Infinity),
			visited = new Uint8Array(size);
		const previousNode = new Int32Array(size).fill(-1),
			previousEdge = new Int32Array(size).fill(-1);
		distance[source] = 0;
		for (let step = 0; step < size; step++) {
			let u = -1,
				best = Infinity;
			for (let v = 0; v < size; v++)
				if (!visited[v] && distance[v] < best) {
					best = distance[v];
					u = v;
				}
			if (u < 0) break;
			visited[u] = 1;
			for (let k = 0; k < graph[u].length; k++) {
				const edge = graph[u][k];
				if (edge.capacity <= 0 || visited[edge.to]) continue;
				// Potentials make residual reduced costs nonnegative; clamp numerical roundoff only.
				const reduced = edge.cost + potential[u] - potential[edge.to];
				if (reduced < -1e-8) throw new Error("Invalid residual potential.");
				const next = distance[u] + Math.max(0, reduced);
				if (next < distance[edge.to] - 1e-14) {
					distance[edge.to] = next;
					previousNode[edge.to] = u;
					previousEdge[edge.to] = k;
				}
			}
		}
		if (previousNode[sink] < 0) throw new Error("No feasible transport path.");
		for (let v = 0; v < size; v++)
			if (Number.isFinite(distance[v])) potential[v] += distance[v];
		let amount = supplyTotal - flow;
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
	const cost = plan.reduce(
		(s, row, i) =>
			s + row.reduce((t, weight, j) => t + weight * costs[i][j], 0),
		0,
	);
	return { cost, plan, flow, iterations };
}

export function scorePalette(palette, colors, options = {}) {
	const targets = normalizeQuery(colors);
	const mode = options.mode ?? "target",
		method = options.method ?? "transport",
		tolerance = options.tolerance ?? 0.06;
	if (
		!["target", "minimum"].includes(mode) ||
		!["transport", "coverage", "legacy"].includes(method)
	)
		throw new Error("Unknown matching mode.");
	if (!Number.isFinite(tolerance) || tolerance < 0.005 || tolerance > 0.3)
		throw new Error("Color tolerance must be between 0.005 and 0.3.");
	if (
		!Array.isArray(palette) ||
		!palette.length ||
		palette.some(
			(p) =>
				!Array.isArray(p.lab) ||
				p.lab.length !== 3 ||
				p.lab.some((x) => !Number.isFinite(x)) ||
				!Number.isFinite(p.weight) ||
				p.weight < 0,
		)
	)
		throw new Error("Invalid image palette.");
	const total = palette.reduce((s, p) => s + p.weight, 0);
	if (total <= 0) throw new Error("Image palette has no visible pixels.");
	const points = palette
		.filter((p) => p.weight > 0)
		.map((p) => ({ lab: p.lab, weight: p.weight / total }));
	const labs = targets.map((c) => hexToLab(c.color));
	const affinities = points.map((p) =>
		labs.map((c) =>
			Math.exp(
				-p.lab.reduce((s, x, i) => s + (x - c[i]) ** 2, 0) /
					(2 * tolerance * tolerance),
			),
		),
	);
	const observed = targets.map(() => 0),
		rawAffinity = targets.map(() => 0);
	let other = 0;
	points.forEach((p, i) => {
		const best = Math.max(...affinities[i]);
		const tied = affinities[i]
			.map((v, j) => (Math.abs(v - best) < 1e-12 ? j : -1))
			.filter((j) => j >= 0);
		for (const j of tied) observed[j] += (p.weight * best) / tied.length;
		other += p.weight * (1 - best);
		affinities[i].forEach((v, j) => (rawAffinity[j] += p.weight * v));
	});
	const requested = targets.reduce((s, c) => s + c.amount, 0),
		remainder = Math.max(0, 1 - requested);
	let cost,
		plan = null,
		matched = targets.map(() => 0);
	if (method === "transport") {
		const demand = targets.map((c) => c.amount);
		const costs = affinities.map((row) => row.map((v) => 1 - v));
		if (remainder > 0) {
			demand.push(remainder);
			costs.forEach((row, i) =>
				row.push(mode === "target" ? Math.max(...affinities[i]) : 0),
			);
		}
		const result = minCostTransport(
			points.map((p) => p.weight),
			demand,
			costs,
		);
		cost = result.cost;
		plan = result.plan;
		for (let i = 0; i < points.length; i++)
			for (let j = 0; j < targets.length; j++)
				matched[j] += plan[i][j] * affinities[i][j];
	} else if (method === "coverage") {
		cost =
			mode === "target"
				? (observed.reduce(
						(s, v, j) => s + Math.abs(v - targets[j].amount),
						0,
					) +
						Math.abs(other - remainder)) /
					2
				: observed.reduce(
						(s, v, j) => s + Math.max(0, targets[j].amount - v),
						0,
					);
	} else {
		// Previous presence scorer: amounts are importance weights, so partial fractions are lost.
		cost =
			1 -
			Math.exp(
				targets.reduce(
					(s, c, j) =>
						s +
						(c.amount / requested) * Math.log(Math.max(1e-30, rawAffinity[j])),
					0,
				),
			);
	}
	const bounded = Math.max(0, Math.min(1, cost));
	return {
		cost: bounded,
		score: 1 - bounded,
		observed,
		other,
		targets,
		matched,
		requested,
		remainder,
		plan,
		mode,
		method,
		tolerance,
	};
}
