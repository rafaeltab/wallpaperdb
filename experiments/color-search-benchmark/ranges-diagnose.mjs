// PROTOTYPE: known-area/color-region contract checks, independent of wallpaper relevance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hexToLab } from "./proportions.mjs";
import * as rangeAPI from "./ranges.mjs";
import {
	normalizeRangeQuery,
	prepareRangePalette,
	compileRangeQuery,
	scoreRangePalette,
	containsRange,
	distanceOutsideRange,
} from "./ranges.mjs";

const { fixtures } = JSON.parse(
	await readFile(new URL("./ranges-fixtures.json", import.meta.url), "utf8"),
);
const byId = new Map(
	fixtures.map((fixture) => [fixture.id.replace(/^range-/, ""), fixture]),
);
const rgb = (hex) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
const point = (color, weight = 1) => ({ lab: hexToLab(color), weight });
const region = (color, amount, ...ranges) => ({ color, amount, ranges });
const red = (amount = 1) =>
	region("#FF0000", amount, { space: "hsl", h: 0.1, s: 0.2, l: 0.15 });
const black = (amount = 1) =>
	region("#000000", amount, { space: "hsl", h: 1, s: 0.02, l: 0.1 });
const dark = (amount = 1) =>
	region("#000000", amount, { space: "hsv", h: 1, s: 1, v: 0.25 });
const score = (id, query, options = {}) =>
	scoreRangePalette(byId.get(id).palette, query, {
		boundary: "hard",
		...options,
	});
const near = (actual, expected, epsilon = 1e-8) => {
	assert.ok(Number.isFinite(actual), `Expected a finite value, got ${actual}`);
	assert.ok(
		Math.abs(actual - expected) <= epsilon,
		`${actual} differs from ${expected} by more than ${epsilon}`,
	);
};
const findings = [];
function check(name, fn) {
	try {
		const details = fn();
		findings.push({ name, passed: true, ...details });
		process.stdout.write(`PASS ${name}\n`);
	} catch (error) {
		findings.push({ name, passed: false, error: error.message });
		process.stderr.write(`FAIL ${name}: ${error.message}\n`);
	}
}
function conserved(result, palette) {
	const total = palette.reduce((sum, p) => sum + p.weight, 0);
	result.plan.forEach((row, i) => {
		row.forEach((value) => assert.ok(value >= -1e-10));
		near(
			row.reduce((sum, value) => sum + value, 0),
			palette[i].weight / total,
		);
	});
	result.targets.forEach((target, j) => {
		near(
			result.plan.reduce((sum, row) => sum + row[j], 0),
			target.amount,
		);
		assert.ok(result.assigned[j] <= target.amount + 1e-8);
		assert.ok(result.supported[j] <= target.amount + 1e-8);
	});
	assert.ok(result.assigned.reduce((sum, value) => sum + value, 0) <= 1 + 1e-8);
}

check("20 synthetic SVG fixtures have valid known-area palettes", () => {
	assert.equal(fixtures.length, 20);
	for (const fixture of fixtures) {
		assert.equal(fixture.synthetic, true);
		assert.ok(fixture.thumbnail.startsWith("./ranges-fixtures/"));
		near(
			fixture.palette.reduce((sum, p) => sum + p.weight, 0),
			1,
		);
		near(
			fixture.paletteHex.reduce((sum, p) => sum + p.weight, 0),
			1,
		);
		fixture.paletteHex.forEach((p, i) => {
			near(p.weight, fixture.palette[i].weight);
			hexToLab(p.color).forEach((v, axis) =>
				near(v, fixture.palette[i].lab[axis]),
			);
		});
	}
});

check("70% red plus 30% neutral black region has zero hard error", () => {
	const query = [red(0.7), black(0.3)];
	for (const id of [
		"red70-black30",
		"red70-darkgray30",
		"red-shades70-black30",
	]) {
		const result = score(id, query);
		near(result.cost, 0);
		near(result.available[0], 0.7);
		near(result.available[1], 0.3);
		near(result.assigned[0], 0.7);
		near(result.assigned[1], 0.3);
		conserved(result, byId.get(id).palette);
	}
	near(score("red50-black50", query).cost, 0.2);
	near(score("red90-black10", query).cost, 0.2);
});

check(
	"Neutral dark-gray region accepts dark gray and rejects bright gray or dark blue",
	() => {
		assert.equal(containsRange(rgb("#161616"), black()), true);
		assert.equal(containsRange(rgb("#808080"), black()), false);
		assert.equal(containsRange(rgb("#000033"), black()), false);
		near(score("red70-darkblue30", [red(0.7), black(0.3)]).cost, 0.3);
		near(score("red70-midgray30", [red(0.7), black(0.3)]).cost, 0.3);
	},
);

check(
	"Any-dark HSV region accepts saturated dark colors while rejecting bright ones",
	() => {
		assert.equal(containsRange(rgb("#000033"), dark()), true);
		assert.equal(containsRange(rgb("#330000"), dark()), true);
		assert.equal(containsRange(rgb("#161616"), dark()), true);
		assert.equal(containsRange(rgb("#0000FF"), dark()), false);
		near(score("dark-hues", [dark()]).cost, 0);
		near(score("red70-darkblue30", [red(0.7), dark(0.3)]).cost, 0);
	},
);

check("Hue distances wrap across 359 and 1 degrees", () => {
	const wide = region("#FF0004", 1, {
		space: "hsl",
		h: 0.02,
		s: 0.01,
		l: 0.01,
	});
	const narrow = region("#FF0004", 1, {
		space: "hsl",
		h: 0.005,
		s: 0.01,
		l: 0.01,
	});
	assert.equal(containsRange(rgb("#FF0400"), wide), true);
	assert.equal(containsRange(rgb("#FF0400"), narrow), false);
	near(distanceOutsideRange(rgb("#FF0400"), wide), 0);
});

check("100% hue range is unrestricted, including the opposite hue", () => {
	for (const space of ["hsl", "hsv"]) {
		const range =
			space === "hsl"
				? { space, h: 1, s: 0, l: 0 }
				: { space, h: 1, s: 0, v: 0 };
		const target = region("#FF0000", 1, range);
		for (const color of ["#FF0000", "#00FFFF", "#00FF00", "#0000FF"]) {
			assert.equal(containsRange(rgb(color), target), true);
		}
	}
});

check("Achromatic anchors require an unrestricted hue range", () => {
	for (const color of ["#000000", "#808080", "#FFFFFF"]) {
		for (const space of ["hsl", "hsv"]) {
			const restricted =
				space === "hsl"
					? { space, h: 0.2, s: 0.1, l: 0.1 }
					: { space, h: 0.2, s: 0.1, v: 0.1 };
			assert.throws(() => normalizeRangeQuery([region(color, 1, restricted)]));
			assert.doesNotThrow(() =>
				normalizeRangeQuery([region(color, 1, { ...restricted, h: 1 })]),
			);
		}
	}
});

check("Achromatic samples do not acquire an arbitrary red hue", () => {
	const target = region("#FF0000", 1, { space: "hsl", h: 0.2, s: 1, l: 1 });
	assert.equal(containsRange(rgb("#808080"), target), false);
});

check("Pure white remains achromatic after the stored OKLab round trip", () => {
	const query = [region("#000000", 1, { space: "hsl", h: 1, s: 0.02, l: 1 })];
	for (const color of ["#000000", "#161616", "#808080", "#FEFEFE", "#FFFFFF"]) {
		assert.equal(containsRange(rgb(color), query[0]), true);
		const result = scoreRangePalette([point(color)], query, {
			boundary: "hard",
		});
		near(result.cost, 0);
		near(result.available[0], 1);
	}
});

check("RGB ranges have independent axes and inclusive boundaries", () => {
	const target = region("#808080", 1, { space: "rgb", r: 0.1, g: 0.2, b: 0.3 });
	const center = 128 / 255;
	assert.equal(
		containsRange([center + 0.1, center + 0.2, center + 0.3], target),
		true,
	);
	assert.equal(
		containsRange([center - 0.1, center - 0.2, center - 0.3], target),
		true,
	);
	assert.equal(
		containsRange([center + 0.10001, center, center], target),
		false,
	);
	assert.equal(
		containsRange([center, center + 0.20001, center], target),
		false,
	);
	assert.equal(
		containsRange([center, center, center + 0.30001], target),
		false,
	);
});

check("Two different coordinate constraints are intersected with AND", () => {
	const target = region(
		"#FF0000",
		1,
		{ space: "hsl", h: 0.05, s: 1, l: 1 },
		{ space: "rgb", r: 0.1, g: 0.3, b: 0.3 },
	);
	assert.equal(containsRange(rgb("#FF1010"), target), true);
	assert.equal(containsRange(rgb("#800000"), target), false); // hue passes, red channel fails
	assert.equal(containsRange(rgb("#FF4000"), target), false); // RGB passes, hue fails
});

check("Zero-radius ranges retain their exact anchor", () => {
	for (const range of [
		{ space: "rgb", r: 0, g: 0, b: 0 },
		{ space: "oklab", distance: 0 },
		{ space: "hsl", h: 0, s: 0, l: 0 },
		{ space: "hsv", h: 0, s: 0, v: 0 },
	]) {
		const target = region("#FF0000", 1, range);
		assert.equal(containsRange(rgb("#FF0000"), target), true);
		near(distanceOutsideRange(rgb("#FF0000"), target), 0);
		assert.equal(containsRange(rgb("#FE0000"), target), false);
	}
});

check("OKLab distance boundary is inclusive", () => {
	const origin = hexToLab("#FF0000"),
		candidate = hexToLab("#CC1010");
	const distance = Math.hypot(...origin.map((v, i) => v - candidate[i]));
	assert.equal(
		containsRange(
			rgb("#CC1010"),
			region("#FF0000", 1, { space: "oklab", distance }),
		),
		true,
	);
	assert.equal(
		containsRange(
			rgb("#CC1010"),
			region("#FF0000", 1, { space: "oklab", distance: distance - 1e-5 }),
		),
		false,
	);
});

check(
	"Same anchor with different regions is retained as separate targets",
	() => {
		const query = [black(0.5), dark(0.5)];
		assert.equal(normalizeRangeQuery(query).length, 2);
		const palette = [point("#101010", 0.5), point("#000033", 0.5)];
		const result = scoreRangePalette(palette, query, { boundary: "hard" });
		assert.equal(result.targets.length, 2);
		near(result.cost, 0);
		conserved(result, palette);
	},
);

check(
	"Duplicate identical regions merge, even with reordered constraints",
	() => {
		const constraints = [
			{ space: "hsl", h: 0.1, s: 0.2, l: 0.2 },
			{ space: "rgb", r: 0.3, g: 0.2, b: 0.2 },
		];
		const query = [
			region("#ff0000", 0.2, ...constraints),
			region("#FF0000", 0.3, ...[...constraints].reverse()),
		];
		const normalized = normalizeRangeQuery(query);
		assert.equal(normalized.length, 1);
		near(normalized[0].amount, 0.5);
	},
);

check(
	"Overlapping available area is reported but never double-counted as assigned",
	() => {
		const query = [
			region("#FF0000", 0.2, { space: "rgb", r: 0.1, g: 0.1, b: 0.1 }),
			region("#FF0100", 0.2, { space: "rgb", r: 0.1, g: 0.1, b: 0.1 }),
		];
		const palette = [point("#FF0000", 0.2), point("#000000", 0.8)];
		const result = scoreRangePalette(palette, query, { boundary: "hard" });
		near(result.available[0], 0.2);
		near(result.available[1], 0.2);
		near(result.overlap, 0.2);
		near(result.outside, 0.8);
		near(
			result.assigned.reduce((sum, value) => sum + value, 0),
			0.2,
		);
		near(result.cost, 0.2);
		conserved(result, palette);
	},
);

check("Zero error for overlapping regions means a feasible partition", () => {
	const query = [
		region("#000000", 0.5, { space: "rgb", r: 1, g: 1, b: 1 }),
		region("#FFFFFF", 0.5, { space: "hsv", h: 1, s: 1, v: 1 }),
	];
	const palette = [point("#FF0000")];
	const result = scoreRangePalette(palette, query, { boundary: "hard" });
	near(result.cost, 0);
	near(result.available[0], 1);
	near(result.available[1], 1);
	near(result.assigned[0], 0.5);
	near(result.assigned[1], 0.5);
	near(result.overlap, 1);
	conserved(result, palette);
});

check("Exact 40% penalizes excess while minimum mode permits it", () => {
	const query = [
		region("#00FF00", 0.4, { space: "rgb", r: 0.01, g: 0.01, b: 0.01 }),
	];
	near(score("green40-black60", query).cost, 0);
	near(score("green20-black80", query).cost, 0.2);
	near(score("green100", query).cost, 0.6);
	near(score("green100", query, { mode: "minimum" }).cost, 0);
});

check("Soft boundaries keep full credit throughout a region", () => {
	const query = [red(0.7), black(0.3)];
	for (const id of [
		"red70-black30",
		"red70-darkgray30",
		"red-shades70-black30",
	]) {
		const result = score(id, query, { boundary: "soft", softness: 0.04 });
		near(result.cost, 0);
		near(
			result.supported.reduce((sum, value) => sum + value, 0),
			1,
		);
	}
});

check("Soft credit falls continuously outside the region", () => {
	const target = region("#FF0000", 1, { space: "rgb", r: 0.1, g: 0.1, b: 0.1 });
	const close = rgb("#D90000"),
		far = rgb("#CC0000");
	const closeDistance = distanceOutsideRange(close, target),
		farDistance = distanceOutsideRange(far, target);
	assert.ok(closeDistance > 0 && farDistance > closeDistance);
	const softness = 0.04;
	const closeScore = scoreRangePalette([point("#D90000")], [target], {
		boundary: "soft",
		softness,
	});
	const farScore = scoreRangePalette([point("#CC0000")], [target], {
		boundary: "soft",
		softness,
	});
	assert.ok(closeScore.score > farScore.score && farScore.score > 0);
	near(
		closeScore.score,
		Math.exp(-(closeDistance ** 2) / (2 * softness ** 2)),
		1e-6,
	);
	near(
		farScore.score,
		Math.exp(-(farDistance ** 2) / (2 * softness ** 2)),
		1e-6,
	);
});

check(
	"Graded range edges retain full area and receive half of center quality",
	() => {
		const query = [
			region("#FF0000", 0.7, { space: "rgb", r: 0.2, g: 0, b: 0 }),
		];
		const center = scoreRangePalette(
			[point("#FF0000", 0.7), point("#000000", 0.3)],
			query,
			{ boundary: "graded" },
		);
		const edge = scoreRangePalette(
			[point("#CC0000", 0.7), point("#000000", 0.3)],
			query,
			{ boundary: "graded" },
		);
		near(center.cost, 0);
		near(edge.cost, 0);
		near(edge.available[0], 0.7);
		near(edge.assigned[0], 0.7);
		near(center.colorCost, 0);
		near(edge.colorCost, 0.35, 1e-6);
		assert.ok(center.colorCost < edge.colorCost);
	},
);

check(
	"Graded ranking prioritizes a closer amount over a more central color",
	() => {
		const query = [
			region("#FF0000", 0.7, { space: "rgb", r: 0.2, g: 0, b: 0 }),
		];
		const exactEdge = scoreRangePalette(
			[point("#CC0000", 0.7), point("#000000", 0.3)],
			query,
			{ boundary: "graded" },
		);
		const wrongCore = scoreRangePalette(
			[point("#FF0000", 0.65), point("#000000", 0.35)],
			query,
			{ boundary: "graded" },
		);
		near(exactEdge.cost, 0);
		near(wrongCore.cost, 0.05);
		assert.ok(exactEdge.colorCost > wrongCore.colorCost);
		assert.ok(exactEdge.cost < wrongCore.cost);
	},
);

check("Unrestricted axes do not influence graded color preference", () => {
	const target = dark();
	const neutral = rangeAPI.rangePreference(rgb("#333333"), target);
	const blue = rangeAPI.rangePreference(rgb("#000033"), target);
	near(neutral, blue);
	near(neutral, 2 ** -((0.2 / 0.25) ** 2));
	const all = region("#FF0000", 1, { space: "hsv", h: 1, s: 1, v: 1 });
	for (const color of ["#FF0000", "#00FFFF", "#161616", "#FFFFFF"])
		near(rangeAPI.rangePreference(rgb(color), all), 1);
});

check(
	"300 seeded lexicographic transport problems match exhaustive allocation",
	() => {
		assert.equal(typeof rangeAPI.minCostRangeTransport, "function");
		let seed = 0x260916;
		const rand = (max) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return Math.floor((seed / 2 ** 32) * max);
		};
		const earlier = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
		function exhaustive(source, target, primary, secondary) {
			const units = source.flatMap((count, i) => Array(count).fill(i));
			const memo = new Map();
			function visit(left, unit) {
				if (unit === units.length) return [0, 0];
				const key = left.join(",");
				if (memo.has(key)) return memo.get(key);
				let best = [Infinity, Infinity];
				for (let j = 0; j < left.length; j++) {
					if (!left[j]) continue;
					left[j]--;
					const rest = visit(left, unit + 1);
					left[j]++;
					const candidate = [
						rest[0] + primary[units[unit]][j],
						rest[1] + secondary[units[unit]][j],
					];
					if (earlier(candidate, best)) best = candidate;
				}
				memo.set(key, best);
				return best;
			}
			return visit([...target], 0);
		}
		let maxPrimaryError = 0,
			maxSecondaryError = 0;
		for (let trial = 0; trial < 300; trial++) {
			const total = 2 + rand(7),
				n = 1 + rand(4),
				m = 1 + rand(4);
			const source = Array(n).fill(0),
				target = Array(m).fill(0);
			for (let unit = 0; unit < total; unit++) {
				source[rand(n)]++;
				target[rand(m)]++;
			}
			const primary = source.map(() => target.map(() => rand(2)));
			// Integer costs keep exhaustive lexicographic comparison exact.
			const secondary = source.map(() => target.map(() => rand(101)));
			const expected = exhaustive(source, target, primary, secondary);
			const result = rangeAPI.minCostRangeTransport(
				source.map((value) => value / total),
				target.map((value) => value / total),
				primary,
				secondary.map((row) => row.map((value) => value / 100)),
			);
			near(result.cost, expected[0] / total);
			near(result.colorCost, expected[1] / total / 100);
			maxPrimaryError = Math.max(
				maxPrimaryError,
				Math.abs(result.cost - expected[0] / total),
			);
			maxSecondaryError = Math.max(
				maxSecondaryError,
				Math.abs(result.colorCost - expected[1] / total / 100),
			);
			result.plan.forEach((row, i) =>
				near(
					row.reduce((sum, value) => sum + value, 0),
					source[i] / total,
				),
			);
			target.forEach((value, j) =>
				near(
					result.plan.reduce((sum, row) => sum + row[j], 0),
					value / total,
				),
			);
		}
		return { cases: 300, maxPrimaryError, maxSecondaryError };
	},
);

check(
	"500 continuous two-cost problems agree with their analytic optimum",
	() => {
		let seed = 0x70cc30;
		const rand = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 2 ** 32;
		};
		let maxPrimaryError = 0,
			maxSecondaryError = 0;
		for (let trial = 0; trial < 500; trial++) {
			const a = rand(),
				b = rand();
			const primary = [
				[Math.floor(rand() * 2), Math.floor(rand() * 2)],
				[Math.floor(rand() * 2), Math.floor(rand() * 2)],
			];
			const secondary = [
				[rand(), rand()],
				[rand(), rand()],
			];
			const slope = (matrix) =>
				matrix[0][0] - matrix[0][1] - matrix[1][0] + matrix[1][1];
			const primarySlope = slope(primary),
				secondarySlope = slope(secondary);
			const takeUpper =
				primarySlope < 0 || (primarySlope === 0 && secondarySlope < 0);
			const x = takeUpper ? Math.min(a, b) : Math.max(0, a + b - 1);
			const value = (matrix) =>
				x * matrix[0][0] +
				(a - x) * matrix[0][1] +
				(b - x) * matrix[1][0] +
				(1 - a - b + x) * matrix[1][1];
			const result = rangeAPI.minCostRangeTransport(
				[a, 1 - a],
				[b, 1 - b],
				primary,
				secondary,
			);
			near(result.cost, value(primary));
			near(result.colorCost, value(secondary));
			maxPrimaryError = Math.max(
				maxPrimaryError,
				Math.abs(result.cost - value(primary)),
			);
			maxSecondaryError = Math.max(
				maxSecondaryError,
				Math.abs(result.colorCost - value(secondary)),
			);
		}
		return { cases: 500, maxPrimaryError, maxSecondaryError };
	},
);

check(
	"Prepared descriptors and compiled queries preserve scores and conservation",
	() => {
		const query = [red(0.7), black(0.3)];
		for (const fixture of fixtures) {
			const raw = scoreRangePalette(fixture.palette, query, {
				boundary: "hard",
			});
			const prepared = scoreRangePalette(
				prepareRangePalette(fixture.palette),
				compileRangeQuery(query),
				{ boundary: "hard" },
			);
			near(raw.cost, prepared.cost);
			raw.available.forEach((value, i) => near(value, prepared.available[i]));
			conserved(prepared, fixture.palette);
		}
	},
);

check("Query percentages are absolute, finite, and bounded by 100%", () => {
	near(normalizeRangeQuery([red(0.4)])[0].amount, 0.4);
	for (const amount of [-0.1, 1.1, NaN, Infinity, "0.5"])
		assert.throws(() => normalizeRangeQuery([red(amount)]));
	assert.throws(() => normalizeRangeQuery([red(0)]));
	assert.throws(() => normalizeRangeQuery([red(0.7), black(0.4)]));
	assert.throws(() => normalizeRangeQuery([]));
});

check(
	"Range validation rejects missing, repeated, unknown, or invalid constraints",
	() => {
		const invalid = [
			[],
			[{ space: "xyz", x: 0.1, y: 0.1, z: 0.1 }],
			[{ space: "oklab", distance: -1 }],
			[{ space: "oklab", distance: 1.50001 }],
			[{ space: "oklab", distance: NaN }],
			[{ space: "rgb", r: 0.1, g: 0.1 }],
			[{ space: "rgb", r: 0.1, g: 0.1, b: 1.01 }],
			[{ space: "hsl", h: -0.1, s: 0.1, l: 0.1 }],
			[{ space: "hsv", h: 0.1, s: Infinity, v: 0.1 }],
			[
				{ space: "oklab", distance: 0.1 },
				{ space: "oklab", distance: 0.2 },
			],
		];
		for (const ranges of invalid)
			assert.throws(() =>
				normalizeRangeQuery([region("#FF0000", 1, ...ranges)]),
			);
		assert.doesNotThrow(() =>
			normalizeRangeQuery([
				region(
					"#FF0000",
					1,
					{ space: "oklab", distance: 1.5 },
					{ space: "rgb", r: 1, g: 1, b: 1 },
					{ space: "hsl", h: 1, s: 1, l: 1 },
					{ space: "hsv", h: 1, s: 1, v: 1 },
				),
			]),
		);
	},
);

const failed = findings.filter((finding) => !finding.passed);
process.stdout.write(
	`${JSON.stringify({ passed: findings.length - failed.length, failed: failed.length, findings }, null, 2)}\n`,
);
if (failed.length) process.exitCode = 1;
