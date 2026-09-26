// Modified by WallpaperDB: callback discovery and source-range regressions; see ../UPSTREAM.md.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseFileMethods } from "../src/index";
import { createTempDir, disposeTempDir } from "./testUtils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(disposeTempDir));
});

async function parseSource(source: string) {
  const tempDir = await createTempDir("crap-callbacks-");
  tempDirs.push(tempDir);
  const filePath = path.join(tempDir, "sample.ts");
  await writeFile(filePath, source, "utf8");
  return parseFileMethods(filePath);
}

describe("callback discovery", () => {
  it("measures an ordinary callback with its own name and source ranges", async () => {
    const methods = await parseSource(`values.map((value: number) => value > 0 ? value * 2 : 0);`);

    expect(methods).toEqual([
      expect.objectContaining({
        functionName: "values.map argument 1@1:12",
        displayName: "values.map argument 1@1:12",
        complexity: 2,
        startLine: 1,
        endLine: 1,
        functionSpan: { startLine: 1, startColumn: 11, endLine: 1, endColumn: 55 },
        bodySpan: { startLine: 1, startColumn: 30, endLine: 1, endColumn: 55 },
        expectsStatementCoverage: true,
        expectsBranchCoverage: true
      })
    ]);
  });

  it("names ordinary, async, generator, generic and curried callbacks without depending on a framework", async () => {
    const methods = await parseSource(`run(function named(flag: boolean) { return flag ? 1 : 0; });
run(async (flag: boolean) => flag ? 1 : 0);
run(function* (flag: boolean) { if (flag) yield 1; });
Effect.fn("work")(function* (flag: boolean) { if (flag) yield 1; });
run(<T>(value: T) => value);`);

    expect(methods.map((method) => [method.functionName, method.complexity])).toEqual([
      ["named", 2],
      ["run argument 1@2:5", 2],
      ["run argument 1@3:5", 2],
      ["Effect.fn argument 1@4:19", 2],
      ["run argument 1@5:5", 1]
    ]);
    expect(methods[0]?.displayName).toBe("named@1:5");
  });

  it("assigns decisions in a returned arrow only to that arrow", async () => {
    const methods = await parseSource(`export const create = () => (flag: boolean) => flag ? 1 : 0;`);

    expect(methods).toMatchObject([
      { functionName: "create", complexity: 1, expectsBranchCoverage: false },
      { functionName: "<anonymous>@1:29", complexity: 2, expectsBranchCoverage: true }
    ]);
  });

  it("finds immediately invoked and type-wrapped expressions without inventing argument zero", async () => {
    const methods = await parseSource(`const direct = function () { return 1; }();
const grouped = (() => 2)();
run(((value: boolean) => value ? 1 : 0) as (value: boolean) => number);
run((() => 3) satisfies () => number);`);

    expect(methods.map((method) => method.complexity)).toEqual([1, 1, 2, 1]);
    expect(methods[0]?.displayName).toBe("<anonymous>@1:16");
    expect(methods.every((method) => method.displayName.includes("@"))).toBe(true);
    expect(methods.some((method) => method.displayName.includes("argument 0"))).toBe(false);
  });

  it("measures nested and same-line callbacks once with distinct stable locations", async () => {
    const source = `export function outer(flag: boolean) {
  run(() => flag ? 1 : 0, function* () {
    run(() => flag ? 2 : 3);
  });
}`;
    const methods = await parseSource(source);

    expect(methods.map((method) => [method.complexity, method.expectsBranchCoverage])).toEqual([
      [1, false],
      [2, true],
      [1, false],
      [2, true]
    ]);
    expect(methods[1]?.startLine).toBe(2);
    expect(methods[2]?.startLine).toBe(2);
    expect(new Set(methods.map((method) => method.displayName)).size).toBe(4);
    expect(new Set(methods.map((method) => JSON.stringify(method.functionSpan))).size).toBe(4);
    expect(await parseSource(source)).toEqual(methods);
  });

  it("preserves declaration and assignment names for generators", async () => {
    const methods = await parseSource(`function* declared() { yield 1; }
const assigned = function* internal() { yield 2; };
const holder = { inline: function* () { yield 3; }, *method() { yield 4; } };`);

    expect(methods.map((method) => [method.displayName, method.complexity])).toEqual([
      ["declared", 1],
      ["assigned", 1],
      ["holder.inline", 1],
      ["holder.method", 1]
    ]);
    expect(methods.every((method) => method.functionSpan !== undefined)).toBe(true);
  });
});
