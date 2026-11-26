import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifySourceIdentity} from './delivery.mjs';

const directory = await mkdtemp(join(tmpdir(), 'coverage-source-'));
try {
 const path = join(directory, 'original.ts');
 const compiledSource = 'export const value = 1;\n';
 const capturedHash = createHash('sha256').update(compiledSource).digest('hex');
 const snapshot = {[path]: capturedHash};
 await writeFile(path, compiledSource);
 assert.equal(await verifySourceIdentity(path, snapshot), capturedHash);
 await writeFile(path, 'export const value = 2;\n');
 await assert.rejects(verifySourceIdentity(path, snapshot), /source changed since compilation/);
 await writeFile(path, compiledSource);
 assert.equal(await verifySourceIdentity(path, snapshot), capturedHash, 'unchanged source stays supported');
 await assert.rejects(verifySourceIdentity(path, {}), /Missing compiled source identity/);
 console.log('Report source identity is bound to compiled bytes; edits and missing provenance fail');
} finally {
 await rm(directory, {recursive: true, force: true});
}
