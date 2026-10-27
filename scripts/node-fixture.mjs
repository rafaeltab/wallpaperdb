import { fileURLToPath } from "node:url";
import { emittedName } from "./lib/prebuilt-node.mjs";

/** Keep source and prebuilt fixture launches on the caller's execution format. */
export function nodeFixtureArguments(relativePath, callerUrl) {
	const fixture = new URL(relativePath, callerUrl);
	if (/\.(?:ts|tsx|mts|cts)$/.test(new URL(callerUrl).pathname)) {
		return ["--import", "tsx", fileURLToPath(fixture)];
	}
	fixture.pathname = emittedName(fixture.pathname);
	return [fileURLToPath(fixture)];
}
