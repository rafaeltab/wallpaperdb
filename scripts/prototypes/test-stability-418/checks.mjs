import { createRequire } from "node:module";
const require = createRequire(
	new URL("../../../package.json", import.meta.url),
);
const ts = require("typescript");

// PROTOTYPE #418. Candidates require review; this cannot infer a timer's purpose.
export function scanDelays(source) {
	const file = ts.createSourceFile(
		"sample.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const lines = source.split("\n");
	const findings = [];
	function visit(node) {
		if (ts.isCallExpression(node)) {
			const call = node.expression;
			const name = ts.isIdentifier(call)
				? call.text
				: ts.isPropertyAccessExpression(call)
					? call.name.text
					: "";
			if (["sleep", "setTimeout", "waitForTimeout"].includes(name)) {
				const { line } = file.getLineAndCharacterOfPosition(
					node.getStart(file),
				);
				const context = [lines[line - 1], lines[line]].join("\n");
				if (
					!/stability-allow: (timing-contract|deadline-guard|fake-response) \S+/.test(
						context,
					)
				) {
					findings.push({
						line: line + 1,
						call: name,
						source: lines[line].trim(),
					});
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return findings;
}

export function retryFailure(results) {
	results = results.filter((result) => result.result?.state !== "skipped");
	if (results.some((result) => !Number.isInteger(result.retryCount))) {
		throw new Error("Missing retry diagnostics");
	}
	return results.some((result) => result.retryCount > 0);
}
