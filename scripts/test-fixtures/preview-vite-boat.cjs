#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const argv = process.argv.slice(2),
	control = process.env.FAKE_CONTROL;
const log = (kind, value) =>
	fs.appendFileSync(
		path.join(control, "offline-transport.jsonl"),
		JSON.stringify({
			at: new Date().toISOString(),
			pid: process.pid,
			kind,
			...value,
		}) + "\n",
		{ mode: 0o600 },
	);
log("argv", { argv });
if (!argv.includes("fake-worker"))
	throw Error("Only synthetic fixture identity allowed");
if (argv.includes("info")) {
	const stopped = fs.existsSync(path.join(control, "offline-stopped.json"));
	console.log(
		JSON.stringify({
			id: "fake-worker",
			state: stopped ? "stopped" : "ready",
			...(stopped
				? JSON.parse(
						fs.readFileSync(path.join(control, "offline-stopped.json")),
					)
				: {}),
		}),
	);
} else if (argv.includes("stop")) {
	// This is the controlled external seam, never the real provider CLI. Its
	// observable request records whether any connection still owns live compute.
	const directory = path.join(process.cwd(), ".boat/preview-connections");
	const records = fs.existsSync(directory)
		? fs.readdirSync(directory).map((n) => {
				const child = path.join(directory, n, "connection.json");
				if (fs.existsSync(child)) return JSON.parse(fs.readFileSync(child));
				const launch = JSON.parse(
					fs.readFileSync(path.join(directory, n, "launch.json")),
				);
				return { ...launch, ...launch.child };
			})
		: [];
	const live = records.filter((r) => {
		try {
			const text = fs.readFileSync(`/proc/${r.pid}/stat`, "utf8");
			const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
			return fields[0] !== "Z" && fields[19] === r.startTicks;
		} catch (error) {
			if (error.code === "ENOENT" || error.code === "ESRCH") return false;
			throw error;
		}
	});
	log("controlled-stop", { live });
	if (live.length)
		throw Error("Stop request preceded development connection retirement");
	if (fs.existsSync(path.join(control, "offline-stopped.json")))
		throw Error("Second controlled stop refused");
	const stop = {
		id: "stop-controlled",
		status: "completed",
		forced: false,
		error: null,
		endedAt: new Date().toISOString(),
	};
	fs.writeFileSync(
		path.join(control, "offline-stopped.json"),
		JSON.stringify({ stop }),
		{ mode: 0o600 },
	);
	console.log(JSON.stringify({ stop }));
} else if (argv.includes("usage")) {
	console.log("{}");
} else if (argv.includes("--status")) {
	console.log(JSON.stringify({ running: true, stdout: "Watch enabled" }));
} else if (argv.includes("--detach")) {
	console.log(JSON.stringify({ processId: 557 }));
} else if (argv.includes("forward")) {
	if (argv.includes("--reverse"))
		throw Error("No real cache/reverse-forward effect allowed");
	const local = Number(argv[argv.indexOf("--local") + 1]),
		remote = Number(argv[argv.indexOf("--remote") + 1]);
	if (
		!Number.isSafeInteger(local) ||
		local <= 0 ||
		local > 65535 ||
		remote !== Number(process.env.CONTROL_PUBLIC_PORT)
	)
		throw Error("Unexpected controlled port");
	const peers = new Set();
	const server = net.createServer((socket) => {
		let header = Buffer.alloc(0);
		const observe = (bytes) => {
			header = Buffer.concat([header, bytes]);
			if (header.length > 16384) {
				socket.off("data", observe);
				return;
			}
			if (!header.includes("\r\n\r\n")) return;
			socket.off("data", observe);
			const protocol = header
				.toString("latin1")
				.match(/^sec-websocket-protocol:\s*([^\r\n]+)/im)?.[1];
			// Observe only these public protocol names, never auth headers/tokens.
			if (["vite-ping", "vite-hmr"].includes(protocol))
				log("upgrade-protocol", { protocol });
		};
		socket.on("data", observe);
		const upstream = net.connect(
			Number(process.env.CONTROL_VITE_PORT),
			"127.0.0.1",
		);
		peers.add(socket);
		peers.add(upstream);
		for (const [role, p] of [
			["downstream", socket],
			["upstream", upstream],
		]) {
			p.on("error", () => {});
			p.on("close", () => {
				log("socket-close", { role });
				peers.delete(p);
				socket.destroy();
				upstream.destroy();
			});
		}
		socket.pipe(upstream).pipe(socket);
	});
	server.listen(local, "127.0.0.1", () => log("listening", { local, remote }));
	process.on("SIGTERM", () => {
		log("term", { peers: peers.size });
		for (const p of peers) p.destroy();
		server.close(() => process.exit(0));
	});
} else if (argv.includes("ssh")) {
	const command = argv.at(-1);
	const allowed =
		command.startsWith("mkdir -p /home/user/wallpaperdb;") ||
		command.startsWith("cd /home/user/wallpaperdb && tar -xzf -") ||
		command.includes("mise trust && make install BOAT_EXEC=worker") ||
		command.includes("chmod a+rx infra/postgres/init") ||
		command.includes("SCRIPT=boat:ready") ||
		command.includes("--input-type=module -") ||
		command.includes("cat > /home/user/wallpaperdb/.boat/cache.json");
	if (!allowed) throw Error("Unexpected controlled SSH operation");
	process.stdin.resume(); // Consume only; never execute supplied shell text.
} else throw Error("No provider/lifecycle operation permitted in this control");
