// Modified by WallpaperDB: retain coverage provenance and function hits; see ../UPSTREAM.md.
import type { SourceSpan } from "./types.js";

export interface StatementCoverageUnit {
  span: SourceSpan;
  hits: number;
}

export interface BranchCoverageUnit {
  span: SourceSpan;
  hits: number[];
  type?: string;
}

export interface CoveragePosition {
  line: number;
  column: number;
}

export type FunctionSpanSource = "loc" | "decl" | "line";

export interface FunctionCoverageUnit {
  span: SourceSpan;
  name?: string;
  declarationStart?: CoveragePosition;
  spanSource?: FunctionSpanSource;
  hits?: number;
}

export interface FileCoverage {
  statements: StatementCoverageUnit[];
  branches: BranchCoverageUnit[];
  functions: FunctionCoverageUnit[];
  /** Legacy v8-to-istanbul reports lines as statements and may omit anonymous functions. */
  legacyV8?: boolean;
}
