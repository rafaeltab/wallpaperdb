import { registerHooks } from "node:module";
const candidate = new URL(
	"../../.coverage-experiment/converter.mjs",
	import.meta.url,
).href;
registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "ast-v8-to-istanbul")
			return { url: candidate, shortCircuit: true };
		return next(specifier, context);
	},
});
