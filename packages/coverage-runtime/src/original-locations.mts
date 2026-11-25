import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { parse } from "acorn";
import type { Range } from "istanbul-lib-coverage";
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

// Arm anchors may point at an object or its property, or at `else` rather
// than the nested `if`. Require overlap for every corresponding arm, in
// addition to the decision's type, range and arm count. Ambiguous matches stay unchanged.
function overlaps(left: Range, right: Range) {
	if (!left.start.line || !right.start.line)
		return left.start.line === right.start.line;
	const before = (start: Range["start"], end: Range["end"]) =>
		start.line < end.line ||
		(start.line === end.line && start.column < end.column);
	return before(left.start, right.end) && before(right.start, left.end);
}

function sameRange(left: Range, right: Range) {
	return (
		left.start.line === right.start.line &&
		left.start.column === right.start.column &&
		left.end.line === right.end.line &&
		left.end.column === right.end.column
	);
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
		const lines = (await readFile(path, "utf8")).split("\n");
		const offset = (position: Range["start"]) =>
			lines
				.slice(0, position.line - 1)
				.reduce((n, line) => n + line.length + 1, 0) + position.column;
		const ifStart = (node: Range, mapped: Range) => {
			const start = offset(mapped.start),
				end = offset(node.start);
			return (
				start === end ||
				(start < end &&
					/^[\s);}]*else\s*$/.test(lines.join("\n").slice(start, end)))
			);
		};
		const anchors: { mapped: Range; original: Range }[] = [];
		for (const [id, fn] of Object.entries(file.fnMap)) {
			const matches = Object.values(syntax.fnMap).filter(
				(node) =>
					node.decl.start.line === fn.decl.start.line &&
					node.decl.start.column === fn.decl.start.column &&
					fn.loc.start.line >= node.decl.start.line &&
					overlaps(node.loc, fn.loc) &&
					(fn.loc.end.line <= node.loc.end.line ||
						(!Number.isFinite(fn.loc.end.column) &&
							fn.loc.end.line === node.loc.end.line + 1)),
			);
			if (matches.length === 1) {
				anchors.push({ mapped: fn.loc, original: matches[0].loc });
				file.fnMap[id] = structuredClone(matches[0]);
			}
		}
		for (const [id, branch] of Object.entries(file.branchMap)) {
			const matches = Object.values(syntax.branchMap).filter(
				(node) =>
					node.type === branch.type &&
					(node.type !== "if" || ifStart(node.loc, branch.loc)) &&
					overlaps(node.loc, branch.loc) &&
					node.locations.length === branch.locations.length &&
					(branch.loc.end.line <= node.loc.end.line ||
						(!Number.isFinite(branch.loc.end.column) &&
							branch.loc.end.line === node.loc.end.line + 1)) &&
					node.locations.every((arm, index) =>
						overlaps(arm, branch.locations[index]),
					),
			);
			if (matches.length === 1) {
				anchors.push({ mapped: branch.loc, original: matches[0].loc });
				file.branchMap[id] = structuredClone(matches[0]);
			}
		}
		for (const [id, statement] of Object.entries(file.statementMap)) {
			const anchored = anchors.filter((anchor) =>
				sameRange(anchor.mapped, statement),
			);
			const matches = Object.values(syntax.statementMap).filter(
				(node) =>
					// An implicit arrow return or else-if can inherit the enclosing
					// function/decision anchor instead of its own source start.
					anchored.some((anchor) => sameRange(anchor.original, node)) ||
					(node.start.line === statement.start.line &&
						node.start.column === statement.start.column &&
						overlaps(node, statement) &&
						(statement.end.line <= node.end.line ||
							(!Number.isFinite(statement.end.column) &&
								statement.end.line === node.end.line + 1))),
			);
			if (matches.length === 1)
				file.statementMap[id] = structuredClone(matches[0]);
		}
	}
	return data;
}
