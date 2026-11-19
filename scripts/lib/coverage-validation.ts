import assert from 'node:assert/strict';
import type { FileCoverageData, Range } from 'istanbul-lib-coverage';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLineEnd(span: unknown) {
  if (isRecord(span) && isRecord(span.end) && span.end.column === null) {
    // Vitest 5 serializes Istanbul's Infinity (through end of line) as null.
    // Match the core parser's line-end sentinel, without inventing any hits.
    span.end.column = Number.MAX_SAFE_INTEGER;
  }
}

function isImplicitElse(span: unknown) {
  return (
    isRecord(span) &&
    isRecord(span.start) &&
    isRecord(span.end) &&
    Object.keys(span.start).length === 0 &&
    Object.keys(span.end).length === 0
  );
}

export function normalizeVitestCoverage(file: unknown) {
  if (!isRecord(file)) return;
  if (isRecord(file.statementMap)) {
    for (const span of Object.values(file.statementMap)) normalizeLineEnd(span);
  }
  if (isRecord(file.fnMap)) {
    for (const entry of Object.values(file.fnMap)) {
      if (!isRecord(entry)) continue;
      normalizeLineEnd(entry.decl);
      normalizeLineEnd(entry.loc);
    }
  }
  if (isRecord(file.branchMap)) {
    for (const entry of Object.values(file.branchMap)) {
      if (!isRecord(entry)) continue;
      normalizeLineEnd(entry.loc);
      if (!Array.isArray(entry.locations)) continue;
      // An if without an else still measures its false path. Vitest leaves that
      // path's location empty; retain its own counter at the enclosing decision.
      // Other absent ranges remain malformed and are rejected below.
      if (
        entry.type === 'if' &&
        entry.locations.length === 2 &&
        isImplicitElse(entry.locations[1])
      ) {
        entry.locations[1] = entry.loc;
      }
      for (const location of entry.locations) normalizeLineEnd(location);
    }
  }
}

function validateSpan(span: unknown): asserts span is Range {
  assert(isRecord(span) && isRecord(span.start) && isRecord(span.end), 'Invalid coverage span');
  for (const point of [span.start, span.end]) {
    assert(
      typeof point.line === 'number' && Number.isInteger(point.line) && point.line >= 1,
      'Invalid coverage line',
    );
    assert(
      typeof point.column === 'number' && Number.isInteger(point.column) && point.column >= 0,
      'Invalid coverage column',
    );
  }
  assert(
    typeof span.start.line === 'number' &&
      typeof span.end.line === 'number' &&
      typeof span.start.column === 'number' &&
      typeof span.end.column === 'number' &&
      (span.end.line > span.start.line ||
        (span.end.line === span.start.line && span.end.column >= span.start.column)),
    'Invalid coverage span',
  );
}

export function isEmptyCoverage(file: Record<string, unknown>): boolean {
  const functions = isRecord(file.fnMap) ? Object.values(file.fnMap) : [];
  return (
    file.all === true &&
    functions.length === 1 &&
    isRecord(functions[0]) &&
    functions[0].name === '(empty-report)'
  );
}

export function validateFileCoverage(
  file: unknown,
): asserts file is FileCoverageData & Record<string, unknown> {
  assert(
    isRecord(file) && typeof file.path === 'string' && file.path.length > 0,
    'Invalid coverage file',
  );
  const emptyReport = isEmptyCoverage(file);
  for (const [map, counts] of [
    ['statementMap', 's'],
    ['fnMap', 'f'],
    ['branchMap', 'b'],
  ]) {
    const mappings: unknown = file[map];
    const counters: unknown = file[counts];
    assert(isRecord(mappings) && isRecord(counters), `Missing ${map}/${counts}`);
    assert.deepEqual(
      Object.keys(mappings).sort(),
      Object.keys(counters).sort(),
      `Mismatched ${map}/${counts}`,
    );
    for (const [id, entry] of Object.entries(mappings)) {
      const hits: unknown = counts === 'b' ? counters[id] : [counters[id]];
      assert(
        Array.isArray(hits) &&
          hits.every(
            (hit: unknown) => typeof hit === 'number' && Number.isSafeInteger(hit) && hit >= 0,
          ),
        'Invalid coverage counters',
      );
      if (map === 'statementMap') validateSpan(entry);
      else {
        // Vitest 3's v8-to-istanbul emits synthetic whole-file function/branch
        // spans for unloaded modules, sometimes with negative remapped columns.
        // These are not function measurements; retain the source in the inventory
        // with missing coverage, as Istanbul also does when merging `all` reports.
        if (emptyReport) continue;
        assert(isRecord(entry), `Invalid ${map} entry`);
        validateSpan(entry.loc);
        if (map === 'fnMap') validateSpan(entry?.decl);
        if (map === 'branchMap') {
          assert(
            Array.isArray(entry.locations) && entry.locations.length === hits.length,
            'Invalid branch locations',
          );
          for (const location of entry.locations) validateSpan(location);
        }
      }
    }
  }
  if (emptyReport) {
    assert(
      isRecord(file.s) && Object.values(file.s).every((hits) => hits === 0),
      'Empty coverage report contains statement hits',
    );
  }
}

