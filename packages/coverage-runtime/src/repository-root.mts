import { resolve } from "node:path";
export function repositoryRoot(): string {
	const root = process.env.WALLPAPERDB_COVERAGE_REPO_ROOT;
	if (!root) throw new Error("Explicit coverage repository root required");
	return resolve(root);
}

import { pathToFileURL } from "node:url";
import { z } from "zod";
const span = z.array(z.number());
const configurationSchema = z.object({
	estimates: z.record(
		z.object({
			sourceSHA256: z.string(),
			branch: span,
			body: span,
			following: span,
			finalReturn: span.optional(),
		}),
	),
	sourceViteWorkspaces: z.array(z.string()),
	builtArtifactWorkspaces: z.array(z.string()).default([]),
});
export async function repositoryConfiguration() {
	const path = process.env.WALLPAPERDB_COVERAGE_CONFIGURATION;
	if (!path)
		throw new Error("Explicit coverage repository configuration required");
	const loaded: unknown = await import(pathToFileURL(path).href);
	return configurationSchema.parse(loaded);
}
