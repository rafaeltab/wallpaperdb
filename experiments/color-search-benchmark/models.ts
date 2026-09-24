// PROTOTYPE: candidate descriptors and scores. Never imported by production.
import {
	ColorSortService,
	hexToOklab,
	linearRgbToOklab,
	srgbToLinear,
} from "../../apps/gateway/src/services/color-sort.service.js";

export type Color = { color: string; amount: number; spread?: number };
export type Query = {
	id: string;
	colors: Color[];
	split: "development" | "holdout";
};
// Frozen before evaluating results; odd/even named queries separate development and holdout.
const singles = [
	["red", "#FF0000"],
	["orange", "#FF8000"],
	["yellow", "#FFFF00"],
	["lime", "#80FF00"],
	["green", "#00B040"],
	["teal", "#008080"],
	["cyan", "#00FFFF"],
	["sky", "#60BFFF"],
	["blue", "#0040FF"],
	["navy", "#102040"],
	["purple", "#8020C0"],
	["magenta", "#FF00FF"],
	["pink", "#FF80B0"],
	["rose", "#C06070"],
	["brown", "#805030"],
	["tan", "#C0A070"],
	["olive", "#708030"],
	["forest", "#205030"],
	["black", "#101010"],
	["gray", "#808080"],
	["white", "#F0F0F0"],
	["cream", "#FFF0C0"],
	["lavender", "#C0A0E0"],
	["slate", "#607080"],
];
export const queries: Query[] = singles.map(([id, color], i) => ({
	id,
	colors: [{ color, amount: 1 }],
	split: i % 2 ? "holdout" : "development",
}));
queries.push(
	{
		id: "blue-orange",
		colors: [
			{ color: "#2080D0", amount: 1 },
			{ color: "#FF9020", amount: 1 },
		],
		split: "holdout",
	},
	{
		id: "pink-teal",
		colors: [
			{ color: "#FF80B0", amount: 1 },
			{ color: "#008080", amount: 1 },
		],
		split: "development",
	},
	{
		id: "black-red",
		colors: [
			{ color: "#101010", amount: 1 },
			{ color: "#FF3030", amount: 1 },
		],
		split: "holdout",
	},
	{
		id: "green-cream",
		colors: [
			{ color: "#408030", amount: 1 },
			{ color: "#FFF0C0", amount: 1 },
		],
		split: "development",
	},
);
export const dot = (a: number[], b: number[]) =>
	a.reduce((s, x, i) => s + x * b[i], 0);
export const l1 = (a: number[]) => {
	const sum = a.reduce((s, x) => s + x, 0);
	return a.map((x) => (sum ? x / sum : 0));
};
export const cosine = (a: number[], b: number[]) =>
	dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));
export const squaredDistance = (a: number[], b: number[]) =>
	a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
const lab = (r: number, g: number, b: number) =>
	linearRgbToOklab(
		srgbToLinear(r / 255),
		srgbToLinear(g / 255),
		srgbToLinear(b / 255),
	);
export const rgbCenters = Array.from({ length: 512 }, (_, i) =>
	lab((i >> 6) * 32 + 15.5, ((i >> 3) & 7) * 32 + 15.5, (i & 7) * 32 + 15.5),
);
export function rgbHistogram(pixels: Uint8Array): number[] {
	const bins = new Array(512).fill(0);
	for (let i = 0; i < pixels.length; i += 4)
		bins[
			((pixels[i] >> 5) << 6) |
				((pixels[i + 1] >> 5) << 3) |
				(pixels[i + 2] >> 5)
		] += pixels[i + 3] / 255;
	return l1(bins);
}
export function kernel(
	centers: number[][],
	color: string,
	sigma: number,
): number[] {
	const target = hexToOklab(color);
	return centers.map((c) =>
		Math.exp(-squaredDistance(c, target) / (2 * sigma * sigma)),
	);
}
export function mixtureKernel(
	centers: number[][],
	colors: Color[],
	sigma: number,
): number[] {
	const total = colors.reduce((s, c) => s + c.amount, 0);
	const out = centers.map(() => 0);
	for (const c of colors)
		kernel(centers, c.color, sigma).forEach(
			(x, i) => (out[i] += (x * c.amount) / total),
		);
	return out;
}
export type PalettePoint = { lab: number[]; weight: number };
// Weighted OKLab k-means on RGB cells. Fixed initialization and 16 iterations.
export function palette(pixels: Uint8Array, k = 32): PalettePoint[] {
	const cells = new Map<
		number,
		{ r: number; g: number; b: number; weight: number }
	>();
	let total = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const w = pixels[i + 3] / 255;
		if (!w) continue;
		total += w;
		const key =
			((pixels[i] >> 3) << 10) |
			((pixels[i + 1] >> 3) << 5) |
			(pixels[i + 2] >> 3);
		const c = cells.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
		c.r += pixels[i] * w;
		c.g += pixels[i + 1] * w;
		c.b += pixels[i + 2] * w;
		c.weight += w;
		cells.set(key, c);
	}
	const points = [...cells.values()].map((c) => ({
		lab: lab(c.r / c.weight, c.g / c.weight, c.b / c.weight),
		weight: c.weight / total,
	}));
	if (points.length <= k) return points;
	const centers = [
		[...points.reduce((a, b) => (a.weight > b.weight ? a : b)).lab],
	];
	const distances = points.map(() => Infinity);
	while (centers.length < k) {
		let best = -1,
			index = 0;
		points.forEach((p, i) => {
			distances[i] = Math.min(
				distances[i],
				squaredDistance(p.lab, centers[centers.length - 1]),
			);
			const score = distances[i] * p.weight;
			if (score > best) {
				best = score;
				index = i;
			}
		});
		centers.push([...points[index].lab]);
	}
	let weights = centers.map(() => 0);
	for (let iteration = 0; iteration < 16; iteration++) {
		const sums = centers.map(() => [0, 0, 0]);
		weights = centers.map(() => 0);
		for (const p of points) {
			let best = Infinity,
				index = 0;
			centers.forEach((c, i) => {
				const d = squaredDistance(c, p.lab);
				if (d < best) {
					best = d;
					index = i;
				}
			});
			weights[index] += p.weight;
			for (let j = 0; j < 3; j++) sums[index][j] += p.lab[j] * p.weight;
		}
		centers.forEach((c, i) => {
			if (weights[i])
				for (let j = 0; j < 3; j++) c[j] = sums[i][j] / weights[i];
		});
	}
	return centers
		.map((c, i) => ({ lab: c, weight: weights[i] }))
		.filter((p) => p.weight > 0);
}
export function paletteCoverage(
	palette: PalettePoint[],
	colors: Color[],
	sigma: number,
	combine: "mean" | "all" = "all",
): number {
	const total = colors.reduce((s, c) => s + c.amount, 0);
	const fractions = colors.map((c) => ({
		w: c.amount / total,
		coverage: palette.reduce(
			(s, p) =>
				s +
				p.weight *
					Math.exp(
						-squaredDistance(p.lab, hexToOklab(c.color)) / (2 * sigma * sigma),
					),
			0,
		),
	}));
	return combine === "mean"
		? fractions.reduce((s, f) => s + f.w * f.coverage, 0)
		: Math.exp(
				fractions.reduce(
					(s, f) => s + f.w * Math.log(Math.max(1e-20, f.coverage)),
					0,
				),
			);
}
export const productionQuery = (colors: Color[], sigma?: number) =>
	new ColorSortService({
		spreadStrategy: "linear",
		...(sigma === undefined ? {} : { minSigma: sigma, maxSigma: sigma }),
	}).buildQueryVector({ colors });
