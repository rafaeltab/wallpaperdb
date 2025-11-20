#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const coveragePath = path.join(process.cwd(), 'coverage/coverage-summary.json');

if (!fs.existsSync(coveragePath)) {
  console.log('No coverage found. Run: make test-coverage');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
const total = data.total;

console.log('\n=== COVERAGE SUMMARY ===\n');
console.log(`Lines:      ${total.lines.pct}%`);
console.log(`Statements: ${total.statements.pct}%`);
console.log(`Functions:  ${total.functions.pct}%`);
console.log(`Branches:   ${total.branches.pct}%`);

// Files with <50% coverage
const lowCoverageFiles = Object.entries(data)
  .filter(([k]) => k !== 'total')
  .filter(([_, s]) => s.lines.pct < 50)
  .sort((a, b) => a[1].lines.pct - b[1].lines.pct);

if (lowCoverageFiles.length > 0) {
  console.log('\n=== LOW COVERAGE (<50%) ===\n');
  lowCoverageFiles.forEach(([file, stats]) => {
    console.log(`${stats.lines.pct.toFixed(1)}% - ${file}`);
  });
}

// High coverage files (>=80%)
const highCoverageFiles = Object.entries(data)
  .filter(([k]) => k !== 'total')
  .filter(([_, s]) => s.lines.pct >= 80)
  .sort((a, b) => b[1].lines.pct - a[1].lines.pct);

if (highCoverageFiles.length > 0) {
  console.log('\n=== HIGH COVERAGE (>=80%) ===\n');
  highCoverageFiles.forEach(([file, stats]) => {
    console.log(`${stats.lines.pct.toFixed(1)}% - ${file}`);
  });
}

console.log('\n');
