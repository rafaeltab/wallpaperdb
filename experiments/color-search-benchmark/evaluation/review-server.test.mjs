import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReviewServer, validateSubmission } from './review-server.mjs';

const batch = { id: 'test-batch', version: 1, cases: [{ id: 'one', query: { text: 'Red' }, examples: ['A', 'B', 'C', 'D'].map(label => ({ label, wallpaperId: `image-${label}`, filename: `corpus/${label}.jpg`, sha256: 'a'.repeat(64) })) }] };
const submission = () => ({ batchId: batch.id, batchVersion: 1, submissionId: randomUUID(), answers: [{ caseId: 'one', status: 'ranked', ranking: [['B'], ['A', 'D']], notes: 'C left unjudged.', updatedAt: '2026-09-18T12:00:00.000Z' }] });

test('preserves ties, partial rankings, raw notes and explicit mismatch independently', () => {
  const input = submission();
  input.answers[0].status = 'none-match';
  assert.deepEqual(validateSubmission(input, batch), input);
  input.answers[0] = { ...input.answers[0], status: 'notes-only', ranking: [], notes: 'Interesting but not ranked.' };
  assert.deepEqual(validateSubmission(input, batch), input);
});

test('rejects stale batches, unknown or repeated labels, duplicate cases and unsafe IDs', () => {
  for (const change of [
    x => { x.batchVersion = 2; },
    x => { x.answers[0].ranking = [['E']]; },
    x => { x.answers[0].ranking = [['A'], ['A']]; },
    x => { x.answers.push(x.answers[0]); },
    x => { x.submissionId = '../../escape'; },
    x => { x.answers[0].status = 'skipped'; },
    x => { x.answers[0].caseId = 'not-present'; },
    x => { x.answers[0].notes = 'x'.repeat(6001); },
  ]) {
    const input = submission(); change(input);
    assert.throws(() => validateSubmission(input, batch));
  }
});

async function running(t) {
  const dir = await mkdtemp(join(tmpdir(), 'color-review-test-'));
  const server = createReviewServer({ batch, storageDir: join(dir, 'answers'), staticRoot: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const post = (input, origin = url) => fetch(`${url}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input) });
  return { dir, url, post };
}

test('durably saves a recoverable batch snapshot, retries idempotently, never overwrites different answers', async t => {
  const { dir, post } = await running(t);
  const input = submission();
  const responses = await Promise.all([post(input), post(input)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  const receipt = await responses[0].json();
  const files = await readdir(join(dir, 'answers', batch.id));
  assert.deepEqual(files, [`${input.submissionId}.json`]);
  const saved = JSON.parse(await readFile(join(dir, 'answers', batch.id, files[0]), 'utf8'));
  assert.deepEqual(saved.submission, input);
  assert.deepEqual(saved.batchSnapshot, batch);
  assert.equal(receipt.id, input.submissionId);
  input.answers[0].notes = 'Changed answer';
  assert.equal((await post(input)).status, 409);
  assert.notEqual(JSON.parse(await readFile(join(dir, 'answers', batch.id, files[0]), 'utf8')).submission.answers[0].notes, input.answers[0].notes);
});

test('blocks cross-origin writes, oversized requests and unknown static files', async t => {
  const { dir, url, post } = await running(t);
  await writeFile(join(dir, 'secret.json'), '{"private":true}');
  assert.equal((await post(submission(), 'https://other.example')).status, 403);
  assert.equal((await fetch(`${url}/secret.json`)).status, 404);
  assert.equal((await fetch(`${url}/../secret.json`)).status, 404);
  assert.equal((await fetch(`${url}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.deepEqual(await (await fetch(`${url}/api/batch`)).json(), batch);
});
