import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
);
const sharp = require("sharp");
const repository = "dharmx/walls";
const commit = "6bf4d733ebf2b484a37c17d742eb47e5139e6a14";
const seed = "wallpaperdb-color-benchmark-2026-09-15";
const categories = [
	"abstract",
	"aerial",
	"architecture",
	"digital",
	"flowers",
	"minimal",
	"monochrome",
	"mountain",
	"nature",
	"painting",
];
const manifestPath = path.join(directory, "corpus-manifest.json");
const digest = (data) => createHash("sha256").update(data).digest("hex");
const encodedPath = (value) =>
	value.split("/").map(encodeURIComponent).join("/");
const colorBuckets = [
	"red",
	"orange",
	"yellow",
	"green",
	"cyan",
	"blue",
	"purple",
	"pink",
	"black",
	"white",
	"muted",
];

async function colorCoverage(bytes) {
	const { data, info } = await sharp(bytes)
		.rotate()
		.resize(96, 96, { fit: "inside" })
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const counts = Object.fromEntries(colorBuckets.map((bucket) => [bucket, 0]));
	for (let offset = 0; offset < data.length; offset += info.channels) {
		const [r, g, b] = [
			data[offset] / 255,
			data[offset + 1] / 255,
			data[offset + 2] / 255,
		];
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const delta = max - min;
		const saturation = max === 0 ? 0 : delta / max;
		let bucket;
		if (max < 0.15) bucket = "black";
		else if (saturation < 0.15 && max > 0.85) bucket = "white";
		else if (saturation < 0.35 || max < 0.2) bucket = "muted";
		else {
			let hue =
				max === r
					? ((g - b) / delta) % 6
					: max === g
						? (b - r) / delta + 2
						: (r - g) / delta + 4;
			hue = (hue * 60 + 360) % 360;
			bucket =
				hue < 20 || hue >= 340
					? "red"
					: hue < 45
						? "orange"
						: hue < 75
							? "yellow"
							: hue < 165
								? "green"
								: hue < 195
									? "cyan"
									: hue < 255
										? "blue"
										: hue < 290
											? "purple"
											: "pink";
		}
		counts[bucket]++;
	}
	return Object.fromEntries(
		Object.entries(counts).map(([bucket, count]) => [
			bucket,
			Number((count / (info.width * info.height)).toFixed(6)),
		]),
	);
}

async function download(url) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(90_000),
				headers: { "User-Agent": "WallpaperDB-color-search-benchmark" },
			});
			if (!response.ok) throw new Error(`${response.status} ${url}`);
			return Buffer.from(await response.arrayBuffer());
		} catch (error) {
			if (attempt === 3) throw error;
			await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
		}
	}
}

async function exists(filename) {
	try {
		await access(filename);
		return true;
	} catch {
		return false;
	}
}

async function thumbnail(entry) {
	await sharp(path.join(directory, entry.filename))
		.rotate()
		.resize({
			width: 384,
			height: 216,
			fit: "inside",
			withoutEnlargement: true,
		})
		.jpeg({ quality: 85 })
		.toFile(path.join(directory, entry.thumbnail));
}

async function verify(entry, bytes) {
	if (digest(bytes) !== entry.sha256)
		throw new Error(`SHA256 mismatch for ${entry.id}`);
	const metadata = await sharp(bytes).metadata();
	if (metadata.width !== entry.width || metadata.height !== entry.height)
		throw new Error(`Dimension mismatch for ${entry.id}`);
}

async function restore(manifest) {
	if (
		manifest.length !== 100 ||
		new Set(manifest.map((entry) => entry.sha256)).size !== 100
	)
		throw new Error("Expected exactly 100 distinct wallpaper SHA256 values");
	let next = 0;
	await Promise.all(
		Array.from({ length: 6 }, async () => {
			while (next < manifest.length) {
				const entry = manifest[next++];
				const destination = path.join(directory, entry.filename);
				const bytes = (await exists(destination))
					? await readFile(destination)
					: await download(entry.sourceUrl);
				await verify(entry, bytes);
				if (!(await exists(destination))) await writeFile(destination, bytes);
				if (!(await exists(path.join(directory, entry.thumbnail))))
					await thumbnail(entry);
				console.log(
					`Verified ${entry.id}: ${entry.category} ${entry.width}x${entry.height}`,
				);
			}
		}),
	);
	console.log(
		"Verified all 100 original images and generated missing thumbnails.",
	);
}

async function contactSheets(manifest) {
	const cellWidth = 208;
	const cellHeight = 142;
	for (let page = 0; page < 4; page++) {
		const composites = [];
		for (let index = 0; index < 25; index++) {
			const entry = manifest[page * 25 + index];
			const left = (index % 5) * cellWidth;
			const top = Math.floor(index / 5) * cellHeight;
			composites.push({
				input: await sharp(path.join(directory, entry.thumbnail))
					.resize(200, 112, { fit: "contain", background: "#202020" })
					.toBuffer(),
				left: left + 4,
				top: top + 4,
			});
			composites.push({
				input: Buffer.from(
					`<svg width="200" height="22"><text x="4" y="16" font-family="sans-serif" font-size="12" fill="white">${entry.id.slice(-3)} ${entry.category}</text></svg>`,
				),
				left: left + 4,
				top: top + 116,
			});
		}
		await sharp({
			create: {
				width: 5 * cellWidth,
				height: 5 * cellHeight,
				channels: 3,
				background: "#202020",
			},
		})
			.composite(composites)
			.jpeg({ quality: 88 })
			.toFile(path.join(directory, `corpus/contact-sheet-${page + 1}.jpg`));
	}
}

async function rebalance() {
	const previous = (await exists(manifestPath))
		? JSON.parse(await readFile(manifestPath, "utf8"))
		: [];
	const previousByPath = new Map(
		previous.map((entry) => [entry.sourcePath, entry]),
	);
	const cache = path.join(directory, "corpus/candidate-cache");
	await mkdir(cache, { recursive: true });
	const listing = JSON.parse(
		(
			await download(
				`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`,
			)
		).toString(),
	);
	if (listing.truncated)
		throw new Error("Source repository listing was truncated");
	const images = listing.tree.filter(
		(entry) =>
			entry.type === "blob" &&
			/\.(png|jpe?g|webp)$/i.test(entry.path) &&
			entry.size <= 25 * 1024 * 1024,
	);
	const candidates = [];
	const seen = new Set();
	for (const category of categories) {
		const ordered = images
			.filter((entry) => entry.path.split("/")[0] === category)
			.sort((a, b) =>
				digest(`${seed}:${a.path}`).localeCompare(digest(`${seed}:${b.path}`)),
			);
		const colorful = ordered
			.filter((entry) =>
				/\b(red|yellow|purple|pink|orange|green|colorful)\b/.test(
					entry.path.replaceAll("_", " "),
				),
			)
			.slice(0, 12);
		const pool = [
			...colorful,
			...ordered.filter((entry) => !colorful.includes(entry)),
		].slice(0, 32);
		for (const item of pool) {
			const sourcePath = encodedPath(item.path);
			const sourceUrl = `https://raw.githubusercontent.com/${repository}/${commit}/${sourcePath}`;
			const cached = path.join(cache, digest(item.path));
			const old = previousByPath.get(item.path);
			const bytes = (await exists(cached))
				? await readFile(cached)
				: old && (await exists(path.join(directory, old.filename)))
					? await readFile(path.join(directory, old.filename))
					: await download(sourceUrl);
			const sha256 = digest(bytes);
			const metadata = await sharp(bytes).metadata();
			if (
				seen.has(sha256) ||
				metadata.width < 1280 ||
				metadata.height < 720 ||
				(metadata.pages ?? 1) > 1
			)
				continue;
			await writeFile(cached, bytes);
			const entry = {
				sourceUrl,
				sourcePage: `https://github.com/${repository}/blob/${commit}/${sourcePath}`,
				sourceRepository: `https://github.com/${repository}`,
				sourceCommit: commit,
				sourcePath: item.path,
				category,
				title: path
					.basename(item.path, path.extname(item.path))
					.replaceAll("_", " "),
				sha256,
				width: metadata.width,
				height: metadata.height,
				bytes: bytes.length,
				format: metadata.format,
				license: "unknown",
				selectionCoverage: await colorCoverage(bytes),
			};
			seen.add(sha256);
			candidates.push(entry);
		}
		console.log(
			`Measured candidate pool: ${category}, ${candidates.length} cumulative images`,
		);
	}
	const qualifying = (entries) =>
		Object.fromEntries(
			colorBuckets.map((bucket) => [
				bucket,
				entries.filter((entry) => entry.selectionCoverage[bucket] >= 0.1)
					.length,
			]),
		);
	const available = qualifying(candidates);
	console.log("Candidate images with >=10% of each coarse color:", available);
	const selected = [];
	const used = new Set();
	const categoryCounts = Object.fromEntries(
		categories.map((category) => [category, 0]),
	);
	const selectedCounts = Object.fromEntries(
		colorBuckets.map((bucket) => [bucket, 0]),
	);
	const choose = (entry) => {
		selected.push(entry);
		used.add(entry.sha256);
		categoryCounts[entry.category]++;
		for (const bucket of colorBuckets)
			if (entry.selectionCoverage[bucket] >= 0.1) selectedCounts[bucket]++;
	};
	// First cover rare colors, without using any search algorithm under evaluation.
	for (;;) {
		let best;
		let bestGain = 0;
		for (const candidate of candidates) {
			if (
				used.has(candidate.sha256) ||
				categoryCounts[candidate.category] >= 10
			)
				continue;
			let gain = 0;
			for (const bucket of colorBuckets) {
				if (
					candidate.selectionCoverage[bucket] >= 0.1 &&
					selectedCounts[bucket] < 5
				) {
					gain +=
						((5 - selectedCounts[bucket]) *
							(1 + Math.min(candidate.selectionCoverage[bucket], 0.5))) /
						Math.max(available[bucket], 1);
				}
			}
			if (gain > bestGain) {
				bestGain = gain;
				best = candidate;
			}
		}
		if (!best) break;
		choose(best);
	}
	// Then spread coarse histograms while keeping ten images per subject category.
	for (const category of categories) {
		while (categoryCounts[category] < 10) {
			let best;
			let bestDistance = -1;
			for (const candidate of candidates) {
				if (candidate.category !== category || used.has(candidate.sha256))
					continue;
				const nearest = Math.min(
					...selected.map((other) =>
						colorBuckets.reduce(
							(sum, bucket) =>
								sum +
								(candidate.selectionCoverage[bucket] -
									other.selectionCoverage[bucket]) **
									2,
							0,
						),
					),
				);
				if (nearest > bestDistance) {
					bestDistance = nearest;
					best = candidate;
				}
			}
			if (!best)
				throw new Error(`Insufficient valid candidates for ${category}`);
			choose(best);
		}
	}
	selected.sort(
		(a, b) =>
			categories.indexOf(a.category) - categories.indexOf(b.category) ||
			a.sourcePath.localeCompare(b.sourcePath),
	);
	const final = selected.map((entry, index) => {
		const id = `wallpaper-${String(index + 1).padStart(3, "0")}`;
		return {
			id,
			filename: `corpus/${id}${path.extname(entry.sourcePath).toLowerCase()}`,
			thumbnail: `corpus/thumbnails/${id}.jpg`,
			...entry,
		};
	});
	// All source bytes are now cached, so old filenames can be safely replaced.
	for (const entry of previous)
		await rm(path.join(directory, entry.filename), { force: true });
	for (const entry of final) {
		await writeFile(
			path.join(directory, entry.filename),
			await readFile(path.join(cache, digest(entry.sourcePath))),
		);
		await thumbnail(entry);
	}
	await writeFile(manifestPath, `${JSON.stringify(final, null, 2)}\n`);
	await writeFile(
		path.join(directory, "corpus/selection-audit.json"),
		`${JSON.stringify({ seed, candidateCount: candidates.length, candidateCoverage: available, selectedCoverage: qualifying(final), categoryCounts, candidates }, null, 2)}\n`,
	);
	await rm(cache, { recursive: true });
	console.log(
		`Saved 100 color-diverse wallpapers from ${candidates.length} candidates. Final >=10% color counts:`,
		qualifying(final),
	);
}

await mkdir(path.join(directory, "corpus/thumbnails"), { recursive: true });
if (process.env.COLOR_CORPUS_REBALANCE === "1") {
	await rebalance();
} else if (process.argv.includes("--select")) {
	if (await exists(manifestPath))
		throw new Error(
			"Selection is frozen: move the manifest explicitly before selecting a different corpus",
		);
	await rebalance();
} else if (await exists(manifestPath)) {
	await restore(JSON.parse(await readFile(manifestPath, "utf8")));
} else {
	await rebalance();
}
await contactSheets(JSON.parse(await readFile(manifestPath, "utf8")));
