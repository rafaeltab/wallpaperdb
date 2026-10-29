import fs from "node:fs";
const [mode, file] = process.argv.slice(2);
if (mode === "exit") {
	console.log("Boat probe stdout");
	console.error("Boat probe stderr");
	process.exitCode = 17;
} else if (mode === "observe") {
	const start = Date.now();
	if (fs.readFileSync(file, "utf8").trim() !== "initial")
		throw new Error("Pre-command source flush failed");
	console.log("Initial source observed");
	let changed = false,
		deleted = false;
	while (Date.now() - start < 60000) {
		if (!fs.existsSync(file)) {
			deleted = changed;
			break;
		}
		if (fs.readFileSync(file, "utf8").trim() === "changed" && !changed) {
			changed = true;
			console.log("Live source edit observed");
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (!deleted)
		throw new Error("Live source edit/deletion not observed within deadline");
	console.log("Live source deletion observed");
} else throw new Error("Expected exit or observe mode");
