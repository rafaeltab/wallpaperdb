// PROTOTYPE #416. Reporting is default. --strict fails only on error diagnostics.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./analyzer.mjs";
import { pilot } from "./pilot.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const start = performance.now();
const reports = pilot.map((selection) => ({
	...selection,
	...analyze({ root, ...selection }),
}));
if (process.argv.includes("--json")) {
	console.log(
		JSON.stringify(
			{
				reports,
				wallMs: performance.now() - start,
				peakRssMiB: process.resourceUsage().maxRSS / 1024,
			},
			null,
			2,
		),
	);
} else {
	for (const report of reports) {
		console.log(
			`${report.workspace}: ${report.tests.length} explicitly classified tests, ${report.filesParsed} reachable files, ${report.durationMs}ms`,
		);
		for (const d of report.diagnostics) {
			console.log(
				`${d.file}:${d.line}:${d.column}: ${d.severity} ${d.code}: ${d.message}\n  test: ${d.test}\n  via: ${d.trail.join(" -> ")}`,
			);
		}
	}
	console.log(
		`PROTOTYPE #416: ${reports.flatMap((r) => r.diagnostics).length} findings, ${Math.round(performance.now() - start)}ms, peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)}MiB`,
	);
	console.log(
		`Manifest: ${path.relative(root, fileURLToPath(new URL("./pilot.mjs", import.meta.url)))}. Unlisted tests are outside this experiment.`,
	);
}
if (
	process.argv.includes("--strict") &&
	reports.some((r) => r.diagnostics.some((d) => d.severity === "error"))
)
	process.exitCode = 1;
