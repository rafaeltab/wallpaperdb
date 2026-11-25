import type { AuditPolicy } from "@wallpaperdb/coverage-runtime";
export const estimates: AuditPolicy = {
	"apps/factory/src/adapters/github/joins.ts:1230:4": {
		sourceSHA256:
			"0a1dfc7f289b04e52f696dcb6e5f02f75ea6aa468777651b4f7dbd6fb06fcea2",
		branch: [1230, 4, 1230, 57],
		body: [1230, 18, 1230, 57],
		following: [1231, 18, 1231, 43],
	},
	"apps/factory/src/adapters/t3/planner.ts:272:4": {
		sourceSHA256:
			"28f6afb940177d640300c2f8e2e3d4a226b4008b84200a73efae73d93228aa20",
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

// Built Node artifacts exercised by executable and loader contracts.
export const builtArtifactWorkspaces = [
	"apps/gateway",
	"packages/coverage-runtime",
];
