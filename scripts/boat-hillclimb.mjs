import fs from "node:fs";
import { execute547Asset } from "./lib/boat-hillclimb.mjs";

try {
	const file = process.env.BOAT_HILLCLIMB_CONFIG;
	if (!file)
		throw new Error(
			"Set BOAT_HILLCLIMB_CONFIG to the #547 JSON configuration path",
		);
	const result = await execute547Asset(
		JSON.parse(fs.readFileSync(file, "utf8")),
	);
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
