// Additional analysis of frozen rankings; never retunes on holdout queries.
import { readFile, writeFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const r = JSON.parse(await readFile(new URL("results.json", root), "utf8"));
const pick = (prefix) =>
	r.summaries
		.filter(
			(x) =>
				x.split === "development" &&
				x.metric === "lab30" &&
				x.algorithm.startsWith(prefix),
		)
		.sort((a, b) => b.ndcg10 - a.ndcg10)[0].algorithm;
const selected = { palette: pick("palette32"), retrieval: pick("rgb512") };
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const dcg = (ids, q) =>
	ids
		.slice(0, 10)
		.reduce((s, id, i) => s + r.relevance[q][id].lab30 / Math.log2(i + 2), 0);
const hybrids = [];
for (const retrieval of ["cosine-default", selected.retrieval])
	for (const count of [20, 50])
		for (const q of r.queries) {
			const candidateIds = new Set(
				r.rankings[q.id][retrieval].slice(0, count).map((h) => h.id),
			);
			const paletteTop = r.rankings[q.id][selected.palette].map((h) => h.id);
			const reranked = paletteTop.filter((id) => candidateIds.has(id));
			const ideal = r.corpus
				.map((d) => d.id)
				.sort(
					(a, b) => r.relevance[q.id][b].lab30 - r.relevance[q.id][a].lab30,
				);
			const idealDcg = dcg(ideal, q.id);
			hybrids.push({
				query: q.id,
				split: q.split,
				retrieval,
				count,
				paletteTop10Recall:
					paletteTop.slice(0, 10).filter((id) => candidateIds.has(id)).length /
					10,
				ndcg10: idealDcg ? dcg(reranked, q.id) / idealDcg : null,
				top10: reranked.slice(0, 10),
			});
		}
const hybridSummaries = [];
for (const split of ["all", "development", "holdout"])
	for (const retrieval of ["cosine-default", selected.retrieval])
		for (const count of [20, 50]) {
			const rows = hybrids.filter(
				(h) =>
					h.retrieval === retrieval &&
					h.count === count &&
					(split === "all" || h.split === split),
			);
			hybridSummaries.push({
				split,
				retrieval,
				count,
				meanPaletteTop10Recall: mean(rows.map((h) => h.paletteTop10Recall)),
				worstPaletteTop10Recall: Math.min(
					...rows.map((h) => h.paletteTop10Recall),
				),
				ndcg10: mean(
					rows.filter((h) => h.ndcg10 !== null).map((h) => h.ndcg10),
				),
			});
		}
let seed = 17432;
const random = () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 2 ** 32;
};
const paired = [];
for (const candidate of [
	"l2-raw",
	"l2-normalized",
	selected.retrieval,
	selected.palette,
]) {
	const rows = r.perQuery.filter(
		(x) =>
			x.split === "holdout" &&
			x.metric === "lab30" &&
			x.algorithm === candidate &&
			x.ndcg10 !== null,
	);
	const differences = rows.map(
		(row) =>
			row.ndcg10 -
			r.perQuery.find(
				(x) =>
					x.query === row.query &&
					x.metric === "lab30" &&
					x.algorithm === "cosine-default",
			).ndcg10,
	);
	const samples = Array.from({ length: 5000 }, () =>
		mean(
			Array.from(
				{ length: differences.length },
				() => differences[Math.floor(random() * differences.length)],
			),
		),
	).sort((a, b) => a - b);
	paired.push({
		candidate,
		queries: differences.length,
		meanDifference: mean(differences),
		queryBootstrap95: [samples[125], samples[4874]],
		wins: differences.filter((d) => d > 1e-9).length,
		losses: differences.filter((d) => d < -1e-9).length,
	});
}
const availability = r.perQuery
	.filter((x) => x.algorithm === "cosine-default" && x.metric === "lab30")
	.map((x) => ({
		query: x.query,
		substantialMatches: x.available,
		maxGradedCoverage: Math.max(
			...Object.values(r.relevance[x.query]).map((v) => v.lab30),
		),
	}));
const analysis = {
	selected,
	selectionRule:
		"Highest development-query CIELAB30 nDCG@10 within palette32 and rgb512 families; query holdout uses same images.",
	hybridSummaries,
	hybrids,
	paired,
	availability,
	limitations: [
		"Query bootstrap describes variation across these fixed queries, not independent unseen datasets.",
		"Hybrid shortlist experiments use recorded exact rankings of real native vectors; verify candidate recall at larger scale.",
		"No strict production threshold has been calibrated.",
	],
};
await writeFile(
	new URL("analysis.json", root),
	JSON.stringify(analysis, null, 2),
);
console.log("Selected on development queries:", selected);
console.table(hybridSummaries.filter((x) => x.split === "holdout"));
