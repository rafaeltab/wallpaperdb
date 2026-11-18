// Local experiment only. Produces a private converter copy; never edits the pnpm store.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const require = createRequire(import.meta.url);
const provider = require.resolve("@vitest/coverage-v8");
const converter = createRequire(provider).resolve("ast-v8-to-istanbul");
const original = await readFile(converter, "utf8");
const version = JSON.parse(
	await readFile(resolve(dirname(converter), "../package.json"), "utf8"),
).version;
if (version !== "1.0.6") throw new Error(`Unqualified converter ${version}`);
if (
	createHash("sha256").update(original).digest("hex") !==
	"0ce3ec436049c66fff8757450230369156ee2126f52d06b41f99780e497d0a79"
)
	throw new Error("Unexpected converter contents");
// Rejected hypothesis, retained to reproduce the failed split-call control.
let patched = original.replace("ranges;\n", "ranges;\n\trawRanges;\n");
patched = patched.replace(
	"this.locator = e,",
	"this.rawRanges = [], this.locator = e,",
);
patched = patched.replace(
	"return new CoverageMapper(",
	"const mapper = new CoverageMapper(",
);
patched = patched.replace(
	"e.ignoreNode, e.ignoreSourceCode);",
	"e.ignoreNode, e.ignoreSourceCode);\n mapper.rawRanges = e.coverage.functions.flatMap(f => f.ranges);\n return mapper;",
);
// V8 operand ranges can begin before the operand, at the preceding if keyword.
// A whole-if execution count must enclose the whole node, not just its start.
patched = patched.replace(
	"onStatement(e, t) {",
	`ifCount(e) {
 if (!this.rawRanges.length) return 0;
 const start = e.start + this.wrapperLength, end = e.end + this.wrapperLength;
 const enclosing = this.rawRanges.filter(r => r.startOffset <= start && r.endOffset >= end)
   .sort((a,b) => (a.endOffset-a.startOffset)-(b.endOffset-b.startOffset));
 if (!enclosing.length) throw new Error('No enclosing V8 range for if');
 return enclosing[0].count;
 }
 onStatement(e, t) {`,
);
patched = patched.replace(
	"covered: r,\n\t\t\tfilename: this.#e(n)",
	'covered: e.type === "IfStatement" ? this.ifCount(e) : r,\n\t\t\tfilename: this.#e(n)',
);
patched = patched.replace(
	"a.push(e - n);",
	'a.push((t.type === "IfStatement" ? this.ifCount(t) : e) - n);',
);
await mkdir(".coverage-experiment", { recursive: true });
await import("node:fs/promises").then(async (fs) => {
	await fs
		.symlink(
			resolve(dirname(converter), "../.."),
			".coverage-experiment/node_modules",
		)
		.catch((e) => {
			if (e.code !== "EEXIST") throw e;
		});
});
await writeFile(".coverage-experiment/rejected-converter.mjs", patched);
// Apply the reviewable, pinned local patch to a private copy only.
await writeFile(".coverage-experiment/converter.mjs", original);
execFileSync("git", [
	"apply",
	"--directory=.coverage-experiment",
	fileURLToPath(new URL("./converter.patch", import.meta.url)),
]);
await writeFile(".coverage-experiment/original-converter.mjs", original);
console.log({
	version,
	converter,
	candidate: resolve(".coverage-experiment/converter.mjs"),
});
