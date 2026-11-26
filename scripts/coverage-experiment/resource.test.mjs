import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../.coverage-experiment/build/scripts/coverage-experiment/fixtures/resource-control.js',import.meta.url))],{encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
assert.deepEqual(JSON.parse(result.stdout),['body','disposed']);
console.log('Compiled Node22 resource disposal runs exactly once after body; uncalled function stays uncalled');
