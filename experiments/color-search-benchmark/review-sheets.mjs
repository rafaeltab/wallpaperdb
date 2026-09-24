// Reproducible blind contact sheets for a visual sanity check (not human labels).
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const sharp = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
)("sharp");
const root = new URL("./", import.meta.url);
const results = JSON.parse(
	await readFile(new URL("results.json", root), "utf8"),
);
const best = results.summaries
	.filter(
		(x) =>
			x.split === "development" &&
			x.metric === "lab30" &&
			x.algorithm.startsWith("palette32"),
	)
	.sort((a, b) => b.ndcg10 - a.ndcg10)[0].algorithm;
const names = [
	"orange",
	"teal",
	"sky",
	"navy",
	"magenta",
	"rose",
	"cream",
	"black-red",
];
const key = { selectedOnDevelopment: best, queries: {} };
const out = new URL("output/blind/", root);
await mkdir(out, { recursive: true });
for (const name of names) {
	const q = results.queries.find((x) => x.id === name);
	const orderKey = (a) =>
		createHash("sha256")
			.update("color-blind-17:" + name + a)
			.digest("hex");
	const algorithms = ["cosine-default", "l2-raw", best].sort((a, b) =>
		orderKey(a).localeCompare(orderKey(b)),
	);
	key.queries[name] = Object.fromEntries(
		algorithms.map((a, i) => [String.fromCharCode(65 + i), a]),
	);
	const width = 960,
		height = 1080,
		overlays = [];
	const title = `<svg width="${width}" height="150"><style>text{font-family:sans-serif;fill:#eee}</style><text x="20" y="32" font-size="23">Target: ${name} — substantial visible area</text>${q.colors.map((c, i) => `<rect x="${20 + i * 175}" y="49" width="50" height="38" fill="${c.color}"/><text x="${80 + i * 175}" y="74" font-size="18">${c.color}</text>`).join("")}<text x="20" y="112" font-size="14">Rank 1 → 5 top to bottom. Judge amount and color closeness; “none good” is valid.</text>${algorithms.map((_, i) => `<text x="${i * 320 + 140}" y="145" font-size="22">${String.fromCharCode(65 + i)}</text>`).join("")}</svg>`;
	overlays.push({ input: Buffer.from(title), left: 0, top: 0 });
	for (const [col, algorithm] of algorithms.entries())
		for (const [rank, hit] of results.rankings[name][algorithm]
			.slice(0, 5)
			.entries()) {
			const doc = results.corpus.find((x) => x.id === hit.id);
			overlays.push({
				input: await sharp(new URL(doc.thumbnail, root).pathname)
					.resize(308, 158, { fit: "contain", background: "#202124" })
					.toBuffer(),
				left: col * 320 + 6,
				top: 155 + rank * 183,
			});
			overlays.push({
				input: Buffer.from(
					`<svg width="308" height="24"><text x="4" y="17" font-size="13" fill="#bbb" font-family="sans-serif">${rank + 1}. ${doc.id}</text></svg>`,
				),
				left: col * 320 + 6,
				top: 313 + rank * 183,
			});
		}
	await sharp({ create: { width, height, channels: 3, background: "#141518" } })
		.composite(overlays)
		.png()
		.toFile(new URL(name + ".png", out).pathname);
}
await writeFile(
	new URL("output/blind-key.json", root),
	JSON.stringify(key, null, 2),
);
console.log(
	`Saved 8 blind sheets; selected palette candidate using development queries only.`,
);
