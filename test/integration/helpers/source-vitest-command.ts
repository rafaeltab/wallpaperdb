import { parseCLI } from "vitest/node";

/** Inspect the source configuration behind supported package frontends.
 * Emitted execution and attribution are checked by the prebuilt runner controls. */
export function parseSourceVitestCommand(
	script: string,
): ReturnType<typeof parseCLI> {
	return parseCLI(script.replace(/^wallpaperdb-test(?=\s|$)/, "vitest run"));
}
