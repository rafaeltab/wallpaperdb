// Docker's driven-adapter responses for the real Make/runtime-observation control.
const services = [
	"asset",
	"caddy",
	"color-extractor",
	"gateway",
	"ingestor",
	"tags",
	"user",
	"variant-generator",
	"wallpaper",
	"web",
];
const id = (n) => (n + 1).toString(16).padStart(64, "0");
const args = process.argv.slice(2);
if (args[0] === "compose") {
	if (args[1] !== "-p" || args[2] !== "wallpaperdb-control")
		throw new Error("Wrong project transport");
	for (const [i, Service] of [
		...services,
		"postgres",
		"minio",
		"nats",
		"redis",
		"opensearch",
		"lgtm",
		"migrations",
		"setup",
	].entries())
		console.log(
			JSON.stringify({
				ID: id(i),
				Service,
				Project: "wallpaperdb-control",
				State: "running",
			}),
		);
} else if (args[0] === "inspect") {
	if (
		JSON.stringify(args.slice(3)) !==
		JSON.stringify(services.map((_, i) => id(i)))
	)
		throw new Error("Wrong inspect identity transport");
	for (const [i, service] of services.entries())
		console.log(
			JSON.stringify({
				id: id(i),
				image: `sha256:${id(i + 10)}`,
				state: {
					Running: true,
					Status: "running",
					Pid: i + 100,
					StartedAt: "2026-11-03T00:00:00Z",
				},
				restartCount: 0,
				created: "2026-11-03T00:00:00Z",
				labels: {
					"com.docker.compose.service": service,
					"com.docker.compose.project": "wallpaperdb-control",
					"com.docker.compose.config-hash": id(i + 20),
				},
				ports: {},
			}),
		);
} else throw new Error("Unexpected Docker operation");
