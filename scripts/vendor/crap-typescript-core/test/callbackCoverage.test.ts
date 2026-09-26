import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coverageForMethods, parseCoverageReport, parseFileMethods } from "../src/index";
import { createTempDir, disposeTempDir, writeProjectFiles } from "./testUtils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(disposeTempDir));
});

async function fixture(source: string, report: object) {
  const root = await createTempDir("crap-callback-coverage-");
  tempDirs.push(root);
  await writeProjectFiles(root, {
    "sample.ts": source,
    "coverage.json": JSON.stringify({ "sample.ts": { path: "sample.ts", ...report } })
  });
  const methods = await parseFileMethods(path.join(root, "sample.ts"));
  const coverage = await parseCoverageReport(path.join(root, "coverage.json"), root);
  return { methods, coverage: [...coverage.values()][0]! };
}

function location(startLine: number, startColumn: number, endLine: number, endColumn: number) {
  return { start: { line: startLine, column: startColumn }, end: { line: endLine, column: endColumn } };
}

describe("callback coverage ownership", () => {
  it("does not reuse an outer arrow's function map for the returned arrow", async () => {
    const { methods, coverage } = await fixture("const make = () => () => 42;\n", {
      all: false,
      statementMap: { 0: location(1, 19, 1, 27), 1: location(1, 25, 1, 27) },
      s: { 0: 1, 1: 1 },
      fnMap: { 0: { name: "(anonymous_0)", loc: location(1, 19, 1, 27), decl: location(1, 13, 1, 19) } },
      f: { 0: 1 }, branchMap: {}, b: {}
    });
    const [outer, inner] = coverageForMethods(methods, coverage);
    expect(outer!.statementCoverage.percent).toBe(100);
    expect(inner!.statementCoverage.status).toBe("unknown");
  });

  it("does not apply an inner arrow's zero invocation count to its executed creator", async () => {
    const { methods, coverage } = await fixture("const make = () => () => 42;\n", {
      statementMap: { 0: location(1, 19, 1, 27), 1: location(1, 25, 1, 27) },
      s: { 0: 1, 1: 0 },
      fnMap: { 0: { name: "(anonymous_1)", loc: location(1, 19, 1, 27), decl: location(1, 19, 1, 25) } },
      f: { 0: 0 }, branchMap: {}, b: {}
    });
    const [outer, inner] = coverageForMethods(methods, coverage);
    expect(outer!.statementCoverage.percent).toBe(100);
    expect(inner!.statementCoverage.percent).toBe(0);
  });

  it("does not borrow a parent's function map for an uncalled callback in a legacy line report", async () => {
    const { methods, coverage } = await fixture(`export function parent() {
  const callback = wrap(() => {
    return 42;
  });
  return callback;
}
`, {
      all: false,
      statementMap: {
        0: location(2, 0, 2, 30),
        1: location(3, 0, 3, 14),
        2: location(4, 0, 4, 5),
        3: location(5, 0, 5, 18)
      },
      s: { 0: 1, 1: 0, 2: 1, 3: 1 },
      fnMap: { 0: { name: "parent", decl: location(1, 7, 6, 1), loc: location(1, 7, 6, 1) } },
      f: { 0: 1 },
      branchMap: { 0: { type: "branch", loc: location(1, 7, 6, 1) } },
      b: { 0: [1] }
    });
    expect(methods).toHaveLength(2);
    const [parent, callback] = coverageForMethods(methods, coverage);
    expect(parent!.statementCoverage.percent).toBe(100);
    expect(callback!.statementCoverage.status).toBe("unknown");
    expect(callback!.branchCoverage.status).toBe("structural_na");
  });

  it("keeps real branches distinct from V8 function-entry counters with the same range", async () => {
    const body = location(1, 28, 4, 1);
    const { methods, coverage } = await fixture(`function decide(value: any) {
  if (value) return 1;
  return 0;
}
`, {
      statementMap: { 0: location(2, 2, 2, 22), 1: location(3, 2, 3, 11) },
      s: { 0: 1, 1: 0 },
      fnMap: { 0: { name: "decide", loc: body } },
      f: { 0: 1 },
      branchMap: { 0: { type: "branch", loc: body }, 1: { type: "if", loc: body } },
      b: { 0: [1], 1: [0, 1] }
    });
    const [result] = coverageForMethods(methods, coverage);
    expect(result!.branchCoverage.percent).toBe(50);
  });

  it("does not treat a V8 function-entry counter as coverage of a source condition", async () => {
    const body = location(1, 28, 4, 1);
    const { methods, coverage } = await fixture(`function decide(value: any) {
  if (value) return 1;
  return 0;
}
`, {
      statementMap: { 0: location(2, 2, 2, 22), 1: location(3, 2, 3, 11) },
      s: { 0: 1, 1: 1 },
      fnMap: { 0: { name: "decide", loc: body } },
      f: { 0: 1 },
      branchMap: { 0: { type: "branch", loc: body } },
      b: { 0: [1] }
    });
    const [result] = coverageForMethods(methods, coverage);
    expect(result!.statementCoverage.percent).toBe(100);
    expect(result!.branchCoverage.status).toBe("unknown");
  });

  it("uses uniquely matched zero function hits to reject misleading body statement hits", async () => {
    const body = location(1, 20, 3, 1);
    const { methods, coverage } = await fixture(`const never = () => {
  return 42;
};
`, {
      statementMap: { 0: location(2, 2, 2, 12), 1: location(3, 0, 3, 2) },
      s: { 0: 0, 1: 1 },
      fnMap: { 0: { name: "never", loc: body, decl: location(1, 14, 1, 20) } },
      f: { 0: 0 },
      branchMap: {}, b: {}
    });
    const [result] = coverageForMethods(methods, coverage);
    expect(result!.statementCoverage.percent).toBe(0);
  });

  it("preserves a positive invocation across duplicate function-map variants", async () => {
    const body = location(1, 20, 3, 1);
    const declaration = location(1, 14, 1, 20);
    const { methods, coverage } = await fixture(`const never = () => {
  return 42;
};
`, {
      statementMap: { 0: location(2, 2, 2, 12) }, s: { 0: 1 },
      fnMap: {
        0: { name: "never", loc: body, decl: declaration },
        1: { name: "never", loc: location(1, 14, 3, 2), decl: declaration }
      },
      f: { 0: 0, 1: 1 }, branchMap: {}, b: {}
    });
    const [result] = coverageForMethods(methods, coverage);
    expect(result!.statementCoverage.percent).toBe(100);
  });
});
