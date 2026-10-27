// Native sibling names and Make-owned fixture entrypoints are explicit.
export const aliases = {
	"apps/user/src/adapters/pictures/picture-encoder.mjs":
		"apps/user/src/adapters/pictures/encoder.js",
	"apps/asset/src/adapters/sources/inspect-worker.mjs":
		"apps/asset/src/adapters/sources/inspect-worker.js",
	"apps/asset/src/adapters/assets/resize-worker.mjs":
		"apps/asset/src/adapters/assets/resize-worker.js",
};

export const fixtureScripts = {
	"apps/asset": {
		"test:attachment-fixture": "node test/fixtures/attachment-server.js",
	},
};

export const built = ["apps/user/dist/**/*.mjs"];
