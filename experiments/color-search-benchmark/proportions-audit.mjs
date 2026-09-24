// PROTOTYPE AUDIT: an independent exhaustive oracle, not the transport implementation.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
	hexToLab,
	minCostTransport,
	normalizeQuery,
	scorePalette,
} from "./proportions.mjs";

const findings = [];
let seed = 0x60260915;
const random = () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 2 ** 32;
};
const integer = (max) => Math.floor(random() * max);
const near = (actual, expected, tolerance = 1e-9) => {
	assert.ok(Number.isFinite(actual), `Non-finite value: ${actual}`);
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`${actual} differs from ${expected} by more than ${tolerance}`,
	);
};
function check(name, fn) {
	try {
		const details = fn();
		findings.push({ name, pass: true, ...details });
		process.stdout.write(`PASS ${name}\n`);
	} catch (error) {
		findings.push({ name, pass: false, error: error.message });
		process.stderr.write(`FAIL ${name}: ${error.message}\n`);
	}
}

// Enumerate every assignment of indivisible source units to remaining destinations.
// Dynamic programming only memoizes equivalent remaining-demand states. This has
// no graph, residual edges, potentials, or greedy steps in common with the solver.
// Integer transport marginals admit an integral optimum, even with real costs.
function exhaustiveCost(supply, demand, costs) {
	const units = supply.flatMap((count, i) => Array(count).fill(i));
	const memo = new Map();
	function visit(remaining, unit) {
		if (unit === units.length) return 0;
		const key = remaining.join(",");
		if (memo.has(key)) return memo.get(key);
		let best = Infinity;
		for (let j = 0; j < remaining.length; j++) {
			if (!remaining[j]) continue;
			remaining[j]--;
			best = Math.min(best, costs[units[unit]][j] + visit(remaining, unit + 1));
			remaining[j]++;
		}
		memo.set(key, best);
		return best;
	}
	return visit([...demand], 0);
}

function verifyPlan(result, supply, demand, costs, tolerance = 1e-9) {
	result.plan.forEach((row, i) => {
		row.forEach((v) => assert.ok(v >= -tolerance));
		near(
			row.reduce((sum, v) => sum + v, 0),
			supply[i],
			tolerance,
		);
	});
	demand.forEach((value, j) =>
		near(
			result.plan.reduce((sum, row) => sum + row[j], 0),
			value,
			tolerance,
		),
	);
	const sum = result.plan.reduce(
		(total, row, i) =>
			total + row.reduce((subtotal, v, j) => subtotal + v * costs[i][j], 0),
		0,
	);
	near(result.cost, sum, tolerance);
	near(
		result.flow,
		supply.reduce((sum, v) => sum + v, 0),
		tolerance,
	);
}

check("Residual rerouting beats greedy matching", () => {
	const supply = [0.5, 0.5],
		demand = [0.5, 0.5],
		costs = [
			[0, 0.1],
			[0.05, 1],
		];
	const result = minCostTransport(supply, demand, costs);
	verifyPlan(result, supply, demand, costs);
	near(result.cost, 0.075);
});

check("500 seeded exhaustive integer-mass comparisons and permutations", () => {
	let maxError = 0;
	for (let trial = 0; trial < 500; trial++) {
		const n = 1 + integer(4),
			m = 1 + integer(4),
			total = 2 + integer(9);
		const source = Array(n).fill(0),
			target = Array(m).fill(0);
		for (let unit = 0; unit < total; unit++) {
			source[integer(n)]++;
			target[integer(m)]++;
		}
		const costs = source.map(() =>
			target.map(() =>
				trial % 5 === 0 ? integer(3) / 2 : integer(1001) / 1000,
			),
		);
		const supply = source.map((v) => v / total);
		const demand = target.map((v) => v / total);
		const expected = exhaustiveCost(source, target, costs) / total;
		const actual = minCostTransport(supply, demand, costs);
		verifyPlan(actual, supply, demand, costs);
		near(actual.cost, expected);
		maxError = Math.max(maxError, Math.abs(actual.cost - expected));
		const reversed = minCostTransport(
			[...supply].reverse(),
			[...demand].reverse(),
			costs.map((row) => [...row].reverse()).reverse(),
		);
		near(reversed.cost, expected);
	}
	return { cases: 500, additionalPermutations: 500, maxError };
});

check("1000 continuous 2x2 problems agree with analytic optimum", () => {
	let maxError = 0;
	for (let trial = 0; trial < 1000; trial++) {
		const a = random(),
			b = random();
		const supply = [a, 1 - a],
			demand = [b, 1 - b];
		const costs = [
			[random(), random()],
			[random(), random()],
		];
		// Every feasible 2x2 plan has one free variable x=f[0,0].
		const lower = Math.max(0, a + b - 1),
			upper = Math.min(a, b);
		const slope = costs[0][0] - costs[0][1] - costs[1][0] + costs[1][1];
		const x = slope < 0 ? upper : lower;
		const expected =
			x * costs[0][0] +
			(a - x) * costs[0][1] +
			(b - x) * costs[1][0] +
			(1 - a - b + x) * costs[1][1];
		const actual = minCostTransport(supply, demand, costs);
		verifyPlan(actual, supply, demand, costs);
		near(actual.cost, expected);
		maxError = Math.max(maxError, Math.abs(actual.cost - expected));
	}
	return { cases: 1000, maxError };
});

check("Zero and tiny marginal masses remain feasible", () => {
	const tiny = 1e-12;
	const supply = [...Array(31).fill(tiny), 1 - 31 * tiny];
	const demand = [0.4, 0.6];
	const costs = supply.map((_, i) => (i === 31 ? [1, 0] : [0, 1]));
	const result = minCostTransport(supply, demand, costs);
	verifyPlan(result, supply, demand, costs);
	near(result.cost, 0.4 - 31 * tiny);
});

check(
	"Roundoff correction does not create a negative requested fraction",
	() => {
		const normalized = normalizeQuery([
			{ color: "#00FF00", amount: 0.6 },
			{ color: "#FF0000", amount: 0.400000000001 },
			{ color: "#000000", amount: 1e-13 },
		]);
		assert.ok(normalized.every((entry) => entry.amount >= 0));
		near(
			normalized.reduce((sum, entry) => sum + entry.amount, 0),
			1,
		);
	},
);

const point = (color, weight) => ({ lab: hexToLab(color), weight });
check("Exact 40% and at-least 40% have distinct intended rankings", () => {
	const query = [{ color: "#00FF00", amount: 0.4 }];
	for (const fraction of [0, 0.2, 0.4, 0.6, 1]) {
		const palette = [
			point("#00FF00", fraction),
			point("#000000", 1 - fraction),
		];
		const exact = scorePalette(palette, query);
		const minimum = scorePalette(palette, query, { mode: "minimum" });
		near(exact.cost, Math.abs(fraction - 0.4));
		near(minimum.cost, Math.max(0, 0.4 - fraction));
	}
});

check("Duplicate and reordered nearby targets conserve support", () => {
	const palette = [point("#FF0000", 0.2), point("#000000", 0.8)];
	const query = [
		{ color: "#FF0000", amount: 0.2 },
		{ color: "#FE0100", amount: 0.2 },
	];
	const direct = scorePalette(palette, query);
	const reordered = scorePalette([...palette].reverse(), [...query].reverse());
	near(direct.cost, reordered.cost);
	const byColor = new Map(
		direct.targets.map((entry, i) => [entry.color, direct.observed[i]]),
	);
	reordered.targets.forEach((entry, i) =>
		near(reordered.observed[i], byColor.get(entry.color)),
	);
	assert.ok(direct.matched.reduce((sum, v) => sum + v, 0) <= 0.20000001);
	near(direct.observed.reduce((sum, v) => sum + v, 0) + direct.other, 1);
	const duplicate = scorePalette(palette, [
		{ color: "#ff0000", amount: 0.2 },
		{ color: "#FF0000", amount: 0.2 },
	]);
	const merged = scorePalette(palette, [{ color: "#FF0000", amount: 0.4 }]);
	near(duplicate.cost, merged.cost);
	assert.equal(duplicate.targets.length, 1);
});

check("Equidistant target ties do not depend on input order", () => {
	const colors = ["#FF0000", "#FE0100"];
	const labs = colors.map(hexToLab);
	const palette = [
		{ lab: labs[0].map((v, i) => (v + labs[1][i]) / 2), weight: 1 },
	];
	const targets = colors.map((color) => ({ color, amount: 0.5 }));
	const result = scorePalette(palette, targets);
	const reverse = scorePalette(palette, [...targets].reverse());
	near(result.cost, reverse.cost);
	near(result.observed[0], result.observed[1]);
	near(reverse.observed[0], reverse.observed[1]);
	near(
		result.matched.reduce((sum, v) => sum + v, 0),
		1 - result.cost,
	);
});

const report = {
	seed: "0x60260915",
	approach:
		"Independent exhaustive unit-assignment oracle and closed-form 2x2 optimum; no production transport internals reused.",
	passed: findings.filter((finding) => finding.pass).length,
	failed: findings.filter((finding) => !finding.pass).length,
	findings,
};
await writeFile(
	new URL("./proportions-audit.json", import.meta.url),
	`${JSON.stringify(report, null, 2)}\n`,
);
if (report.failed) process.exitCode = 1;
