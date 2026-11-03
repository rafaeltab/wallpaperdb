import fs from "node:fs";
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
		}),
	);
} catch (error) {
	console.error(JSON.stringify({ status: "FAIL", error: error.message }));
	process.exitCode = 1;
}
