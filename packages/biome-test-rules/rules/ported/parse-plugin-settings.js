// Adapted from @vitest/eslint-plugin 1.6.27, commit aad57d121647efe764463c37414a8cd67ec9cf92.
// MIT; see ../../UPSTREAM-LICENSE.txt. Biome supplies syntax/scope and diagnostics.
const DEFAULTS = {
	typecheck: false,
};
export function parsePluginSettings(settings) {
	const pluginSettings =
		typeof settings.vitest !== "object" || settings.vitest === null
			? {}
			: settings.vitest;
	return {
		...DEFAULTS,
		...pluginSettings,
	};
}
