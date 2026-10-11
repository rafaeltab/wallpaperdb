import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

async function importsFrom(
  file: string,
  visited = new Set<string>()
): Promise<{
  external: Set<string>;
  deferred: Set<string>;
}> {
  const external = new Set<string>();
  const deferred = new Set<string>();
  if (visited.has(file)) return { external, deferred };
  visited.add(file);
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const dependencies: string[] = [];
  function inspect(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const dependency = node.moduleSpecifier.text;
      if (dependency.startsWith('.')) dependencies.push(resolve(dirname(file), dependency));
      else external.add(dependency);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0];
      if (target && ts.isStringLiteral(target) && target.text.startsWith('.')) {
        deferred.add(resolve(dirname(file), target.text));
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  for (const dependency of dependencies) {
    const nested = await importsFrom(dependency, visited);
    for (const item of nested.external) external.add(item);
    for (const item of nested.deferred) deferred.add(item);
  }
  return { external, deferred };
}

it('keeps production HTTP and storage clients behind the post-SDK dynamic import', async () => {
  // Exercise the same build configuration as the deployed artifact.
  await import('../esbuild.config.js');
  const bootstrap = await importsFrom(resolve('dist/index.mjs'));
  const instrumentedClients = ['fastify', '@aws-sdk/client-s3', 'nats'];
  for (const client of instrumentedClients) expect(bootstrap.external.has(client)).toBe(false);
  const deferredClients = new Set<string>();
  for (const deferred of bootstrap.deferred) {
    for (const client of (await importsFrom(deferred)).external) deferredClients.add(client);
  }
  for (const client of instrumentedClients) expect(deferredClients.has(client)).toBe(true);
  // The process decoder remains a sibling artifact after chunking.
  expect(await readFile('dist/decoder.mjs', 'utf8')).toContain('sharp');
});
