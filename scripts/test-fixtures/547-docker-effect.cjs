// Docker's driven-adapter responses for the real Make/runtime-observation control.
const fs = require("node:fs");
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
	if (process.env.CONTROL_NATIVE_STARTUP) {
		const assert = require("node:assert/strict");
		const path = require("node:path");
		if (args[4] === "infra/docker-compose.yml") {
			assert.deepEqual(args.slice(5), [
				"ps",
				"--status",
				"running",
				"--format",
				"{{.Service}}",
			]);
			console.log("postgres");
			process.exit(0);
		}
		if (args[5] === "up") {
			assert.deepEqual(args.slice(3), [
				"-f",
				"infra/docker-compose.apps.yml",
				"up",
				"-d",
				"--no-build",
			]);
			assert.ok(fs.existsSync("application-images-prepared.json"));
			fs.writeFileSync("native-start-entered.json", JSON.stringify(args));
			const gate = process.env.CONTROL_APP_START_GATE;
			const until = Date.now() + 10000;
			while (gate && !fs.existsSync(gate)) {
				assert.ok(Date.now() < until, "Controlled app start gate expired");
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
			}
			fs.writeFileSync("native-app-start.json", JSON.stringify(args));
			process.exit(0);
		}
		if (args[5] === "watch") {
			assert.deepEqual(args.slice(3), [
				"-f",
				"infra/docker-compose.apps.yml",
				"watch",
				"--no-up",
			]);
			assert.ok(fs.existsSync("native-app-start.json"));
			fs.writeFileSync("native-watch.json", JSON.stringify(args));
			const child = require("node:child_process").spawnSync(
				process.execPath,
				[
					path.join(
						process.env.CONTROL_REPOSITORY,
						"scripts/test-fixtures/547-serving-effect.mjs",
					),
					"dev",
				],
				{ stdio: "inherit" },
			);
			process.exit(child.status ?? 1);
		}
	}
	if (args[5] === "exec") {
		const assert = require("node:assert/strict");
		const path = require("node:path");
		assert.deepEqual(args.slice(3, 11), [
			"-f",
			"infra/docker-compose.apps.yml",
			"exec",
			"-T",
			"web",
			"node",
			"-e",
			args[10],
		]);
		assert.equal(args.length, 12);
		const root = process.cwd();
		fs.appendFileSync(
			"native-source-invocations.jsonl",
			JSON.stringify({
				project: args[2],
				source: args[11],
				program: args[10],
			}) + "\n",
		);
		const mapped = (p) =>
			typeof p === "string" && p.startsWith("/app/")
				? path.join(root, p.slice(5))
				: p;
		const opened = new Map();
		const controlledFs = new Proxy(fs, {
			get(target, name) {
				if (!["readFileSync", "lstatSync", "openSync"].includes(name))
					return target[name];
				return (file, ...rest) => {
					const bytes = target[name](mapped(file), ...rest);
					if (name === "openSync") opened.set(bytes, file);
					if (
						name === "readFileSync" &&
						process.env.CONTROL_SOURCE_HASH_DRIFT &&
						String(opened.get(file) ?? file).endsWith("boat-547-presence.txt")
					)
						return Buffer.from("BOAT-547-PRESENCX\n");
					return bytes;
				};
			},
		});
		require("node:vm").runInNewContext(args[10], {
			require: (name) =>
				name === "node:fs"
					? controlledFs
					: name === "node:os"
						? { hostname: () => id(9) }
						: require(name),
			process: {
				...process,
				argv: [process.execPath, args[11]],
				cwd: () => "/app/apps/web",
			},
			console,
			Buffer,
		});
		process.exit(0);
	}
	if (args.includes("build")) {
		if (
			JSON.stringify(args.slice(3)) !==
			JSON.stringify(["-f", "infra/docker-compose.apps.yml", "build"])
		)
			throw new Error("Wrong application image build transport");
		fs.writeFileSync(
			"native-app-build.json",
			JSON.stringify({ completed: true }),
		);
		console.log("Controlled native app image build completed");
		process.exit(0);
	}
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
