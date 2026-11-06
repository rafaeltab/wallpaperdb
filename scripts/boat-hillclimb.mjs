import fs from "node:fs";
import { createInterface } from "node:readline";
import {
	execute547Asset,
	execute547Preparation,
} from "./lib/boat-hillclimb.mjs";

try {
	const file = process.env.BOAT_HILLCLIMB_CONFIG;
	if (!file)
		throw new Error(
			"Set BOAT_HILLCLIMB_CONFIG to the #547 JSON configuration path",
		);
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	// Keep the first published Asset-only interface while callers migrate.
	const execute =
		"coldDeadline" in config ? execute547Asset : execute547Preparation;
	const result = await execute(config);
	console.log(
		JSON.stringify({
			status: result.status,
			phase: result.phase,
			round: result.round,
			scope: result.scope,
			outcome: result.outcome,
			url: result.url,
			worker: result.owner?.worker,
			admission: result.owner?.admission,
			generation: result.preview?.generation,
		}),
	);
	if (result.serving) {
		const input = createInterface({
			input: process.stdin,
			terminal: false,
			crlfDelay: Infinity,
		});
		const requests = new Set();
		input.on("line", (line) => {
			const request = (async () => {
				try {
					const data = JSON.parse(line);
					const changed =
						data.action === "observe-source"
							? await result.serving.observeSource(data)
							: await result.serving.replacePreview(data);
					console.log(
						JSON.stringify({
							status: changed.status,
							phase: changed.phase,
							round: changed.round,
							url: changed.url,
							worker: changed.owner.worker,
							admission: changed.owner.admission,
							generation: changed.preview?.generation,
							next: changed.next,
						}),
					);
				} catch (error) {
					console.error(
						JSON.stringify({
							status: error.actionStarted ? "FAIL" : "REFUSED",
							error: error.message,
						}),
					);
				}
			})();
			requests.add(request);
			void request.finally(() => requests.delete(request));
		});
		const cleanup = await result.serving.done;
		input.close();
		await Promise.allSettled(requests);
		console.log(
			JSON.stringify({ status: "SERVING_ENDED", cleanup: cleanup.status }),
		);
		process.exitCode = 1;
	}
} catch (error) {
	console.error(JSON.stringify({ status: "FAIL", error: error.message }));
	process.exitCode = 1;
}
