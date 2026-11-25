import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { parse } from "acorn";
import type candidate from "ast-v8-to-istanbul";
import { sourceMapSchema } from "./json.mjs";
import { repositoryRoot } from "./repository-root.mjs";

type MapData = Awaited<ReturnType<typeof candidate>>;
const sources = new Map<string, Promise<MapData>>();

async function original(path: string, convert: typeof candidate) {
	let result = sources.get(path);
	if (!result) {
		result = (async () => {
			const module = resolve(
				repositoryRoot(),
				".coverage-runtime/build",
				relative(repositoryRoot(), path),
			)
				.replace(/\.mts$/, ".mjs")
				.replace(/\.ts$/, ".js");
			let code: string;
			try {
				code = await readFile(module, "utf8");
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				)
					return {};
				throw error;
			}
			const sourceMap = sourceMapSchema.parse(
				JSON.parse(await readFile(`${module}.map`, "utf8")),
			);
			return convert({
				code,
				sourceMap,
				ast: parse(code, { ecmaVersion: "latest", sourceType: "module" }),
				coverage: { url: pathToFileURL(module).href, functions: [] },
			});
		})();
		sources.set(path, result);
	}
	return (await result)[path];
}

// Use the verified per-source compilation as the location vocabulary for every
// representation of that original module, including deployed bundles. Resolve
// syntax identities before Istanbul merges; retain all measured V8 counters.
export async function originalLocations(
	data: MapData,
	convert: typeof candidate,
): Promise<MapData> {
	for (const [path, file] of Object.entries(data)) {
		if (!/\.m?ts$/.test(path)) continue;
		const syntax = await original(path, convert);
		if (!syntax) continue;
		for (const [id, fn] of Object.entries(file.fnMap)) {
			const matches = Object.values(syntax.fnMap).filter(
				(node) =>
					node.decl.start.line === fn.decl.start.line &&
					node.decl.start.column === fn.decl.start.column &&
					fn.loc.start.line >= node.decl.start.line &&
					fn.loc.end.line <= node.loc.end.line,
			);
			if (matches.length === 1) file.fnMap[id] = structuredClone(matches[0]);
		}
		for (const [id, branch] of Object.entries(file.branchMap)) {
			const matches = Object.values(syntax.branchMap).filter(
				(node) =>
					node.type === branch.type &&
					node.loc.start.line === branch.loc.start.line &&
					node.loc.start.column === branch.loc.start.column &&
					node.locations.length === branch.locations.length &&
					branch.loc.end.line <= node.loc.end.line &&
					node.locations.every(
						(arm, index) =>
							arm.start.line === branch.locations[index].start.line &&
							arm.start.column === branch.locations[index].start.column,
					),
			);
			if (matches.length === 1)
				file.branchMap[id] = structuredClone(matches[0]);
		}
	}
	return data;
}
