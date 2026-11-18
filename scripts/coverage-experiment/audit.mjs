import { Session } from "node:inspector";
import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";
const session = new Session();
session.connect();
const hash = (s) => createHash("sha256").update(s).digest("hex");
session.on("Debugger.scriptParsed", ({ params }) => {
	if (
		!params.url.includes("/.coverage-experiment/build/") ||
		!params.url.split("?")[0].endsWith(".js")
	)
		return;
	session.post(
		"Debugger.getScriptSource",
		{ scriptId: params.scriptId },
		(error, result) => {
			if (error) throw error;
			const actual = hash(result.scriptSource),
				disk = hash(readFileSync(fileURLToPath(params.url)));
			appendFileSync(
				"/tmp/wallpaperdb-742/audit.jsonl",
				JSON.stringify({
					pid: process.pid,
					threadId,
					url: params.url,
					actual,
					disk,
					equal: actual === disk,
				}) + "\n",
			);
		},
	);
});
session.post("Debugger.enable");
