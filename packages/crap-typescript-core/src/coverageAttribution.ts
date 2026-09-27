// Modified by WallpaperDB: bound ownership to source bodies and reject synthetic coverage; see ../UPSTREAM.md.
import type { CoverageUnknownReason, MethodDescriptor, SourceSpan } from "./types.js";
import { computeMethodCoverage, unavailableMethodCoverage } from "./coverageNormalization.js";
import type { BranchCoverageUnit, FileCoverage, FunctionCoverageUnit } from "./coverageUnits.js";
import type { MethodCoverage } from "./coverageNormalization.js";

const MAX_COLUMN = Number.MAX_SAFE_INTEGER;

type MatchOutcome = FunctionCoverageUnit | null | undefined;

export function coverageForMethods(
  methods: MethodDescriptor[],
  fileCoverage: FileCoverage | undefined,
  fileUnknownReason: CoverageUnknownReason = "file_unmatched"
): MethodCoverage[] {
  if (!fileCoverage) {
    return methods.map((method) => unavailableMethodCoverage(method, fileUnknownReason));
  }

  const matches = matchFunctionEntries(methods, fileCoverage.functions);
  const attributed = methods.map(() => ({
    statements: [] as FileCoverage["statements"],
    branches: [] as FileCoverage["branches"]
  }));

  for (const statement of fileCoverage.statements) {
    const owner = findOwningMethodIndex(methods, statement.span);
    if (owner !== null) {
      attributed[owner]!.statements.push(statement);
    }
  }

  for (const branch of fileCoverage.branches) {
    if (isFunctionEntry(branch, methods, fileCoverage.functions)) {
      continue;
    }
    const owner = findOwningMethodIndex(methods, branch.span);
    if (owner !== null) {
      attributed[owner]!.branches.push(branch);
    }
  }

  return methods.map((method, index) => {
    const matched = matches[index];
    if (matched === null) {
      return unavailableMethodCoverage(method, "fnmap_conflict");
    }
    // Legacy reports omit anonymous fnMap entries and count closing wrapper lines.
    // Their line counters cannot prove execution of an unmatched callback body.
    if (fileCoverage.legacyV8 && matched === undefined) {
      return unavailableMethodCoverage(method, "statement_unattributed");
    }
    const { statements, branches } = attributed[index]!;
    return computeMethodCoverage(
      method,
      matched?.hits === 0 ? statements.map((statement) => ({ ...statement, hits: 0 })) : statements,
      matched?.hits === 0 ? branches.map((branch) => ({ ...branch, hits: branch.hits.map(() => 0) })) : branches
    );
  });
}

function matchFunctionEntries(methods: MethodDescriptor[], functions: FunctionCoverageUnit[]): MatchOutcome[] {
  const matches = methods.map((method) => matchFunctionCoverage(method, functions));
  const owners = new Map<FunctionCoverageUnit, number>();
  for (const match of matches) {
    if (match) {
      owners.set(match, (owners.get(match) ?? 0) + 1);
    }
  }
  // Without a declaration position, an outer body may equal an inner full span.
  // One fnMap entry cannot prove invocation of both functions.
  return matches.map((match) => (match && owners.get(match)! > 1 ? null : match));
}

function matchFunctionCoverage(method: MethodDescriptor, functions: FunctionCoverageUnit[]): MatchOutcome {
  // Resolve precise coordinates before considering declaration fallbacks. Function
  // spans help identify entries but never replace the source body's ownership span.
  const candidates = [method.bodySpan, method.functionSpan, normalizeMethodSpanForFnMap(method.bodySpan)];
  const eligible = functions.filter((entry) => declarationBelongsToMethod(entry, method));
  for (const span of candidates) {
    if (!span) {
      continue;
    }
    const match = uniqueMatchOutcome(eligible.filter((entry) => spansEqual(entry.span, span)));
    if (match !== undefined) {
      return match;
    }
  }
  return uniqueMatchOutcome(eligible.filter((entry) => matchesMethodDeclaration(entry, method)));
}

function matchesMethodDeclaration(entry: FunctionCoverageUnit, method: MethodDescriptor): boolean {
  const declaration = entry.declarationStart;
  return (
    declaration !== undefined && declaration.line === method.startLine &&
    (!entry.name || entry.name.startsWith("(") || entry.name === method.functionName) &&
    method.functionSpan !== undefined
  );
}

function declarationBelongsToMethod(entry: FunctionCoverageUnit, method: MethodDescriptor): boolean {
  const declaration = entry.declarationStart;
  const full = method.functionSpan;
  if (!declaration || !full) {
    return true;
  }
  return (
    comparePosition(full.startLine, full.startColumn, declaration.line, declaration.column) <= 0 &&
    comparePosition(declaration.line, declaration.column, method.bodySpan.startLine, method.bodySpan.startColumn) < 0
  );
}

function normalizeMethodSpanForFnMap(methodSpan: SourceSpan): SourceSpan {
  if (methodSpan.endLine <= methodSpan.startLine) {
    return methodSpan;
  }

  return {
    startLine: methodSpan.startLine,
    startColumn: methodSpan.startColumn,
    endLine: methodSpan.endLine - 1,
    endColumn: MAX_COLUMN
  };
}

function isFunctionEntry(
  branch: BranchCoverageUnit,
  methods: MethodDescriptor[],
  functions: FunctionCoverageUnit[]
): boolean {
  if (branch.type !== "branch") {
    return false;
  }
  if (functions.some((entry) => spansEqual(entry.span, branch.span))) {
    return true;
  }
  // Anonymous V8 entries may have no fnMap. Their first block starts in the
  // function declaration and extends through its body, unlike a source decision.
  return methods.some((method) => {
    const full = method.functionSpan;
    const body = method.bodySpan;
    return (
      full !== undefined && branch.span.startLine === full.startLine &&
      comparePosition(full.startLine, full.startColumn, branch.span.startLine, branch.span.startColumn) <= 0 &&
      comparePosition(branch.span.startLine, branch.span.startColumn, body.startLine, body.startColumn) <= 0 &&
      branch.span.endLine === body.endLine && branch.span.endColumn >= body.endColumn
    );
  });
}

function findOwningMethodIndex(methods: MethodDescriptor[], span: SourceSpan): number | null {
  let bestMatch: number | null = null;

  for (let index = 0; index < methods.length; index += 1) {
    const body = methods[index]!.bodySpan;
    if (!spanContains(body, span) && !spanContainsPosition(body, span.startLine, span.startColumn)) {
      continue;
    }
    if (bestMatch === null || spanContains(methods[bestMatch]!.bodySpan, body)) {
      bestMatch = index;
    }
  }

  return bestMatch;
}

function spanContains(container: SourceSpan, candidate: SourceSpan): boolean {
  return (
    comparePosition(container.startLine, container.startColumn, candidate.startLine, candidate.startColumn) <= 0 &&
    comparePosition(candidate.endLine, candidate.endColumn, container.endLine, container.endColumn) <= 0
  );
}

function spanContainsPosition(span: SourceSpan, line: number, column: number): boolean {
  return (
    comparePosition(span.startLine, span.startColumn, line, column) <= 0 &&
    comparePosition(line, column, span.endLine, span.endColumn) < 0
  );
}

function comparePosition(leftLine: number, leftColumn: number, rightLine: number, rightColumn: number): number {
  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }
  return leftColumn - rightColumn;
}

function spansEqual(left: SourceSpan, right: SourceSpan): boolean {
  return (
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

function uniqueMatchOutcome(matches: FunctionCoverageUnit[]): MatchOutcome {
  if (matches.length > 1) {
    return null;
  }
  return matches[0];
}
