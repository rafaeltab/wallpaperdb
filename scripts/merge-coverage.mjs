import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const local = process.argv.includes("--local");
const reports = [];
for (const parent of ["apps", "packages"]) {
	if (!existsSync(parent)) continue;
	for (const entry of readdirSync(parent, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const workspace = join(parent, entry.name);
		const manifest = join(workspace, "package.json");
		if (!existsSync(manifest)) continue;
		const { scripts = {} } = JSON.parse(readFileSync(manifest, "utf8"));
		if (local && !scripts["test:unit"] && !scripts["test:integration"])
			continue;
		const coverage = join(workspace, "coverage");
		if (!existsSync(coverage)) continue;
		for (const report of readdirSync(coverage, { recursive: true })) {
			if (report === "lcov.info" || report.endsWith("/lcov.info")) {
				// Mixed-tier workspaces have separate unit/integration output directories.
				if (
					local &&
					scripts["test:e2e"] &&
					!/^(unit|integration)\//.test(report)
				)
					continue;
				reports.push(readFileSync(join(coverage, report), "utf8"));
			}
		}
	}
}
mkdirSync("coverage", { recursive: true });
writeFileSync("coverage/lcov.info", reports.join(""));
console.log(
	`Merged ${reports.length} ${local ? "non-E2E " : ""}coverage reports.`,
);
