import { spawn } from "node:child_process";

// Keep the PGID reserved after command exit, until the parent kills this group.
let child;
let interrupted = false;
const send = (message) => {
	if (process.connected) process.send(message, () => undefined);
};
const interrupt = () => {
	interrupted = true;
	if (child && child.exitCode === null && child.signalCode === null) {
		try {
			child.kill("SIGINT");
			send({ type: "leader-interrupt" });
		} catch {
			send({ type: "failure" });
		}
	}
};
process.on("SIGINT", () => undefined);
process.on("SIGTERM", () => undefined);
process.on("disconnect", () => {
	interrupt();
	process.exitCode = 1;
});
process.on("message", (message) => {
	if (message?.type === "interrupt") interrupt();
	else if (message?.type === "start" && !child) {
		const [command, ...args] = process.argv.slice(2);
		child = spawn(command, args, {
			stdio: message.stdio,
			shell: message.shell,
			argv0: message.argv0,
			detached: false,
		});
		child.once("spawn", () => {
			send({ type: "leader-start", pid: child.pid });
			if (interrupted) interrupt();
		});
		child.once("error", () => send({ type: "failure" }));
		child.once("exit", (code, signal) =>
			send({ type: "leader-exit", code, signal }),
		);
	} else send({ type: "failure" });
});
