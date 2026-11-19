// Record generated mock source identity, never modify execution or counters.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
export const sourceKey = (url: string) =>
	createHash("sha256").update(url).digest("hex");
if (process.env.WALLPAPERDB_COVERAGE_NATIVE_SOURCES) {
	const directory = process.env.WALLPAPERDB_COVERAGE_NATIVE_SOURCES;
	mkdirSync(directory, { recursive: true });
	const session = new Session();
	session.connect();
	session.on("Debugger.scriptParsed", ({ params }) => {
		if (
			!params.url.startsWith("file:") ||
			!["manual", "automock", "autospy"].includes(
				new URL(params.url).searchParams.get("mock") || "",
			)
		)
			return;
		session.post(
			"Debugger.getScriptSource",
			{ scriptId: params.scriptId },
			(error, result) => {
				if (error) throw error;
				const path = `${directory}/${sourceKey(params.url)}.json`;
				const record = JSON.stringify({
					url: params.url,
					code: result.scriptSource,
				});
				if (existsSync(path) && readFileSync(path, "utf8") !== record)
					throw new Error(`Conflicting generated sources: ${params.url}`);
				writeFileSync(path, record);
				writeFileSync(
					`${directory}/${sourceKey(params.url)}.js`,
					result.scriptSource,
				);
			},
		);
	});
	session.post("Debugger.enable");
}
