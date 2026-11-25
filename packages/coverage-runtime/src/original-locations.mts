import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import {
	encodedMap,
	TraceMap,
	type SourceMapSegment,
} from "@jridgewell/trace-mapping";
import type candidate from "ast-v8-to-istanbul";

type MapData = Awaited<ReturnType<typeof candidate>>;
const sources = new Map<string, Promise<MapData>>();

async function original(path: string, convert: typeof candidate) {
	let result = sources.get(path);
	if (!result) {
		result = (async () => {
			const code = stripTypeScriptTypes(await readFile(path, "utf8"));
			return convert({
				code,
				sourceMap: encodedMap(
					new TraceMap({
						version: 3,
						sources: [path],
						sourcesContent: [code],
						names: [],
						mappings: code
							.split("\n")
							.map((line, row) =>
								Array.from(
									{ length: line.length + 1 },
									(_, column): SourceMapSegment => [column, 0, row, column],
								),
							),
					}),
				),
				ast: parse(code, { ecmaVersion: "latest", sourceType: "module" }),
				coverage: { url: pathToFileURL(path).href, functions: [] },
			});
		})();
		sources.set(path, result);
	}
	return (await result)[path];
}

// Compiler maps can anchor a body to its erased return type and omit exclusive
// end columns. Resolve those ranges against the original syntax before Istanbul
// merges representations. Counts always remain the generated V8 measurements.
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
