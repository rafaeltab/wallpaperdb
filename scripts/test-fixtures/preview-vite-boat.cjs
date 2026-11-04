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
	console.log(JSON.stringify({ state: "ready" }));
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
