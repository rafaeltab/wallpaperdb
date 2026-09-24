// THROWAWAY PROTOTYPE: original-pixel membership histograms, independent of palette centroids.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import { compileFamilies, pixelFamilyPreference } from "./global-pixels.mjs";
import { rgbToChannels, rgbToLab, labToRgb } from "./ranges.mjs";
import {
	describeAtoms,
	quantizeAtoms,
	MULTI_FAMILY_IDS,
} from "./global-multi.mjs";
import { sampleOriginalRgba, SAMPLER_VERSION } from "./global-sampling.ts";

const root = new URL("./", import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const requested = 65536;
const compiled = compileFamilies(NATIVE_FAMILIES);

function membershipMask(point) {
	let mask = 0;
	for (let i = 0; i < compiled.length; i++) {
		if (pixelFamilyPreference(point, compiled[i].target) > 0) mask |= 1 << i;
	}
	return mask;
}

/** Alpha bytes stay integer counts, so the complete histogram sums exactly. */
export function pixelAtoms(pixels) {
	assert.equal(pixels.length % 4, 0);
	const rgbCounts = new Map();
	let total = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const count = pixels[i + 3];
		if (!count) continue;
		const rgb = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
		rgbCounts.set(rgb, (rgbCounts.get(rgb) ?? 0) + count);
		total += count;
	}
	assert.ok(total > 0, "No visible source pixels.");
	const masks = new Map();
	for (const [packed, count] of rgbCounts) {
		const rgb = [
			(packed >> 16) / 255,
			((packed >> 8) & 255) / 255,
			(packed & 255) / 255,
		];
		const mask = membershipMask({ ...rgbToChannels(rgb), lab: rgbToLab(rgb) });
		masks.set(mask, (masks.get(mask) ?? 0) + count);
	}
	return {
		atoms: [...masks]
			.map(([mask, count]) => ({ mask, count }))
			.sort((a, b) => a.mask - b.mask),
		total,
	};
}

const summary = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		min: sorted[0],
		median: sorted[Math.floor(sorted.length / 2)],
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		max: sorted.at(-1),
	};
};

export async function main() {
	const sharp = createRequire(
		new URL("../../apps/color-extractor/package.json", import.meta.url),
	)("sharp");
	const data = JSON.parse(
		await readFile(new URL("proportions-data.json", root), "utf8"),
	);
	const rawFixtures = JSON.parse(
		await readFile(new URL("ranges-fixtures.json", root), "utf8"),
	).fixtures;
	assert.equal(data.wallpapers.length, 100);
	assert.equal(rawFixtures.length, 20);
	const sourceHashes = Object.fromEntries(
		await Promise.all(
			[
				"global-multi-prepare.mjs",
				"global-multi.mjs",
				"global-sampling.ts",
				"global-pixels.mjs",
				"global-native.mjs",
				"ranges.mjs",
				"corpus-manifest.json",
				"proportions-data.json",
				"ranges-fixtures.json",
			].map(async (file) => [file, sha(await readFile(new URL(file, root)))]),
		),
	);
	const sampling = {
		method: "original-pixel-jitter",
		target: requested,
		samplerVersion: SAMPLER_VERSION,
		alphaWeighting: "integer RGBA alpha bytes",
		sharp: sharp.versions.sharp,
		vips: sharp.versions.vips,
	};
	const cacheKey = sha(
		JSON.stringify({
			sourceHashes,
			families: NATIVE_FAMILIES,
			originals: data.wallpapers.map((doc) => doc.sha256),
			sampling,
		}),
	);
	let cached;
	try {
		cached = JSON.parse(
			await readFile(new URL("global-multi-data.json", root), "utf8"),
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (cached?.cacheKey === cacheKey) {
		console.log(
			"Original-pixel multi-family data are current: 100 wallpapers and 20 fixtures.",
		);
		return cached;
	}
	let samplingAudit;
	try {
		samplingAudit = JSON.parse(
			await readFile(new URL("global-sampling.json", root), "utf8"),
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const docs = [];
	const agreement = {
		images: 0,
		coverageValues: 0,
		unionValues: 0,
		maxCoverageDifference: 0,
		maxUnionDifference: 0,
	};
	for (const [i, doc] of data.wallpapers.entries()) {
		const bytes = await readFile(new URL(doc.filename, root));
		assert.equal(sha(bytes), doc.sha256, `${doc.id}: original checksum`);
		const decoded = await sharp(bytes)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		assert.equal(decoded.info.channels, 4);
		const seed = parseInt(
			sha(`${SAMPLER_VERSION}|${doc.sha256}|${requested}|0`).slice(0, 8),
			16,
		);
		const { pixels, ...sample } = sampleOriginalRgba(
			decoded.data,
			decoded.info.width,
			decoded.info.height,
			requested,
			seed,
		);
		const measured = describeAtoms({
			...doc,
			cohort: "real",
			partition: i % 10,
			sampling: { ...sampling, ...sample },
			...pixelAtoms(pixels),
		});
		docs.push(measured);
		if (samplingAudit?.cacheKey) {
			let audit;
			try {
				audit = JSON.parse(
					await readFile(
						new URL(
							`output/global-sampling-cache/${doc.id}-${samplingAudit.cacheKey.slice(0, 16)}.json`,
							root,
						),
						"utf8",
					),
				);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			const reference = audit?.samples?.[requested];
			if (
				audit?.originalSha256 === doc.sha256 &&
				reference?.seed === seed &&
				reference.samples === sample.samples
			) {
				agreement.images++;
				for (const id of MULTI_FAMILY_IDS) {
					agreement.maxCoverageDifference = Math.max(
						agreement.maxCoverageDifference,
						Math.abs(measured.features[id] - reference.features[id]),
					);
					agreement.coverageValues++;
				}
				for (const [key, value] of Object.entries(measured.unions)) {
					agreement.maxUnionDifference = Math.max(
						agreement.maxUnionDifference,
						Math.abs(value - reference.unions[key]),
					);
					agreement.unionValues++;
				}
			}
		}
		if ((i + 1) % 10 === 0)
			console.log(`Original-pixel membership atoms: ${i + 1}/100.`);
	}
	assert.ok(
		agreement.maxCoverageDifference < 1e-10,
		"Coverage must agree with identical original-pixel samples.",
	);
	assert.ok(
		agreement.maxUnionDifference < 1e-10,
		"Union area must agree with identical original-pixel samples.",
	);
	const fixtures = rawFixtures.map((doc, i) =>
		describeAtoms({
			...doc,
			cohort: "fixture",
			partition: i % 10,
			...quantizeAtoms(
				doc.palette.map((p) => ({
					mask: membershipMask({
						...rgbToChannels(labToRgb(p.lab)),
						lab: p.lab,
					}),
					weight: p.weight,
				})),
			),
			sampling: {
				method: "analytic fixture palette",
				quantizedTotal: 1_000_000_000,
			},
		}),
	);
	const output = {
		generatedAt: new Date().toISOString(),
		cacheKey,
		sourceHashes,
		families: NATIVE_FAMILIES,
		familyBitOrder: MULTI_FAMILY_IDS,
		sampling,
		wallpapers: docs,
		fixtures,
		stats: {
			realAtoms: summary(docs.map((doc) => doc.atoms.length)),
			fixtureAtoms: summary(fixtures.map((doc) => doc.atoms.length)),
			realSamples: summary(docs.map((doc) => doc.sampling.samples)),
			realAlphaCounts: summary(docs.map((doc) => doc.total)),
			agreementWithCachedOriginalSampler: agreement,
		},
	};
	await writeFile(
		new URL("global-multi-data.json", root),
		JSON.stringify(output),
	);
	console.log(
		JSON.stringify(
			{
				output: "global-multi-data.json",
				wallpapers: docs.length,
				fixtures: fixtures.length,
				sampling,
				stats: output.stats,
			},
			null,
			2,
		),
	);
	return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await main();
