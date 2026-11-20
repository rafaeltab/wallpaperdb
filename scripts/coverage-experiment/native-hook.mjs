import { createHash } from "node:crypto";
import "./native-sources.mjs";
import { registerHooks } from "node:module";
registerHooks({
	load(url, context, next) {
		const result = next(url, context);
		if (url.includes("/@vitest/mocker/dist/chunk-automock.js")) {
			const source = result.source.toString();
			if (
				createHash("sha256").update(source).digest("hex") !==
				"81130c8493aa965b79f558325b4c227bb2954e08cddfb282a684d55b3550b651"
			)
				throw new Error("Unqualified CJS export collector");
			// Re-export traversal calls the closure before the old lexical declaration.
			return {
				...result,
				source: source
					.replace(
						"module$1.findPackageJSON(url)",
						"module$1.findPackageJSON(pathToFileURL(url).href)",
					)
					.replace("\tlet __require;", "")
					.replace(
						"function collectModuleExports(filename, code, format, exports = []) {",
						"function collectModuleExports(filename, code, format, exports = []) {\n let __require;",
					),
			};
		}
		return result;
	},
	resolve(id, context, next) {
		if (id === "ast-v8-to-istanbul")
			return {
				url: new URL("./native-converter.mjs", import.meta.url).href,
				shortCircuit: true,
			};
		return next(id, context);
	},
});
