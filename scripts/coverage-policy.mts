import type { AuditPolicy } from "@wallpaperdb/coverage-runtime";
export const estimates: AuditPolicy = {
	"apps/factory/src/adapters/github/joins.ts:1189:4": {
		sourceSHA256:
			"7955eebfc09011f8caadfa8bcd51e40c2cfa4c921fec6e0d51ca64fbd119549f",
		branch: [1189, 4, 1189, 57],
		body: [1189, 18, 1189, 57],
		following: [1190, 18, 1190, 43],
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

// Deployed bundles exercised by clean-environment executable contracts.
export const builtArtifactWorkspaces = ["apps/gateway"];
