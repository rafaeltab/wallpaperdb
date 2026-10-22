import { spawnSync } from "node:child_process";

const states = [
	"needs-triage",
	"needs-info",
	"ready-for-agent",
	"ready-for-human",
	"wontfix",
];
const agentStatuses = [
	"Planned",
	"In Progress",
	"In Review",
	"Done",
	"Canary",
	"Released",
];

try {
	const [issue, ...extra] = process.argv.slice(2);
	if (!issue || issue.startsWith("-") || extra.length)
		throw new Error("Usage: check-triage.mjs <issue-number-or-url>");
	const result = spawnSync(
		"gh",
		["issue", "view", issue, "--json", "labels,projectItems"],
		{ encoding: "utf8" },
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(result.stderr.trim() || "Cannot read issue triage state");
	const { labels, projectItems } = JSON.parse(result.stdout);
	const selected = labels.filter(({ name }) => states.includes(name));
	if (selected.length !== 1)
		throw new Error("Completed triage requires exactly one triage state label");
	const status = projectItems.find(({ title }) => title === "WallpaperDB")
		?.status?.name;
	if (selected[0].name === "ready-for-agent" && !agentStatuses.includes(status))
		throw new Error(
			`ready-for-agent requires Planned or a later WallpaperDB status; found ${status ?? "none"}`,
		);
	console.log("Triage label and project status are consistent.");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
