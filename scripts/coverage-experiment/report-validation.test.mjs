import { parseCoverageReport } from "../../.coverage-experiment/build/packages/crap-typescript-core/src/index.js";
const reports = ["unit", "integration"].map((tier) => [
	`User ${tier}`,
	`.coverage-experiment/reports/native-${tier}/coverage-final.json`,
]);
if (process.env.EXPERIMENT_ALL_NODE_REPORTS === "1")
	for (const workspace of [
		"apps/asset",
		"apps/wallpaper",
		"packages/crap-typescript-core",
	])
		reports.push([
			workspace,
			`.coverage-experiment/reports/compat/${workspace}/coverage-final.json`,
		]);
for (const [tier, path] of reports) {
	const report = await parseCoverageReport(path, process.cwd());
	console.log(
		`Normal coverage parser accepts complete ${tier} report (${report.size} files)`,
	);
}
