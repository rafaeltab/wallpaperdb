import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

function fixture(t) {
  // The analyzer core normalizes report keys to lower case on every platform.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crap-scope-Case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'packages', 'node_modules/.bin']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of ['scripts/crap.mts', 'crap.config.mts']) {
    fs.copyFileSync(path.join(repository, file), path.join(root, file));
  }
  for (const dependency of ['@barney-media', 'istanbul-lib-coverage']) {
    fs.symlinkSync(path.join(repository, 'node_modules', dependency), path.join(root, 'node_modules', dependency));
  }
  fs.writeFileSync(path.join(root, 'node_modules/.bin/turbo'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const filters = process.argv.filter((arg) => arg.startsWith('--filter='));
fs.writeFileSync('selected.json', JSON.stringify(filters));
for (const filter of filters) {
  const name = filter.split('/').at(-1);
  const source = path.resolve('apps', name, 'src/index.ts');
  const output = path.join('apps', name, 'coverage/unit');
  fs.mkdirSync(output, {recursive: true});
  const span = {start: {line: 1, column: 0}, end: {line: 1, column: 40}};
  const coverage = fs.existsSync('fixture-coverage.json')
    ? JSON.parse(fs.readFileSync('fixture-coverage.json', 'utf8'))
    : {
    path: source, statementMap: {0: span}, s: {0: 1}, branchMap: {}, b: {},
    fnMap: {0: {name: 'identity', decl: span, loc: span, line: 1}}, f: {0: 1}
  };
  fs.writeFileSync(path.join(output, 'coverage-final.json'), JSON.stringify({[source]: {...coverage, path: source}}));
}
`, { mode: 0o755 });
  for (const name of ['ingestor', 'other']) {
    const directory = path.join(root, 'apps', name);
    fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: `@wallpaperdb/${name}`, scripts: { 'test:unit': 'vitest run --coverage' },
    }));
    fs.writeFileSync(path.join(directory, 'src/index.ts'), 'export function identity() { return 1; }\n');
  }
  return {
    root,
    coverage(source, report) {
      fs.writeFileSync(path.join(root, 'apps/ingestor/src/index.ts'), source);
      fs.writeFileSync(path.join(root, 'fixture-coverage.json'), JSON.stringify(report));
    },
    run(workspace = '') {
      return spawnSync(path.join(repository, 'node_modules/.bin/tsx'), ['scripts/crap.mts', 'report'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PACKAGE: workspace }, timeout: 30_000,
      });
    },
    selected: () => JSON.parse(fs.readFileSync(path.join(root, 'selected.json'), 'utf8')),
  };
}

test('scoped CRAP refreshes and analyzes only the selected workspace', (t) => {
  const project = fixture(t);
  const result = project.run('ingestor');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(project.selected(), ['--filter=@wallpaperdb/ingestor']);
  assert.match(result.stdout, /apps\/ingestor\/src\/index.ts/);
  assert.doesNotMatch(result.stdout, /apps\/other/);
});

test('unscoped CRAP retains repository-wide coverage and source analysis', (t) => {
  const project = fixture(t);
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(project.selected(), ['--filter=@wallpaperdb/ingestor', '--filter=@wallpaperdb/other']);
  assert.match(result.stdout, /apps\/ingestor\/src\/index.ts/);
  assert.match(result.stdout, /apps\/other\/src\/index.ts/);
});

test('unknown workspace fails before executing coverage tasks', (t) => {
  const project = fixture(t);
  const result = project.run('missing');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No CRAP workspace matches PACKAGE=missing/);
  assert.equal(fs.existsSync(path.join(project.root, 'selected.json')), false);
});

test('Vitest 5 line-end columns and implicit else locations preserve uncovered decisions', (t) => {
  const project = fixture(t);
  const line = (start, end = start) => ({
    start: { line: start, column: 0 }, end: { line: end, column: null },
  });
  const declaration = line(1, 9);
  const statementMap = { 0: declaration };
  const hits = { 0: 1 };
  const branchMap = {};
  const branches = {};
  for (let index = 1; index <= 7; index++) {
    statementMap[index] = line(index + 1);
    hits[index] = 0;
    if (index <= 6) {
      branchMap[index] = {
        type: 'if', line: index + 1, loc: line(index + 1),
        locations: [line(index + 1), { start: {}, end: {} }],
      };
      branches[index] = [0, 0];
    }
  }
  project.coverage([
    'export const choose = (value: number) => {',
    ...Array.from({ length: 6 }, (_, index) => `  if (value === ${index + 1}) return ${index + 1};`),
    '  return 0;',
    '};',
  ].join('\n'), {
    statementMap, s: hits, branchMap, b: branches,
    fnMap: { 0: { name: 'choose', decl: line(1), loc: declaration, line: 1 } }, f: { 0: 0 },
  });
  const result = project.run('ingestor');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /56\.000\t7\t0\.00%\t.*\tchoose/);
});

test('an uncovered implicit else still reduces otherwise complete function coverage', (t) => {
  const project = fixture(t);
  const line = (number) => ({ start: { line: number, column: 0 }, end: { line: number, column: null } });
  const body = { start: { line: 1, column: 0 }, end: { line: 4, column: null } };
  project.coverage('export function identity(value: number) {\n  if (value) return 1;\n  return 0;\n}\n', {
    statementMap: { 0: body, 1: line(2), 2: line(3) }, s: { 0: 1, 1: 1, 2: 1 },
    fnMap: { 0: { name: 'identity', decl: line(1), loc: body, line: 1 } }, f: { 0: 1 },
    branchMap: { 0: { type: 'if', line: 2, loc: line(2), locations: [line(2), { start: {}, end: {} }] } },
    b: { 0: [1, 0] },
  });
  const result = project.run('ingestor');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2\.500\t2\t50\.00%\t.*\tidentity/);
});

for (const [name, corrupt] of [
  ['negative column', (data) => { data.statementMap[0].end.column = -1; }],
  ['null start column', (data) => { data.statementMap[0].start.column = null; }],
  ['missing end column', (data) => { delete data.statementMap[0].end.column; }],
  ['negative counter', (data) => { data.s[0] = -1; }],
  ['missing branch locations', (data) => {
    data.branchMap[0] = { type: 'if', loc: data.statementMap[0], locations: [{ start: {}, end: {} }, { start: {}, end: {} }] };
    data.b[0] = [1, 0];
  }],
]) {
  test(`Vitest normalization still rejects ${name}`, (t) => {
    const project = fixture(t);
    const span = () => ({ start: { line: 1, column: 0 }, end: { line: 1, column: 40 } });
    const data = {
      statementMap: { 0: span() }, s: { 0: 1 },
      fnMap: { 0: { name: 'identity', decl: span(), loc: span(), line: 1 } }, f: { 0: 1 },
      branchMap: {}, b: {},
    };
    corrupt(data);
    project.coverage('export function identity() { return 1; }', data);
    const result = project.run('ingestor');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot combine coverage/);
  });
}
