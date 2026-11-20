import type { AuditPolicy } from "@wallpaperdb/coverage-runtime";
export const estimates: AuditPolicy = {
	"apps/factory/src/adapters/github/joins.ts:1134:4": {
		sourceSHA256:
			"0ad0e1d8399e701fdf100fff1889bc98bc34008391c41e628923ca0ec2c6cfac",
		branch: [1134, 4, 1134, 57],
		body: [1134, 18, 1134, 57],
		following: [1135, 18, 1135, 43],
	},
	"apps/factory/src/adapters/t3/planner.ts:272:4": {
		sourceSHA256:
			"1ebb19481a4a668e301fee2a70d6dd8eb8c40a2b0d141897c3dfe4df00ff01fb",
		branch: [272, 4, 285, 5],
		body: [273, 6, 278, 8],
		following: [288, 20, 288, 98],
		finalReturn: [299, 4, 299, 18],
	},
};

export const sourceViteWorkspaces = [
	".",
	"scripts",
	"infra",
	"apps/web",
	"packages/react-muuri",
	"packages/crap-typescript-core",
	"packages/biome-test-rules",
];

// Deployed bundles exercised by clean-environment executable contracts.
export const builtArtifactWorkspaces = ["apps/gateway"];
