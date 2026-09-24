// PROTOTYPE: create browser data from the same checksum-pinned 100 originals.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { palette } from "./models.js";
import { hexToLab, labToHex } from "./proportions.mjs";
const root = new URL("./", import.meta.url);
const sharp = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
)("sharp");
const manifest = JSON.parse(
	await readFile(new URL("corpus-manifest.json", root), "utf8"),
);
assert.equal(manifest.length, 100);
const wallpapers = [];
for (const [i, d] of manifest.entries()) {
	const bytes = await readFile(new URL(d.filename, root));
	assert.equal(createHash("sha256").update(bytes).digest("hex"), d.sha256);
	const h = Math.max(1, Math.round(Math.sqrt(10000 / (d.width / d.height)))),
		w = Math.round((h * d.width) / d.height);
	const pixels = await sharp(bytes)
		.ensureAlpha()
		.resize(w, h, { fit: "fill" })
		.raw()
		.toBuffer();
	const points = palette(pixels, 32).sort((a, b) => b.weight - a.weight);
	wallpapers.push({
		...d,
		palette: points,
		paletteHex: points.map((p) => ({
			color: labToHex(p.lab),
			weight: p.weight,
		})),
	});
	if ((i + 1) % 25 === 0)
		console.log(`Prepared proportion palettes: ${i + 1}/100`);
}
const presets = [
	{
		id: "green40",
		label: "40% green · 60% anything else",
		colors: [{ color: "#008040", amount: 0.4 }],
	},
	{
		id: "green-red",
		label: "50% green · 50% red",
		colors: [
			{ color: "#008040", amount: 0.5 },
			{ color: "#E03030", amount: 0.5 },
		],
	},
	{
		id: "red-black",
		label: "80% red · 20% black",
		colors: [
			{ color: "#E03030", amount: 0.8 },
			{ color: "#101010", amount: 0.2 },
		],
	},
	{
		id: "rainbow",
		label: "Five colors · 20% each",
		colors: [
			{ color: "#E03030", amount: 0.2 },
			{ color: "#F08020", amount: 0.2 },
			{ color: "#F0D030", amount: 0.2 },
			{ color: "#008040", amount: 0.2 },
			{ color: "#2060D0", amount: 0.2 },
		],
	},
	{
		id: "warm40",
		label: "20% red · 20% orange · 60% anything else",
		colors: [
			{ color: "#E03030", amount: 0.2 },
			{ color: "#F08020", amount: 0.2 },
		],
	},
	{
		id: "teal-cream",
		label: "40% teal · 30% cream · 30% anything else",
		colors: [
			{ color: "#008080", amount: 0.4 },
			{ color: "#FFF0C0", amount: 0.3 },
		],
	},
	{
		id: "navy70",
		label: "70% navy · 30% anything else",
		colors: [{ color: "#102040", amount: 0.7 }],
	},
	{
		id: "red100",
		label: "100% red",
		colors: [{ color: "#E03030", amount: 1 }],
	},
];
const fixtureSpecs: [string, string, [string, number][]][] = [
	[
		"green40-black60",
		"40% green · 60% black",
		[
			["#008040", 0.4],
			["#101010", 0.6],
		],
	],
	[
		"green40-red60",
		"40% green · 60% red",
		[
			["#008040", 0.4],
			["#E03030", 0.6],
		],
	],
	[
		"green20-black80",
		"20% green · 80% black",
		[
			["#008040", 0.2],
			["#101010", 0.8],
		],
	],
	[
		"green80-black20",
		"80% green · 20% black",
		[
			["#008040", 0.8],
			["#101010", 0.2],
		],
	],
	["green100", "100% green", [["#008040", 1]]],
	["black100", "100% black", [["#101010", 1]]],
	[
		"green50-red50",
		"50% green · 50% red",
		[
			["#008040", 0.5],
			["#E03030", 0.5],
		],
	],
	[
		"red80-black20",
		"80% red · 20% black",
		[
			["#E03030", 0.8],
			["#101010", 0.2],
		],
	],
	[
		"red20-black80",
		"20% red · 80% black",
		[
			["#E03030", 0.2],
			["#101010", 0.8],
		],
	],
	["red100", "100% red", [["#E03030", 1]]],
	[
		"rainbow20",
		"Five colors · exactly 20% each",
		[
			["#E03030", 0.2],
			["#F08020", 0.2],
			["#F0D030", 0.2],
			["#008040", 0.2],
			["#2060D0", 0.2],
		],
	],
	[
		"rainbow-red40",
		"40% red · four other colors at 15%",
		[
			["#E03030", 0.4],
			["#F08020", 0.15],
			["#F0D030", 0.15],
			["#008040", 0.15],
			["#2060D0", 0.15],
		],
	],
	[
		"rainbow-missing-blue",
		"Four colors · 25% each · no blue",
		[
			["#E03030", 0.25],
			["#F08020", 0.25],
			["#F0D030", 0.25],
			["#008040", 0.25],
		],
	],
	[
		"red-orange-blue",
		"20% red · 20% orange · 60% blue",
		[
			["#E03030", 0.2],
			["#F08020", 0.2],
			["#2060D0", 0.6],
		],
	],
	[
		"teal-cream-black",
		"40% teal · 30% cream · 30% black",
		[
			["#008080", 0.4],
			["#FFF0C0", 0.3],
			["#101010", 0.3],
		],
	],
	[
		"navy-cream",
		"70% navy · 30% cream",
		[
			["#102040", 0.7],
			["#FFF0C0", 0.3],
		],
	],
];
await mkdir(new URL("proportion-fixtures/", root), { recursive: true });
const fixtures = [];
for (const [id, title, pairs] of fixtureSpecs) {
	let left = 0;
	const rectangles = pairs
		.map(([color, weight]) => {
			const x = left;
			left += weight * 640;
			return `<rect x="${x}" y="0" width="${weight * 640}" height="360" fill="${color}"/>`;
		})
		.join("");
	const filename = `./proportion-fixtures/${id}.svg`;
	await writeFile(
		new URL(filename, root),
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360"><title>${title}</title>${rectangles}</svg>`,
	);
	fixtures.push({
		id,
		title,
		filename,
		thumbnail: filename,
		sourcePage: null,
		synthetic: true,
		palette: pairs.map(([color, weight]) => ({ lab: hexToLab(color), weight })),
		paletteHex: pairs.map(([color, weight]) => ({ color, weight })),
	});
}
const sources = ["models.ts", "proportions.mjs", "corpus-manifest.json"];
const sourceHashes = Object.fromEntries(
	await Promise.all(
		sources.map(async (path) => [
			path,
			createHash("sha256")
				.update(await readFile(new URL(path, root)))
				.digest("hex"),
		]),
	),
);
await writeFile(
	new URL("proportions-data.json", root),
	JSON.stringify({
		generatedAt: new Date().toISOString(),
		sourceHashes,
		wallpapers,
		presets,
		fixtures,
	}),
);
console.log(
	"Saved proportions-data.json: 100 wallpapers, 8 editable presets, 16 separate synthetic examples.",
);
