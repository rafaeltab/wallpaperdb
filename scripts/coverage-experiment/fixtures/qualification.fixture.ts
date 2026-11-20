import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import {
	expect,
	it,
	vi,
} from "../../../apps/user/node_modules/vitest/dist/index.js";

it("collects a normally exiting compiled child, with an independent output control", async () => {
	const child = spawn(
		process.execPath,
		[new URL("./child.js", import.meta.url).pathname],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	let errors = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (errors += chunk));
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	expect({ code, output, errors }).toEqual({
		code: 0,
		output: "child-hit\n",
		errors: "",
	});
});
it("runs the same compiled child entry in a worker", async () => {
	const worker = new Worker(new URL("./child.js", import.meta.url), {
		stdout: true,
	});
	let output = "";
	worker.stdout.on("data", (chunk) => (output += chunk));
	const code = await new Promise((resolve, reject) => {
		worker.once("error", reject);
		worker.once("exit", resolve);
	});
	expect({ code, output }).toEqual({ code: 0, output: "child-hit\n" });
});
it("retains native module cache across resetModules", async () => {
	const before = await import("./cache.js");
	vi.resetModules();
	const after = await import("./cache.js");
	// Explicit qualification of native semantics. A failure signals a changed contract.
	expect(after.identity).toBe(before.identity);
});
it("runs callbacks, generators, and Effect bodies with independent zero controls", async () => {
	const c = await import("./method-controls.js");
	const { Effect } = await import(
		"../../../apps/user/node_modules/effect/dist/index.js"
	);
	expect(c.callbacks().result).toBe("invoked");
	const sequence = c.consumed();
	expect(sequence.next().value).toBe("yielded");
	expect(sequence.next().value).toBe("returned");
	c.unstarted();
	expect(await Effect.runPromise(c.effect)).toBe("effect-result");
});
