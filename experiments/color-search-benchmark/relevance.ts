/**
 * PROTOTYPE: independent pixel-level relevance proxies, not human ground truth.
 * Thresholds were specified before evaluating candidate rankings. No production
 * extraction, OKLab transform, histogram, or search implementation is imported.
 *
 * Lab uses the CIE 1931 2-degree D65 white point, not CSS Lab's D50 adaptation.
 * Multi-color aggregation measures presence of every requested color, not
 * agreement with the requested composition or exclusive pixel assignments.
 */

export interface RelevanceColor {
	color: string;
	amount: number;
}

export interface CoverageMetrics {
	lab20: number;
	lab30: number;
	lab40: number;
	hsv: number;
}

export interface RelevanceMetrics extends CoverageMetrics {
	perColor: Array<CoverageMetrics & RelevanceColor>;
}

export interface PreparedPixels {
	/** Interleaved [L*, a*, b*, hueDegrees, saturation, value, alphaWeight]. */
	values: Float64Array;
	/** Number of nontransparent samples. */
	count: number;
	/** Sum of alpha/255 for all samples; not a composited background. */
	totalWeight: number;
}

type Triple = [number, number, number];
const STRIDE = 7;
const LAB_METRICS = ["lab20", "lab30", "lab40", "hsv"] as const;
const LINEAR_CHANNEL = Float64Array.from({ length: 256 }, (_, byte) => {
	const value = byte / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

/** Unadapted sRGB bytes (0..255) -> CIELAB D65, L* on the 0..100 scale. */
export function rgb8ToLab(r: number, g: number, b: number): Triple {
	const lr = LINEAR_CHANNEL[r];
	const lg = LINEAR_CHANNEL[g];
	const lb = LINEAR_CHANNEL[b];
	const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
	const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
	const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
	const delta = 6 / 29;
	const f = (value: number) =>
		value > delta ** 3
			? Math.cbrt(value)
			: value / (3 * delta * delta) + 4 / 29;
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** sRGB bytes -> HSV with hue in degrees and saturation/value in [0,1]. */
export function rgb8ToHsv(r: number, g: number, b: number): Triple {
	const maximum = Math.max(r, g, b);
	const minimum = Math.min(r, g, b);
	const difference = maximum - minimum;
	if (difference === 0) return [0, 0, maximum / 255];
	let sector: number;
	if (maximum === r) sector = (g - b) / difference;
	else if (maximum === g) sector = (b - r) / difference + 2;
	else sector = (r - g) / difference + 4;
	return [(sector * 60 + 360) % 360, difference / maximum, maximum / 255];
}

export function hexToRgb8(hex: string): Triple {
	if (!/^#[0-9a-f]{6}$/i.test(hex))
		throw new Error(`Expected #RRGGBB, got ${hex}`);
	return [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
}

export function deltaE76(a: readonly number[], b: readonly number[]): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Convert each visible pixel once, then reuse this result across all queries. */
export function preparePixels(rgba: Uint8Array): PreparedPixels {
	if (rgba.length % 4 !== 0) throw new Error("Expected complete RGBA pixels");
	const values = new Float64Array((rgba.length / 4) * STRIDE);
	let count = 0;
	let totalWeight = 0;
	for (let offset = 0; offset < rgba.length; offset += 4) {
		const weight = rgba[offset + 3] / 255;
		if (weight === 0) continue;
		const r = rgba[offset];
		const g = rgba[offset + 1];
		const b = rgba[offset + 2];
		const lab = rgb8ToLab(r, g, b);
		const hsv = rgb8ToHsv(r, g, b);
		const target = count * STRIDE;
		values[target] = lab[0];
		values[target + 1] = lab[1];
		values[target + 2] = lab[2];
		values[target + 3] = hsv[0];
		values[target + 4] = hsv[1];
		values[target + 5] = hsv[2];
		values[target + 6] = weight;
		totalWeight += weight;
		count++;
	}
	return { values: values.subarray(0, count * STRIDE), count, totalWeight };
}

function colorCoverage(
	samples: PreparedPixels,
	color: string,
): CoverageMetrics {
	const rgb = hexToRgb8(color);
	const lab = rgb8ToLab(...rgb);
	const hsv = rgb8ToHsv(...rgb);
	const grayscale = hsv[1] < 0.1;
	const result: CoverageMetrics = { lab20: 0, lab30: 0, lab40: 0, hsv: 0 };
	if (samples.totalWeight === 0) return result;
	const values = samples.values;
	for (let offset = 0; offset < values.length; offset += STRIDE) {
		const dl = values[offset] - lab[0];
		const da = values[offset + 1] - lab[1];
		const db = values[offset + 2] - lab[2];
		const distanceSquared = dl * dl + da * da + db * db;
		const weight = values[offset + 6];
		if (distanceSquared <= 400) result.lab20 += weight;
		if (distanceSquared <= 900) result.lab30 += weight;
		if (distanceSquared <= 1600) result.lab40 += weight;
		const hueDifference = Math.abs(values[offset + 3] - hsv[0]);
		const matchesHsv = grayscale
			? values[offset + 4] < 0.15 &&
				Math.abs(values[offset + 5] - hsv[2]) <= 0.2
			: Math.min(hueDifference, 360 - hueDifference) <= 25 &&
				Math.abs(values[offset + 4] - hsv[1]) <= 0.3 &&
				Math.abs(values[offset + 5] - hsv[2]) <= 0.3;
		if (matchesHsv) result.hsv += weight;
	}
	for (const metric of LAB_METRICS) result[metric] /= samples.totalWeight;
	return result;
}

function aggregate(
	colors: readonly RelevanceColor[],
	coverage: (color: string) => CoverageMetrics,
): RelevanceMetrics {
	if (colors.length === 0)
		throw new Error("At least one requested color is required");
	let totalAmount = 0;
	const perColor = colors.map(({ color, amount }) => {
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error(`Color amount must be finite and positive: ${amount}`);
		}
		totalAmount += amount;
		return { color, amount, ...coverage(color) };
	});
	if (!Number.isFinite(totalAmount))
		throw new Error("Total color amount must be finite");
	const result: RelevanceMetrics = {
		lab20: 0,
		lab30: 0,
		lab40: 0,
		hsv: 0,
		perColor,
	};
	for (const metric of LAB_METRICS) {
		// A missing requested color must remain zero; adding epsilon would hide it.
		if (perColor.some((entry) => entry[metric] === 0)) continue;
		result[metric] = Math.exp(
			perColor.reduce(
				(sum, entry) =>
					sum + (entry.amount / totalAmount) * Math.log(entry[metric]),
				0,
			),
		);
	}
	return result;
}

/** Area coverage proxies. For repeated queries prefer preparePixels + measureMany. */
export function measureRelevance(
	input: PreparedPixels | Uint8Array,
	colors: readonly RelevanceColor[],
): RelevanceMetrics {
	const samples = input instanceof Uint8Array ? preparePixels(input) : input;
	return aggregate(colors, (color) => colorCoverage(samples, color));
}

/** Reuses pixel conversions and identical requested colors across queries. */
export function measureMany(
	samples: PreparedPixels,
	queries: readonly (readonly RelevanceColor[])[],
): RelevanceMetrics[] {
	const cache = new Map<string, CoverageMetrics>();
	const coverage = (color: string) => {
		const key = color.toLowerCase();
		let found = cache.get(key);
		if (!found) {
			found = colorCoverage(samples, color);
			cache.set(key, found);
		}
		return found;
	};
	return queries.map((colors) => aggregate(colors, coverage));
}
