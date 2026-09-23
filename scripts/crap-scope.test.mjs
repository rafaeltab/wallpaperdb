import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crap-scope-'));
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
  fs.writeFileSync(path.join(output, 'coverage-final.json'), JSON.stringify({[source]: {
    path: source, statementMap: {0: span}, s: {0: 1}, branchMap: {}, b: {},
    fnMap: {0: {name: 'identity', decl: span, loc: span, line: 1}}, f: {0: 1}
  }}));
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
