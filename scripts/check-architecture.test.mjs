import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

function fixture(t, allowedCapabilityDependencies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const example = path.join(root, 'apps/example');
  for (const directory of ['scripts', 'packages', 'apps/example/src', 'apps/example/test']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.copyFileSync(path.join(repository, 'scripts/check-architecture.mjs'), path.join(root, 'scripts/check-architecture.mjs'));
  fs.writeFileSync(path.join(example, 'package.json'), JSON.stringify({ name: '@wallpaperdb/example', type: 'module' }));
  fs.writeFileSync(path.join(example, 'quality.config.json'), JSON.stringify({
    capabilities: ['catalogue', 'projection'],
    allowedCapabilityDependencies,
    publicModules: ['catalogue', 'projection', 'adapters/search'],
  }));
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(example, 'node_modules'), 'dir');

  function write(relative, content) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
    return filename;
  }
  return {
    write,
    source: (relative, content) => write(`apps/example/src/${relative}`, content),
    run() {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-architecture.mjs'), 'apps/example'], {
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
  project.write('apps/example/test/catalogue.test.ts', "import { search } from '../src/catalogue/index.js';\nsearch('value');\n");
}

test('architecture accepts public capability calls, private collaborators and adapter technology', (t) => {
  const project = fixture(t);
  validGraph(project);
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /public capability entries, inward dependencies and acyclicity verified/);
});

test('architecture rejects another capability importing private implementation', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('projection/index.ts', "import { normalize } from '../catalogue/private.js';\nexport const project = normalize;\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projection\/index\.ts:1: import catalogue through its index\.ts entry point/);
});

test('architecture rejects private implementation imports from external tests', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.write('apps/example/test/catalogue.test.ts', "import { normalize } from '../src/catalogue/private.js';\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test\/catalogue\.test\.ts:1: import catalogue through its index\.ts entry point/);
});

test('architecture rejects vendor dependencies inside capabilities', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', "import { createHash } from 'node:crypto';\nexport const identity = createHash;\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalogue depends on external technology node:crypto/);
});

test('architecture rejects outward application dependencies on adapters', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('catalogue/index.ts', "import { fingerprint } from '../adapters/search/index.js';\nexport const search = fingerprint;\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalogue must not depend on adapters\/search\/index\.ts/);
});

test('architecture rejects implementation re-exports from capability entries', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('catalogue/index.ts', "export { normalize } from './private.js';\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capability entry point must not re-export implementation/);
});

test('architecture checks literal dynamic imports against entry points', (t) => {
  const project = fixture(t);
  validGraph(project);
  project.source('app.ts', "export const load = () => import('./catalogue/private.js');\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /import catalogue through its index\.ts entry point/);
});

test('architecture reports dependency cycles including private collaborators', (t) => {
  const project = fixture(t);
  project.source('catalogue/index.ts', "import { first } from './first.js';\nexport const search = first;\n");
  project.source('catalogue/first.ts', "import { second } from './second.js';\nexport const first = () => second();\n");
  project.source('catalogue/second.ts', "import { first } from './first.js';\nexport const second = () => first();\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency cycle: .*catalogue\/first\.ts.*catalogue\/second\.ts.*catalogue\/first\.ts/);
});

test('architecture rejects container injection even in adapters', (t) => {
  const project = fixture(t);
  project.source('adapters/search/index.ts', "import { container } from 'tsyringe';\nexport const resolve = container.resolve;\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /example uses Effect service layers; remove tsyringe/);
});

for (const [name, directory, specifier] of [
  ['application', 'apps/other', '../../example/src/catalogue/index.js'],
  ['shared package', 'packages/other', '@wallpaperdb/example/catalogue'],
]) {
  test(`architecture rejects ${name} bypassing the deployed example contract`, (t) => {
    const project = fixture(t);
    validGraph(project);
    project.write(`${directory}/src/index.ts`, `import { search } from '${specifier}';\n`);
    const result = project.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /another workspace must communicate with the example through its external contracts/);
  });
}


test('architecture permits an explicitly authorized shared policy only in its consuming capability', (t) => {
  const project = fixture(t, { catalogue: ['@wallpaperdb/profile-markdown'] });
  project.source('catalogue/index.ts', "import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';\nexport const validate = validateProfileMarkdown;\n");
  assert.equal(project.run().status, 0);
  project.source('projection/index.ts', "import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';\nexport const validate = validateProfileMarkdown;\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projection depends on external technology @wallpaperdb\/profile-markdown/);
});

test('architecture shared-policy exception does not allow vendor dependencies or package subpaths', (t) => {
  const project = fixture(t, { catalogue: ['@wallpaperdb/profile-markdown'] });
  project.source('catalogue/index.ts', "import { createHash } from 'node:crypto';\nimport { hidden } from '@wallpaperdb/profile-markdown/private';\nexport const value = [createHash, hidden];\n");
  const result = project.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalogue depends on external technology node:crypto/);
  assert.match(result.stderr, /catalogue depends on external technology @wallpaperdb\/profile-markdown\/private/);
});
