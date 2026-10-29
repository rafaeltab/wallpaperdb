import fs from "node:fs";
export function worktreeProcesses(root) {
	const samples = [];
	for (const name of fs.readdirSync("/proc")) {
		if (!/^\d+$/.test(name)) continue;
		try {
			if (fs.readlinkSync(`/proc/${name}/cwd`) !== root) continue;
			const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			const status = fs.readFileSync(`/proc/${name}/status`, "utf8");
			samples.push({
				pid: Number(name),
				parentPid: Number(fields[1]),
				name: fs.readFileSync(`/proc/${name}/comm`, "utf8").trim(),
				cpuTicks: Number(fields[11]) + Number(fields[12]),
				rssKB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
				startTicks: fields[19],
			});
		} catch (error) {
			if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
		}
	}
	return samples;
}
export const validation = [
	"run",
	"docker-run",
	"build",
	"check",
	"check-types",
	"lint",
	"lint-fix",
	"test",
	"test-focused",
	"test-unit",
	"test-integration",
	"test-e2e",
	"test-mutation",
	"ci",
	"crap",
	"check-crap",
];
export const development = [
	"dev",
	"stop",
	"infra-start",
	"infra-start-admin",
	"infra-stop",
	"infra-reset",
	"infra-logs",
	"apps-start",
	"apps-stop",
	"apps-build",
	"apps-logs",
	"migrate",
	"psql",
	"redis-cli",
	"redis-flush",
	"redis-info",
	"nats-setup-streams",
	"nats-stream-list",
	"nats-stream-info",
];
export function route(config, target, override, script = "") {
	if (!config || override === "local" || override === "worker") return false;
	if (override === "remote") return true;
	if (
		target === "run" &&
		(/^(format|dev:configure$|boat:cache-login$|check:pr-history$)/.test(
			script,
		) ||
			(config.mode === "validation" &&
				/^(dev|start|stop|db:migrate)/.test(script)))
	)
		return false;
	return (
		validation.includes(target) ||
		(config.mode === "development" && development.includes(target))
	);
}
export function delta(before, after) {
	return {
		changed: Object.keys(after).filter((p) => after[p] !== before[p]),
		deleted: Object.keys(before).filter((p) => !(p in after)),
	};
}
export function quote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}
export function estimate(size, milliseconds) {
	const rate = { small: 0.018, default: 0.036, large: 0.072, xlarge: 0.2 }[
		size
	];
	if (!rate) throw new Error("Unknown worker size");
	return (rate * milliseconds) / 3600000;
}

export function parseBoatJson(output) {
	try {
		return JSON.parse(output);
	} catch {
		const events = output
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const failure = events.findLast((event) => event.event === "error");
		if (failure)
			throw new Error(
				`Boat: ${failure.code ?? failure.error ?? "provider error"}`,
			);
		return (
			events.findLast((event) => event.sandbox?.id || event.id) ?? events.at(-1)
		);
	}
}
export function workerState(info) {
	return (
		info.sandbox?.state ?? info.sandbox?.status ?? info.state ?? info.status
	);
}
export function meaningfulPreviewRequest(url, headers) {
	if (/\/(health|ready)([/?]|$)/.test(url)) return false;
	return (
		headers["sec-fetch-mode"] === "navigate" ||
		(url === "/__boat557/activity" && headers["x-boat-activity"] === "1")
	);
}
