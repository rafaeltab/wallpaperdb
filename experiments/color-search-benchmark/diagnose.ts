// PROTOTYPE: a deterministic diagnostic of the production representation.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { HsvEmbeddingStrategy } from "../../apps/color-extractor/src/services/hsv-embedding-strategy.js";
import {
	ColorSortService,
	hexToSrgb,
	hexToOklab,
} from "../../apps/gateway/src/services/color-sort.service.js";
import {
	l1,
	dot,
	squaredDistance,
	rgbHistogram,
	rgbCenters,
	mixtureKernel,
	palette,
	paletteCoverage,
} from "./models.js";

const extractor = new HsvEmbeddingStrategy();
const gateway = new ColorSortService({ spreadStrategy: "linear" });
function histogram(hex: string) {
	return extractor.computeHistogram(
		new Uint8Array([...hexToSrgb(hex).map((x) => Math.round(x * 255)), 255]),
	);
}
function cosine(a: number[], b: number[]) {
	return (
		a.reduce((s, x, i) => s + x * b[i], 0) /
		Math.sqrt(
			a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0),
		)
	);
}
const candidates = [
	"#FFFF00",
	"#FFFFFF",
	"#00FFFF",
	"#EEEEEE",
	"#FF0000",
	"#00FF00",
	"#0000FF",
	"#000000",
];
const rows = candidates.map((color) => {
	const q = gateway.buildQueryVector({ colors: [{ color, amount: 1 }] });
	const ranked = candidates
		.map((candidate) => ({
			color: candidate,
			score: cosine(q, histogram(candidate)),
		}))
		.sort((a, b) => b.score - a.score);
	return {
		color,
		queryMass: q.reduce((a, b) => a + b, 0),
		sameColorScore: ranked.find((x) => x.color === color)!.score,
		ranked,
	};
});
await mkdir(new URL("./output/", import.meta.url), { recursive: true });
await writeFile(
	new URL("./output/diagnostics.json", import.meta.url),
	JSON.stringify(rows, null, 2),
);
for (const row of rows)
	console.log(
		`${row.color}: best ${row.ranked[0].color}; self score ${row.sameColorScore.toFixed(4)}; query mass ${row.queryMass.toFixed(2)}`,
	);
const pixels = (color: string) =>
	new Uint8Array([...hexToSrgb(color).map((x) => Math.round(x * 255)), 255]);
const alternatives = Object.fromEntries(
	["l2-raw", "l2-normalized", "rgb512", "palette32"].map((algorithm) => [
		algorithm,
		candidates.map((color) => {
			const raw = gateway.buildQueryVector({ colors: [{ color, amount: 1 }] });
			const q = algorithm === "l2-normalized" ? l1(raw) : raw;
			const rgbq = mixtureKernel(rgbCenters, [{ color, amount: 1 }], 0.08);
			const ranked = candidates
				.map((candidate) => ({
					color: candidate,
					score: algorithm.startsWith("l2")
						? -squaredDistance(q, histogram(candidate))
						: algorithm === "rgb512"
							? dot(rgbq, rgbHistogram(pixels(candidate)))
							: paletteCoverage(
									palette(pixels(candidate)),
									[{ color, amount: 1 }],
									0.1,
								),
				}))
				.sort((a, b) => b.score - a.score);
			return { color, best: ranked[0].color, ranked };
		}),
	]),
);
for (const [algorithm, checks] of Object.entries(alternatives)) {
	const passed = checks.filter((row) => row.color === row.best).length;
	console.log(
		`${algorithm}: ${passed}/${checks.length} solid-color self matches`,
	);
	if (algorithm === "palette32") assert.equal(passed, checks.length);
}
const areas = [0, 0.05, 0.25, 0.5, 0.75, 1].map((area) => {
	const rgba = new Uint8Array(100 * 4);
	for (let i = 0; i < 100; i++)
		rgba.set(pixels(i < area * 100 ? "#FF0000" : "#000000"), i * 4);
	return {
		area,
		score: paletteCoverage(
			palette(rgba),
			[{ color: "#FF0000", amount: 1 }],
			0.1,
		),
	};
});
for (let i = 1; i < areas.length; i++)
	assert.ok(areas[i].score > areas[i - 1].score);
const centroidPixels = new Uint8Array(400);
for (let i = 0; i < 100; i++)
	centroidPixels.set(pixels(i === 99 ? "#0000FF" : "#FF0000"), i * 4);
const centroid = palette(centroidPixels, 1)[0];
const expectedCentroid = hexToOklab("#FF0000").map(
	(x, i) => 0.99 * x + 0.01 * hexToOklab("#0000FF")[i],
);
assert.ok(
	squaredDistance(centroid.lab, expectedCentroid) < 1e-20,
	"Palette must fit the unchanged input distribution",
);
await writeFile(
	new URL("./output/diagnostics.json", import.meta.url),
	JSON.stringify({ production: rows, alternatives, areas }, null, 2),
);
await writeFile(
	new URL("./diagnostics.json", import.meta.url),
	JSON.stringify({ production: rows, alternatives, areas }, null, 2),
);
// Set REQUIRE_SELF_MATCH=1 to make the failure an executable red signal.
if (process.env.REQUIRE_SELF_MATCH === "1") {
	for (const row of rows)
		assert.equal(
			row.ranked[0].color,
			row.color,
			`Selecting ${row.color} should prefer a wallpaper filled entirely with ${row.color}`,
		);
}
