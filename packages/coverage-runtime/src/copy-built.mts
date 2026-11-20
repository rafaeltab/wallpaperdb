import assert from "node:assert/strict";
import { cp, glob, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// External build maps are relative to the producing directory, not the mirror.
export async function copyBuiltArtifacts(source: string, destination: string) {
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, { recursive: true });
	for await (const name of glob("**/*.map", { cwd: destination })) {
		const map: unknown = JSON.parse(
			await readFile(resolve(destination, name), "utf8"),
		);
		assert(
			map &&
				typeof map === "object" &&
				"sources" in map &&
				Array.isArray(map.sources),
		);
		const sourceRoot = "sourceRoot" in map ? map.sourceRoot : "";
		assert(typeof sourceRoot === "string");
		const sources = map.sources.map((entry: unknown) => {
			assert(typeof entry === "string");
			return /^[a-z]+:/i.test(entry)
				? entry
				: resolve(dirname(resolve(source, name)), sourceRoot, entry);
		});
		await writeFile(
			resolve(destination, name),
			JSON.stringify({ ...map, sources, sourceRoot: "" }),
		);
	}
}
