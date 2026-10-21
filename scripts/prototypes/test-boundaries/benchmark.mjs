// Five fresh processes include Node/TypeScript startup, not Make/pnpm startup.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runs = [];
for (let index = 0; index < 5; index++) {
	const start = performance.now();
	const child = spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			fileURLToPath(new URL("./run.mjs", import.meta.url)),
			"--json",
		],
		{ encoding: "utf8", timeout: 30_000 },
	);
	assert.equal(child.status, 0, child.stderr);
	const report = JSON.parse(child.stdout);
	runs.push({
		processMs: performance.now() - start,
		analysisMs: report.wallMs,
		peakRssMiB: report.peakRssMiB,
	});
}
const median = (key) => runs.map((run) => run[key]).sort((a, b) => a - b)[2];
console.log(
	JSON.stringify(
		{
			runs,
			medianProcessMs: median("processMs"),
			medianAnalysisMs: median("analysisMs"),
			medianPeakRssMiB: median("peakRssMiB"),
		},
		null,
		2,
	),
);
