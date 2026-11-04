import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const input = JSON.parse(
	gunzipSync(fs.readFileSync(new URL("./547-inputs.json.gz", import.meta.url))),
);
const live = JSON.parse(
	gunzipSync(
		fs.readFileSync(new URL("./547-live-inputs.json.gz", import.meta.url)),
	),
);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const recipePaths = [
	"asset",
	"color-extractor",
	"gateway",
	"ingestor",
	"tags",
	"user",
	"variant-generator",
	"wallpaper",
	"web",
].map((application) => `apps/${application}/Dockerfile.dev`);
const git = (...args) => execFileSync("git", args, { cwd: repository });
const recipes = (revision) =>
	git("ls-tree", "-r", revision, "--", ...recipePaths)
		.toString("utf8")
		.trim()
		.split("\n")
		.map((line) => {
			const [mode, , blob, path] = line.split(/\s+/);
			return { mode, blob, path };
		});
const revision = git("rev-parse", "HEAD").toString("utf8").trim();
const infrastructure = { revision, recipes: recipes(revision) };
const productRecipes = recipes(
	JSON.parse(
		fs.readFileSync(new URL("../boat-workloads/547.json", import.meta.url)),
	).productBase,
);
const recipeBlobs = new Set(
	[...productRecipes, ...infrastructure.recipes].map((item) => item.blob),
);
export const objects547 = {
	infrastructure: () => infrastructure,
	readLiveFile: (file) => Buffer.from(live[file], "base64"),
	baselineApps: () => [
		...new Map(
			[
				...Object.entries(input.baseline)
					.filter(([file, item]) => file.startsWith("apps/") && item)
					.map(([file, item]) => ({ path: file, ...item })),
				...productRecipes,
			].map((item) => [item.path, item]),
		).values(),
	],
	baselineBlob: (file) => input.baseline[file]?.blob ?? null,
	readBlob: (blob) => {
		if (recipeBlobs.has(blob)) return git("cat-file", "blob", blob);
		const bytes = Buffer.from(input.blobs[blob], "base64");
		if (
			createHash("sha1")
				.update(`blob ${bytes.length}\0`)
				.update(bytes)
				.digest("hex") !== blob
		)
			throw new Error("Controlled frozen blob changed");
		return bytes;
	},
};
