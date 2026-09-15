import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const gateway = path.join(repo, 'apps/gateway');
const require = createRequire(path.join(gateway, 'package.json'));
const ts = require('typescript');
const config = JSON.parse(fs.readFileSync(path.join(gateway, 'quality.config.json'), 'utf8'));
const coveragePath = path.join(gateway, 'coverage/coverage-final.json');
if (!fs.existsSync(coveragePath)) throw new Error('Run make gateway-test-coverage before make gateway-quality.');
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const coverageUpdated = fs.statSync(coveragePath).mtimeMs;

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : filename.endsWith('.ts') && !filename.endsWith('.d.ts') ? [filename] : [];
  });
}

const decisionKinds = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
]);
const logicalKinds = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
]);

function complexity(fn) {
  let count = 1;
  function visit(node) {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (decisionKinds.has(node.kind)) count++;
    if (ts.isBinaryExpression(node) && logicalKinds.has(node.operatorToken.kind)) count++;
    if (ts.isParameter(node) && node.initializer) count++;
    ts.forEachChild(node, visit);
  }
  visit(fn);
  return count;
}

function functionCoverage(fn, source, report) {
  if (!report) return 0;
  const start = source.getLineAndCharacterOfPosition(fn.body.getStart()).line + 1;
  const end = source.getLineAndCharacterOfPosition(fn.body.getEnd()).line + 1;
  const lineHits = new Map();
  for (const [id, statement] of Object.entries(report.statementMap)) {
    for (let line = Math.max(start, statement.start.line); line <= Math.min(end, statement.end.line); line++) {
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, report.s[id]));
    }
  }
  if (lineHits.size > 0) return [...lineHits.values()].filter((hits) => hits > 0).length / lineHits.size;
  const functionLine = source.getLineAndCharacterOfPosition(fn.getStart()).line + 1;
  for (const [id, item] of Object.entries(report.fnMap)) {
    if (item.decl.start.line === functionLine || item.loc.start.line === start) return report.f[id] > 0 ? 1 : 0;
  }
  return 0;
}

const results = [];
for (const filename of files(path.join(gateway, 'src'))) {
  if (fs.statSync(filename).mtimeMs > coverageUpdated) throw new Error(`Coverage predates ${path.relative(gateway, filename)}. Run make gateway-test-coverage again.`);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const cc = complexity(node);
      const covered = functionCoverage(node, source, coverage[filename]);
      results.push({
        file: path.relative(gateway, filename),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        function: node.name?.getText(source) ?? '<anonymous>',
        complexity: cc,
        coverage: Math.round(covered * 10000) / 100,
        crap: Math.round((cc * cc * (1 - covered) ** 3 + cc) * 100) / 100,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
results.sort((a, b) => b.crap - a.crap);
fs.writeFileSync(path.join(gateway, 'coverage/crap-report.json'), `${JSON.stringify({ threshold: config.crapThreshold, functions: results }, null, 2)}\n`);
const failures = results.filter((item) => item.crap > config.crapThreshold);
for (const item of failures) console.error(`${item.file}:${item.line} ${item.function}: CRAP ${item.crap} > ${config.crapThreshold} (complexity ${item.complexity}, coverage ${item.coverage}%)`);
console.log(`Gateway CRAP: ${results.length} functions, threshold ${config.crapThreshold}, ${failures.length} violations.`);
if (failures.length > 0) process.exitCode = 1;
