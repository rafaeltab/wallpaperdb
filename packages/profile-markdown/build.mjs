import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

// Compose watches this runtime output. Identical validation builds must leave
// it untouched; Turbo restoration is disabled for this cheap build for the same reason.

const result = await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "neutral",
	format: "esm",
	target: "es2022",
	outfile: "dist/index.js",
	write: false,
});

for (const output of result.outputFiles) {
	const bytes = Buffer.from(output.contents);
	try {
		if (fs.readFileSync(output.path).equals(bytes)) continue;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	fs.mkdirSync(path.dirname(output.path), { recursive: true });
	fs.writeFileSync(output.path, bytes);
}
