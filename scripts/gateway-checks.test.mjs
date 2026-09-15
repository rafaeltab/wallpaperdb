import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const sourceTimestamp = new Date('2026-01-01T00:00:00.000Z');
const coverageTimestamp = new Date('2026-01-01T00:00:01.000Z');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-checks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gateway = path.join(root, 'apps/gateway');
  for (const directory of ['scripts', 'packages', 'apps/gateway/src', 'apps/gateway/test']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const script of ['gateway-architecture.mjs', 'gateway-quality.mjs']) {
    fs.copyFileSync(path.join(repository, 'scripts', script), path.join(root, 'scripts', script));
  }
  fs.writeFileSync(path.join(gateway, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(gateway, 'quality.config.json'), JSON.stringify({
    crapThreshold: 30,
    capabilities: ['catalogue', 'projection'],
    publicModules: ['catalogue', 'projection', 'adapters/search'],
  }));
  fs.symlinkSync(path.join(repository, 'apps/gateway/node_modules'), path.join(gateway, 'node_modules'), 'dir');

  function write(relative, content) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
    fs.utimesSync(filename, sourceTimestamp, sourceTimestamp);
    return filename;
  }
  return {
    root,
    write,
    source: (relative, content) => write(`apps/gateway/src/${relative}`, content),
    coverage(report) {
      const filename = write('apps/gateway/coverage/coverage-final.json', JSON.stringify(report));
      fs.utimesSync(filename, coverageTimestamp, coverageTimestamp);
      return filename;
    },
    report() {
      return JSON.parse(fs.readFileSync(path.join(gateway, 'coverage/crap-report.json'), 'utf8'));
    },
    run(script) {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(result.error, undefined, result.error?.message);
      return result;
    },
  };
}

function validGraph(project) {
  project.source('catalogue/private.ts', 'export const normalize = (value: string) => value.toLowerCase();\n');
  project.source('catalogue/index.ts', "import { normalize } from './private.js';\nexport const search = (value: string) => normalize(value);\n");
  project.source('projection/index.ts', "import { search } from '../catalogue/index.js';\nexport const project = (value: string) => search(value);\n");
  project.source('adapters/search/index.ts', "import { createHash } from 'node:crypto';\nexport const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');\n");
  project.source('app.ts', "import { search } from './catalogue/index.js';\nexport const query = search;\n");
  project.write('apps/gateway/test/catalogue.test.ts', "import { search } from '../src/catalogue/index.js';\nsearch('value');\n");
}

test('architecture accepts public capability calls, private collaborators and adapter technology', (t) => {
  const project = fixture(t);
  validGraph(project);
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /public capability entries, inward dependencies and acyclicity verified/);
});

test('architecture rejects another capability importing private implementation', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('projection/index.ts', "import { normalize } from '../catalogue/private.js';\nexport const project = normalize;\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projection\/index\.ts:1: import catalogue through its index\.ts entry point/);
});

test('architecture rejects private implementation imports from external tests', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.write('apps/gateway/test/catalogue.test.ts', "import { normalize } from '../src/catalogue/private.js';\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test\/catalogue\.test\.ts:1: import catalogue through its index\.ts entry point/);
});

test('architecture rejects vendor dependencies inside capabilities', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', "import { createHash } from 'node:crypto';\nexport const identity = createHash;\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalogue depends on external technology node:crypto/);
});

test('architecture rejects outward application dependencies on adapters', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('catalogue/index.ts', "import { fingerprint } from '../adapters/search/index.js';\nexport const search = fingerprint;\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalogue must not depend on adapters\/search\/index\.ts/);
});

test('architecture rejects implementation re-exports from capability entries', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('catalogue/index.ts', "export { normalize } from './private.js';\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capability entry point must not re-export implementation/);
});

test('architecture checks literal dynamic imports against entry points', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('app.ts', "export const load = () => import('./catalogue/private.js');\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /import catalogue through its index\.ts entry point/);
});

test('architecture reports dependency cycles including private collaborators', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', "import { first } from './first.js';\nexport const search = first;\n");
  project.source('catalogue/first.ts', "import { second } from './second.js';\nexport const first = () => second();\n");
  project.source('catalogue/second.ts', "import { first } from './first.js';\nexport const second = () => first();\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency cycle: .*catalogue\/first\.ts.*catalogue\/second\.ts.*catalogue\/first\.ts/);
});

test('architecture rejects container injection even in adapters', (t) => {
  const project = fixture(t);
  project.source('adapters/search/index.ts', "import { container } from 'tsyringe';\nexport const resolve = container.resolve;\n");
  const result = project.run('gateway-architecture.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gateway uses constructor injection; remove tsyringe/);
});

for (const [name, directory, specifier] of [
  ['application', 'apps/other', '../../gateway/src/catalogue/index.js'],
  ['shared package', 'packages/other', '@wallpaperdb/gateway/catalogue'],
]) {
  test(`architecture rejects ${name} bypassing the deployed gateway contract`, (t) => {
    const project = fixture(t);
    validGraph(project);
    project.write(`${directory}/src/index.ts`, `import { search } from '${specifier}';\n`);
    const result = project.run('gateway-architecture.mjs');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /another workspace must communicate with the gateway through its external contracts/);
  });
}

const decisionTable = [
  'export function choose(value: number) {',
  '  if (value === 1) return "one";',
  '  if (value === 2) return "two";',
  '  if (value === 3) return "three";',
  '  if (value === 4) return "four";',
  '  if (value === 5) return "five";',
  '  if (value === 6) return "six";',
  '  return "other";',
  '}',
  '',
].join('\n');

function measuredFunction(filename, hitCount) {
  const statementMap = {};
  const hits = {};
  for (let line = 2; line <= 8; line++) {
    statementMap[String(line)] = { start: { line, column: 2 }, end: { line, column: 30 } };
    hits[String(line)] = hitCount;
  }
  return { [filename]: { statementMap, s: hits, fnMap: {}, f: {} } };
}

test('quality requires an existing coverage measurement', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', decisionTable);
  const result = project.run('gateway-quality.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run make gateway-test-coverage before make gateway-quality/);
});

test('quality rejects uncovered functions above the configured CRAP threshold', (t) => {
  const project = fixture(t);
  const filename = project.source('catalogue/index.ts', decisionTable);
  project.coverage(measuredFunction(filename, 0));
  const result = project.run('gateway-quality.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /choose: CRAP 56 > 30 \(complexity 7, coverage 0%\)/);
  assert.equal(project.report().functions[0].crap, 56);
});

test('quality treats a missing file measurement as uncovered', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', decisionTable);
  project.coverage({});
  const result = project.run('gateway-quality.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /coverage 0%/);
});

test('quality accepts a covered function and writes its auditable risk report', (t) => {
  const project = fixture(t);
  const filename = project.source('catalogue/index.ts', decisionTable);
  project.coverage(measuredFunction(filename, 1));
  const result = project.run('gateway-quality.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 functions, threshold 30, 0 violations/);
  assert.deepEqual(project.report(), {
    threshold: 30,
    functions: [{ file: 'src/catalogue/index.ts', line: 1, function: 'choose', complexity: 7, coverage: 100, crap: 7 }],
  });
});

test('quality rejects a source file changed after its coverage measurement', (t) => {
  const project = fixture(t);
  const filename = project.source('catalogue/index.ts', decisionTable);
  project.coverage(measuredFunction(filename, 1));
  const changed = new Date('2026-01-01T00:00:02.000Z');
  fs.utimesSync(filename, changed, changed);
  const result = project.run('gateway-quality.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Coverage predates src\/catalogue\/index\.ts/);
});
