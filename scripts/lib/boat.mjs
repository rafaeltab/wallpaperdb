export const validation = [
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
export function route(config, target, override) {
	if (!config || override === "local" || override === "worker") return false;
	if (override === "remote") return true;
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
