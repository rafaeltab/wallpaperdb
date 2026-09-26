import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 3) {
  console.error('Usage: node scripts/check-architecture.mjs apps/<application>');
  process.exit(1);
}
const application = path.resolve(repo, process.argv[2]);
const applicationName = path.basename(application);
const packageName = JSON.parse(fs.readFileSync(path.join(application, 'package.json'), 'utf8')).name;
const src = path.join(application, 'src');
const require = createRequire(path.join(application, 'package.json'));
const ts = require('typescript');
const config = JSON.parse(fs.readFileSync(path.join(application, 'quality.config.json'), 'utf8'));
const errors = [];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : filename.endsWith('.ts') ? [filename] : [];
  });
}

function capability(filename) {
  const segment = path.relative(src, filename).split(path.sep)[0];
  return config.capabilities.includes(segment) ? segment : undefined;
}

function publicModule(filename) {
  const relative = path.relative(src, filename).split(path.sep).join('/');
  return config.publicModules.find((module) => relative.startsWith(`${module}/`));
}

function importPaths(source) {
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, node });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      imports.push({ specifier: node.arguments[0].text, node });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

const sourceFiles = files(src);
const graph = new Map(sourceFiles.map((filename) => [filename, []]));
for (const filename of [...sourceFiles, ...files(path.join(application, 'test'))]) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = capability(filename);
  for (const { specifier, node } of importPaths(source)) {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const location = `${path.relative(repo, filename)}:${line}`;
    const resolved = ts.resolveModuleName(specifier, filename, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule?.resolvedFileName;
    if (specifier === 'tsyringe' || specifier === 'reflect-metadata') errors.push(`${location}: ${applicationName} uses Effect service layers; remove ${specifier}`);
    if (owner && !specifier.startsWith('.') && specifier !== 'effect' && !config.allowedCapabilityDependencies?.[owner]?.includes(specifier)) errors.push(`${location}: ${owner} depends on external technology ${specifier}`);
    if (!resolved || !resolved.startsWith(`${src}${path.sep}`)) continue;
    if (graph.has(filename)) graph.get(filename).push(resolved);
    const module = publicModule(resolved);
    if (module && module !== publicModule(filename) && resolved !== path.join(src, module, 'index.ts')) errors.push(`${location}: import ${module} through its index.ts entry point`);
    const target = capability(resolved);
    if (owner && !target) errors.push(`${location}: ${owner} must not depend on ${path.relative(src, resolved)}`);
    if (owner && filename === path.join(src, owner, 'index.ts') && ts.isExportDeclaration(node) && !node.isTypeOnly) errors.push(`${location}: capability entry point must not re-export implementation`);
  }
}

// Package exports cannot prevent relative imports that bypass the application package.
// Verify other workspace source trees do not reach into this deployable application.
for (const group of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(path.join(repo, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(repo, group, entry.name, 'src');
    if (directory === src || !fs.existsSync(directory)) continue;
    for (const filename of files(directory)) {
      const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const { specifier } of importPaths(source)) {
        const target = specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : undefined;
        if (specifier === packageName || specifier.startsWith(`${packageName}/`) || target?.startsWith(`${application}${path.sep}`)) {
          errors.push(`${path.relative(repo, filename)}: another workspace must communicate with the ${applicationName} through its external contracts`);
        }
      }
    }
  }
}

const visited = new Set();
const active = new Set();
function visit(filename, trail = []) {
  if (active.has(filename)) {
    errors.push(`Dependency cycle: ${[...trail, filename].map((item) => path.relative(src, item)).join(' -> ')}`);
    return;
  }
  if (visited.has(filename)) return;
  active.add(filename);
  for (const dependency of graph.get(filename) ?? []) visit(dependency, [...trail, filename]);
  active.delete(filename);
  visited.add(filename);
}
for (const filename of sourceFiles) visit(filename);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${applicationName} architecture: ${sourceFiles.length} source files, public capability entries, inward dependencies and acyclicity verified.`);
}
