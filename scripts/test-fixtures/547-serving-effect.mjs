// Controlled external effects. The real preview controller owns both listeners
// and forward retirement; the runner and capture implementations are unchanged.
import fs from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPreview } from "../lib/boat-preview.mjs";

const root = process.cwd();
const file = fileURLToPath(import.meta.url);
function identity() {
	const text = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
	const f = text.slice(text.lastIndexOf(")") + 2).split(" ");
	return {
		pid: process.pid,
		startTicks: f[19],
		parentPid: Number(f[1]),
		group: Number(f[2]),
		session: Number(f[3]),
		cwd: root,
	};
}
const mode = process.argv[2];
if (["dev", "preview"].includes(mode))
	fs.appendFileSync("serving-commands.jsonl", `${JSON.stringify(mode)}\n`);
if (mode === "historical") console.log(JSON.stringify(identity()));
else if (mode === "dev") {
	if (
		process.env.CONTROL_REQUIRE_APP_IMAGES &&
		!fs.existsSync("application-images-prepared.json")
	)
		throw new Error("Application image build must finish before Watch");
	console.log("Watch enabled");
	if (!process.env.CONTROL_DEV_EXIT_BEFORE_READY) {
		const timer = setInterval(() => {
			if (
				process.env.CONTROL_DEV_EXIT_FILE &&
				fs.existsSync(process.env.CONTROL_DEV_EXIT_FILE)
			)
				clearInterval(timer);
		}, 1000);
		process.on("SIGTERM", () => clearInterval(timer));
	}
} else {
	const port = Number(
		fs.readFileSync(".worktree", "utf8").match(/^INGRESS_PORT=(\d+)/m)[1],
	);
	const server = http.createServer((req, res) => {
		fs.appendFileSync("routes-observed.jsonl", JSON.stringify(req.url) + "\n");
		res.writeHead(process.env.CONTROL_BAD_ROUTE === req.url ? 503 : 200);
		res.end(req.url);
	});
	if (mode === "forward") {
		server.listen(port + 20000, "127.0.0.1");
		process.on("SIGTERM", () => server.close());
	} else if (mode === "preview") {
		const historical = JSON.parse(
			spawnSync(process.execPath, [file, "historical"], {
				cwd: root,
				encoding: "utf8",
			}).stdout,
		);
		await runPreview({
			root,
			cli: process.execPath,
			argv: [file, "forward"],
			port,
			privatePort: port + 20000,
			server,
			record: (kind, value) =>
				fs.appendFileSync(
					".boat/events.jsonl",
					JSON.stringify({ kind, at: new Date().toISOString(), ...value }) +
						"\n",
				),
			ready: () => {
				const p = ".boat/preview-process.json";
				const state = JSON.parse(fs.readFileSync(p));
				state.captured.push(historical);
				fs.writeFileSync(p, JSON.stringify(state));
				console.log("Controlled preview ready");
			},
		});
	} else throw new Error("Unknown controlled serving mode");
}
