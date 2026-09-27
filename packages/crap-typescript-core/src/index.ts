// WallpaperDB entry point for the vendored analyzer subset. See ../UPSTREAM.md.
export { calculateCrapScore } from "./crapScore.js";
export { expandExplicitPaths } from "./fileSelection.js";
export { coverageForMethods, parseCoverageReport } from "./istanbul.js";
export { ParseError, parseFileMethods } from "./parser.js";
export { filterSourceFiles } from "./sourceExclusions.js";
export type { AnalyzeProjectOptions, MethodDescriptor } from "./types.js";
