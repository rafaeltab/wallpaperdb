/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const src = path.resolve(import.meta.dirname, '../../src');
const inside = (file: string, directory: string) => file.startsWith(`${directory}/`);

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}

it.each([
  'upload-queue',
  'profile-editor',
  'grid-layout',
])('keeps %s independent and consumers behind its public entry', (name) => {
  const feature = path.join(src, 'features', name);
  const adapters = path.join(feature, 'adapters');
  const errors: string[] = [];
  const browserGlobals = new Set([
    'window',
    'document',
    'fetch',
    'File',
    'Blob',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    'Date',
  ]);
  for (const filename of [...files(src), ...files(path.resolve(src, '../test'))]) {
    const core = inside(filename, feature) && !inside(filename, adapters);
    const source = ts.createSourceFile(
      filename,
      fs.readFileSync(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function checkImport(specifier: string) {
      const target = specifier.startsWith('@/')
        ? path.join(src, specifier.slice(2))
        : specifier.startsWith('.')
          ? path.resolve(path.dirname(filename), specifier)
          : undefined;
      const allowedSharedPolicy =
        name === 'profile-editor' && specifier === '@wallpaperdb/profile-markdown';
      if (
        core &&
        !allowedSharedPolicy &&
        (!target || !inside(target, feature) || inside(target, adapters))
      )
        errors.push(`${filename}: core cannot import ${specifier}`);
      if (
        !inside(filename, feature) &&
        target &&
        inside(target, feature) &&
        !inside(target, adapters) &&
        target !== path.join(feature, 'index')
      )
        errors.push(`${filename}: use the ${name} entry point`);
    }
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        checkImport(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) checkImport(argument.text);
        else if (core) errors.push(`${filename}: core cannot use computed imports`);
      }
      if (core && ts.isIdentifier(node) && browserGlobals.has(node.text))
        errors.push(`${filename}: inject ${node.text} through an adapter`);
      if (
        core &&
        ts.isPropertyAccessExpression(node) &&
        node.expression.getText(source) === 'Math' &&
        node.name.text === 'random'
      )
        errors.push(`${filename}: inject randomness through an adapter`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(errors).toEqual([]);
});
