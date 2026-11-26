import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
	vitest = createRequire(require.resolve("vitest"));
const mapTools = createRequire(vitest.resolve("vite/package.json"));
const remapping = mapTools("@jridgewell/remapping");
const { TraceMap, decodedMappings } = createRequire(
	mapTools.resolve("@jridgewell/remapping"),
)("@jridgewell/trace-mapping");
export function mockSourceMap(outer, inner, original, generated, synthetic) {
	if (outer.sources.length !== 1)
		throw new Error(
			"NATIVE_MOCK_SOURCE_MISMATCH: unexpected generated source graph",
		);
	const lines = generated.split("\n"),
		before = original.split("\n");
	const mappings = decodedMappings(new TraceMap(outer)).map((row) =>
		row.map((segment) => [...segment]),
	);
	for (let line = 0; line < lines.length; line++) {
		mappings[line] ??= [];
		const row = mappings[line],
			last = row.at(-1);
		// MagicString omits exclusive line-end mappings. Extend only an exactly
		// equal, verified suffix; never infer across a changed or unmapped region.
		if (
			last?.length >= 4 &&
			last[1] === 0 &&
			lines[line].slice(last[0]) === before[last[2]]?.slice(last[3])
		)
			row.push([lines[line].length, 0, last[2], before[last[2]].length]);
		// Generated mock plumbing has its own source identity, not application hits.
		if (!row.length && lines[line].length)
			for (let column = 0; column <= lines[line].length; column++)
				row.push([column, 1, line, column]);
	}
	const source = outer.sources[0];
	return remapping(
		{
			...outer,
			mappings,
			sources: [source, synthetic],
			sourcesContent: [original, generated],
		},
		(id) => (id === source ? inner : null),
	);
}
