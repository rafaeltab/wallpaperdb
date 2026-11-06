// Hold only the controller's event loop at the reproduced exit/reap boundary.
// Native stat and kill results are never replaced with synthetic values.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.env.FAKE_SOURCE;
const control = process.env.FAKE_CONTROL;
const read = fs.readFileSync.bind(fs);
const write = fs.writeFileSync.bind(fs);
const rename = fs.renameSync.bind(fs);
const kill = process.kill.bind(process);
const snapshot = (pid) => {
	const text = read(`/proc/${pid}/stat`, "utf8");
	const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
	return {
		pid,
		state: fields[0],
		startTicks: fields[19],
		group: Number(fields[2]),
		session: Number(fields[3]),
	};
};

if (root && control && process.cwd() === root) {
	if (
		process.argv[1] === path.join(root, ".mise/boat/boat") &&
		process.argv.includes("forward")
	) {
		process.once("exit", () => {
			if (
				!fs.existsSync(path.join(control, "exit-forward")) &&
				!fs.existsSync(path.join(control, "reaping-controller-term"))
			)
				return;
			// A real member forks after the controller's last ancestry survey.
			// It inherits the forward's group, but production never captured it.
			if (fs.existsSync(path.join(control, "reaping-unknown-member"))) {
				const child = spawn(
					process.execPath,
					["-e", "setInterval(()=>{},1000)"],
					{ cwd: root, stdio: "ignore" },
				);
				write(
					path.join(control, "reaping-unknown-identity.json"),
					JSON.stringify(snapshot(child.pid)),
					{ mode: 0o600 },
				);
			}
			// Keep the exit callback pending until the controller's real kernel
			// observation starts. This barrier is only in the synthetic forward.
			const deadline = performance.now() + 1000;
			while (!fs.existsSync(path.join(control, "reaping-guard-ready"))) {
				if (performance.now() >= deadline)
					throw Error("Controller never entered the reaping fixture boundary");
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
			}
		});
	}
	if (
		process.argv[1] === path.join(root, "scripts/boat.mjs") &&
		process.argv[2] === "preview"
	) {
		let owner,
			held = false;
		const observation = { groupPresentWhileZombie: false };
		const report = () => {
			const file = path.join(control, "reaping-observation.json");
			write(`${file}.tmp`, JSON.stringify(observation), { mode: 0o600 });
			rename(`${file}.tmp`, file);
		};
		const hold = () => {
			if (held) return;
			held = true;
			const file = path.join(control, "reaping-wait.json");
			const result = spawnSync(
				"python",
				[
					path.join(import.meta.dirname, "preview-reaping-wait.py"),
					JSON.stringify(owner.forward),
					file,
				],
				{ cwd: root, timeout: 1000, stdio: "pipe" },
			);
			observation.wait = JSON.parse(read(file, "utf8"));
			observation.status = result.status;
			report();
			if (result.status !== 0 || !observation.wait.qualified)
				throw Error("Preview reaping fixture did not observe the owned zombie");
		};
		fs.writeFileSync = (name, bytes, ...args) => {
			if (
				typeof name === "string" &&
				path.dirname(name) === path.join(root, ".boat") &&
				/^preview-progress-[0-9a-f-]+\.json\.\d+$/.test(path.basename(name))
			) {
				const value = JSON.parse(bytes);
				if (value.pid === process.pid && value.forward) owner = value;
			}
			return write(name, bytes, ...args);
		};
		fs.readFileSync = (name, ...args) => {
			if (
				owner &&
				!held &&
				owner.ready &&
				name === `/proc/${owner.forward.pid}/stat` &&
				fs.existsSync(path.join(control, "exit-forward"))
			)
				hold();
			return read(name, ...args);
		};
		process.kill = (pid, signal) => {
			const ownedTerm =
				owner &&
				pid === owner.forward.pid &&
				signal === "SIGTERM" &&
				!owner.ready &&
				!held;
			if (ownedTerm)
				write(path.join(control, "reaping-controller-term"), "requested", {
					mode: 0o600,
				});
			const result = kill(pid, signal);
			if (owner && pid === -owner.forward.group && signal === 0 && held) {
				try {
					if (snapshot(owner.forward.pid).state === "Z") {
						observation.groupPresentWhileZombie = true;
						report();
					}
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
				}
			}
			if (ownedTerm) hold();
			return result;
		};
	}
}
