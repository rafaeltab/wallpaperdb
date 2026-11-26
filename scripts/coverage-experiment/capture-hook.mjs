import { registerHooks } from "node:module";
registerHooks({
	resolve(id, context, next) {
		if (id === "ast-v8-to-istanbul")
			return {
				url: new URL("./capture-converter.mjs", import.meta.url).href,
				shortCircuit: true,
			};
		return next(id, context);
	},
});
