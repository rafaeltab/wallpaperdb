import fs from "node:fs";
import { prepare547Source } from "./lib/boat-source-preparation.mjs";

try {
	const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
	if (Object.keys(config).sort().join() !== "authority,evidence")
		throw new Error("Expected only authority and evidence");
	console.log(JSON.stringify(await prepare547Source(config)));
} catch (error) {
	console.error(
		JSON.stringify({
			status: error.sourcePreparationStarted ? "FAIL" : "REFUSED",
			error: error.message,
		}),
	);
	process.exitCode = 1;
}
