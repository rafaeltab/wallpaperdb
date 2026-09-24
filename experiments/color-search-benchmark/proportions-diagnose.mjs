// Executable research diagnostics, separate from the 100 genuine wallpapers.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
	normalizeQuery,
	hexToLab,
	scorePalette,
	minCostTransport,
} from "./proportions.mjs";
const GREEN = "#008040",
	RED = "#E03030",
	BLACK = "#101010",
	BLUE = "#2060D0",
	ORANGE = "#F08020",
	YELLOW = "#F0D030";
const make = (colors) =>
	colors
		.filter((c) => c.amount > 0)
		.map((c) => ({ lab: hexToLab(c.color), weight: c.amount }));
const color = (color, amount) => ({ color, amount });
const close = (a, b, message) =>
	assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} vs ${b}`);
const cases = [];
function check(name, fn) {
	fn();
	cases.push({ name, passed: true });
}
check(
	"40% green prefers the requested fraction over 0%, 20%, 80% and 100%",
	() => {
		const q = [color(GREEN, 0.4)];
		const rows = [0, 0.2, 0.4, 0.8, 1].map((x) => ({
			green: x,
			cost: scorePalette(make([color(GREEN, x), color(BLACK, 1 - x)]), q).cost,
		}));
		assert.equal(rows.slice().sort((a, b) => a.cost - b.cost)[0].green, 0.4);
		cases.push({ name: "green fraction sweep", rows });
	},
);
check(
	"40% green with different sufficiently distant remainder colors ties closely",
	() => {
		const a = scorePalette(make([color(GREEN, 0.4), color(BLACK, 0.6)]), [
			color(GREEN, 0.4),
		]).cost;
		const b = scorePalette(make([color(GREEN, 0.4), color(RED, 0.6)]), [
			color(GREEN, 0.4),
		]).cost;
		assert.ok(a < 0.005 && b < 0.005);
	},
);
check("Minimum mode allows extra green, exact mode penalizes it", () => {
	const p = make([color(GREEN, 1)]),
		q = [color(GREEN, 0.4)];
	close(scorePalette(p, q, { mode: "minimum" }).cost, 0, "minimum");
	close(scorePalette(p, q).cost, 0.6, "target");
});
check("50% green + 50% red beats 80/20, reversed ratio and missing red", () => {
	const q = [color(GREEN, 0.5), color(RED, 0.5)];
	close(scorePalette(make(q), q).cost, 0, "50/50 match");
	assert.ok(
		scorePalette(make([color(GREEN, 0.8), color(RED, 0.2)]), q).cost > 0.2,
	);
	assert.ok(scorePalette(make([color(GREEN, 1)]), q).cost > 0.4);
});
check("80% red + 20% black distinguishes 20/80 and 50/50", () => {
	const q = [color(RED, 0.8), color(BLACK, 0.2)];
	close(scorePalette(make(q), q).cost, 0, "80/20 match");
	assert.ok(
		scorePalette(make([color(RED, 0.2), color(BLACK, 0.8)]), q).cost > 0.5,
	);
	assert.ok(
		scorePalette(make([color(RED, 0.5), color(BLACK, 0.5)]), q).cost > 0.2,
	);
});
check("Five colors at 20% each beats unequal and absent components", () => {
	const q = [RED, ORANGE, YELLOW, GREEN, BLUE].map((c) => color(c, 0.2));
	close(scorePalette(make(q), q).cost, 0, "rainbow");
	assert.ok(
		scorePalette(make(q.slice(0, 4).map((c) => ({ ...c, amount: 0.25 }))), q)
			.cost > 0.05,
	);
});
check(
	"Duplicate target colors merge; partial fractions are never normalized to 100%",
	() => {
		assert.deepEqual(
			normalizeQuery([color(GREEN, 0.2), color(GREEN.toLowerCase(), 0.2)]),
			[color(GREEN, 0.4)],
		);
		close(
			scorePalette(make([color(GREEN, 1)]), [color(GREEN, 0.4)]).cost,
			0.6,
			"excessgreen",
		);
	},
);
check("Overflow, missing colors and invalid amounts are rejected", () => {
	for (const q of [
		[],
		[color(GREEN, 0)],
		[color(GREEN, NaN)],
		[color(GREEN, -1)],
		[color(GREEN, 0.8), color(RED, 0.4)],
		[color("red", 0.4)],
	])
		assert.throws(() => normalizeQuery(q));
});
check("Palette and request order do not change transport cost", () => {
	const p = make([color(RED, 0.2), color(GREEN, 0.5), color(BLACK, 0.3)]),
		q = [color(ORANGE, 0.3), color(GREEN, 0.4)];
	close(
		scorePalette(p, q).cost,
		scorePalette(p.slice().reverse(), q.slice().reverse()).cost,
		"order",
	);
});
check(
	"Residual rerouting finds the optimum where greedy assignment fails",
	() => {
		const r = minCostTransport(
			[0.5, 0.5],
			[0.5, 0.5],
			[
				[0, 0.1],
				[0.01, 1],
			],
		);
		close(r.cost, 0.055, "globally optimal cross-assignment");
		close(r.plan[0][1], 0.5, "first source moves to second target");
		close(r.plan[1][0], 0.5, "second source uses first target");
	},
);
check("Source mass cannot be counted toward multiple requested colors", () => {
	const p = make([color(RED, 0.2), color(BLACK, 0.8)]),
		q = [color(RED, 0.5), color(ORANGE, 0.5)];
	const r = scorePalette(p, q);
	r.plan.forEach((row, i) =>
		close(
			row.reduce((a, b) => a + b, 0),
			p[i].weight,
			"rowmass",
		),
	);
	for (let j = 0; j < q.length; j++)
		close(
			r.plan.reduce((s, row) => s + row[j], 0),
			q[j].amount,
			"columnmass",
		);
	assert.ok(r.matched.reduce((a, b) => a + b, 0) < 0.21);
	close(
		r.observed.reduce((a, b) => a + b, 0) + r.other,
		1,
		"observedcomposition",
	);
});
check("Single fully specified color reduces to mean color affinity", () => {
	const p = make([color(GREEN, 0.4), color(RED, 0.6)]),
		q = [color(GREEN, 1)];
	close(
		scorePalette(p, q).cost,
		scorePalette(p, q, { method: "legacy" }).cost,
		"single100",
	);
});
const illustrativeQueries = [
	{ id: "green40", colors: [color(GREEN, 0.4)] },
	{ id: "green-red50", colors: [color(GREEN, 0.5), color(RED, 0.5)] },
	{ id: "red-black80", colors: [color(RED, 0.8), color(BLACK, 0.2)] },
	{
		id: "rainbow20",
		colors: [RED, ORANGE, YELLOW, GREEN, BLUE].map((c) => color(c, 0.2)),
	},
];
const fixtures = [
	{ id: "green40-black60", colors: [color(GREEN, 0.4), color(BLACK, 0.6)] },
	{ id: "green80-black20", colors: [color(GREEN, 0.8), color(BLACK, 0.2)] },
	{ id: "green100", colors: [color(GREEN, 1)] },
	{ id: "green50-red50", colors: [color(GREEN, 0.5), color(RED, 0.5)] },
	{ id: "red80-black20", colors: [color(RED, 0.8), color(BLACK, 0.2)] },
	{ id: "red20-black80", colors: [color(RED, 0.2), color(BLACK, 0.8)] },
	{ id: "rainbow20", colors: illustrativeQueries[3].colors },
];
const rankings = Object.fromEntries(
	illustrativeQueries.map((q) => [
		q.id,
		Object.fromEntries(
			["legacy", "coverage", "transport"].map((method) => [
				method,
				fixtures
					.map((f) => ({
						id: f.id,
						...scorePalette(make(f.colors), q.colors, { method }),
					}))
					.sort((a, b) => a.cost - b.cost),
			]),
		),
	]),
);
await writeFile(
	new URL("./proportions-diagnostics.json", import.meta.url),
	JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			cases,
			queries: illustrativeQueries,
			fixtures,
			rankings,
		},
		null,
		2,
	),
);
console.log(
	`Passed ${cases.filter((c) => c.passed).length} proportion diagnostics; saved controlled rankings.`,
);
