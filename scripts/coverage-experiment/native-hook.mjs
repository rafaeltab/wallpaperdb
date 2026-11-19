import { createHash } from "node:crypto";
import "./native-sources.mjs";
import { registerHooks } from "node:module";
import {existsSync} from 'node:fs';
const mirror = new URL('../../.coverage-experiment/build/',import.meta.url);
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
		// Resolve executable module requests only. Do not rewrite argv, file
		// contents, fs reads, or TS-as-data. No original-source fallback exists.
		const requested = new URL(id, context.parentURL || mirror);
		const fileRequest = id.startsWith('file:') || id.startsWith('/') || id.startsWith('./') || id.startsWith('../');
		if(fileRequest && requested.href.startsWith(mirror.href) && /\.tsx?$/.test(requested.pathname)) {
			const compiled = new URL(requested);
			compiled.pathname=compiled.pathname.replace(/\.tsx?$/,'.js');
			if(!existsSync(compiled))throw new Error('UNCOMPILED_MIRROR_MODULE: '+requested.href);
			return next(compiled.href,context);
		}
		if (id === "ast-v8-to-istanbul")
			return {
				url: new URL("./native-converter.mjs", import.meta.url).href,
				shortCircuit: true,
			};
		return next(id, context);
	},
});
