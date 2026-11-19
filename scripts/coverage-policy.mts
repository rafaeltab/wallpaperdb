import type { AuditPolicy } from "@wallpaperdb/coverage-runtime";
export const estimates: AuditPolicy = {
	"apps/factory/src/adapters/github/joins.ts:1134:4": {
		sourceSHA256:
			"0d0418671200a0e521c15bee06e48323e3e13c6cc4cf7cd655edb149dcd1759f",
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
