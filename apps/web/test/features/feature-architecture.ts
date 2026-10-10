import path from 'node:path';
import ts from 'typescript';

const approvedSharedModules = new Set(['@wallpaperdb/profile-markdown', '@/lib/graphql/types']);
// These are deliberately public effectful entries. New adapter helpers remain private.
const publicAdapters = new Set([
  'authentication/adapters/navigation.ts',
  'grid-layout/adapters/muuri.ts',
  'profile-editor/adapters/react.ts',
  'profile-management/adapters/query.ts',
  'public-profile/adapters/routes.ts',
  'request-admission/adapters/graphql.ts',
  'upload-queue/adapters/browser.ts',
  'wallpaper-details/adapters/download.ts',
  'wallpaper-details/adapters/share.ts',
]);
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

export function featureArchitectureErrors(src: string, sources: Map<string, string>) {
  const root = path.join(src, 'features');
  const errors: string[] = [];
  const graph = new Map<string, Set<string>>();
  function owner(filename: string) {
    return filename.startsWith(`${root}/`)
      ? path.relative(root, filename).split('/')[0]
      : undefined;
  }
  function adapter(filename: string) {
    return path.relative(root, filename).split('/')[1] === 'adapters';
  }
  function resolve(filename: string, specifier: string) {
    const target = specifier.startsWith('@/')
      ? path.join(src, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(filename), specifier)
        : undefined;
    if (!target) return undefined;
    return (
      [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find((file) =>
        sources.has(file)
      ) ?? target
    );
  }
  for (const [filename, content] of sources) {
    const feature = owner(filename);
    const core = Boolean(feature && !adapter(filename));
    if (feature && !graph.has(feature)) graph.set(feature, new Set());
    const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
    function checkImport(specifier: string) {
      const target = resolve(filename, specifier);
      const destination = target && owner(target);
      const publicCore = destination && target === path.join(root, destination, 'index.ts');
      if (
        core &&
        !approvedSharedModules.has(specifier) &&
        (!target || !destination || adapter(target) || (destination !== feature && !publicCore))
      )
        errors.push(`${filename}: core cannot import ${specifier}`);
      if (destination && destination !== feature) {
        if (!publicCore && !publicAdapters.has(path.relative(root, target)))
          errors.push(`${filename}: use the ${destination} public entry point`);
        if (feature) graph.get(feature)?.add(destination);
      }
    }
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        checkImport(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        checkImport(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) checkImport(argument.text);
        else if (feature) errors.push(`${filename}: feature cannot use computed imports`);
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
  const complete = new Set<string>();
  function visitFeature(feature: string, ancestors: string[]) {
    if (ancestors.includes(feature)) {
      errors.push(`feature dependency cycle: ${[...ancestors, feature].join(' -> ')}`);
      return;
    }
    if (complete.has(feature)) return;
    for (const dependency of graph.get(feature) ?? [])
      visitFeature(dependency, [...ancestors, feature]);
    complete.add(feature);
  }
  for (const feature of graph.keys()) visitFeature(feature, []);
  return errors;
}
