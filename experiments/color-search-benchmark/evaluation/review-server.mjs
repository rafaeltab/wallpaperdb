// Local human-annotation UI. No search, extraction, scoring or OpenSearch access.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, mkdir, open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BODY = 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUSES = new Set(['ranked', 'none-match', 'unsure', 'skipped', 'notes-only']);
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateSubmission(value, batch) {
  if (!object(value) || Object.keys(value).some(key => !['batchId', 'batchVersion', 'submissionId', 'answers'].includes(key))) throw fail(400, 'Invalid submission fields.');
  if (value.batchId !== batch.id || value.batchVersion !== batch.version) throw fail(409, 'The review batch changed. Export your draft before reloading.');
  if (typeof value.submissionId !== 'string' || !UUID.test(value.submissionId)) throw fail(400, 'Invalid submission ID.');
  if (!Array.isArray(value.answers) || !value.answers.length || value.answers.length > batch.cases.length) throw fail(400, 'Include at least one answer or note.');
  const cases = new Map(batch.cases.map(item => [item.id, item]));
  const seenCases = new Set();
  for (const answer of value.answers) {
    if (!object(answer) || Object.keys(answer).some(key => !['caseId', 'status', 'ranking', 'notes', 'updatedAt'].includes(key))) throw fail(400, 'Invalid answer fields.');
    const item = cases.get(answer.caseId);
    if (!item || seenCases.has(answer.caseId)) throw fail(400, 'Unknown or repeated comparison.');
    seenCases.add(answer.caseId);
    if (!STATUSES.has(answer.status) || !Array.isArray(answer.ranking)) throw fail(400, 'Invalid answer status or ranking.');
    if (typeof answer.notes !== 'string' || answer.notes.length > 6000) throw fail(400, 'Keep each note within 6,000 characters.');
    if (typeof answer.updatedAt !== 'string' || answer.updatedAt.length > 40 || !Number.isFinite(Date.parse(answer.updatedAt))) throw fail(400, 'Invalid answer timestamp.');
    if (answer.status === 'ranked' && !answer.ranking.length) throw fail(400, 'Choose at least one image to rank.');
    if (['skipped', 'notes-only'].includes(answer.status) && answer.ranking.length) throw fail(400, 'Skipped or notes-only comparisons cannot contain a ranking.');
    if (answer.status === 'notes-only' && !answer.notes.trim()) throw fail(400, 'Notes-only comparisons need a note.');
    const labels = new Set(item.examples.map(example => example.label));
    const seenLabels = new Set();
    for (const tier of answer.ranking) {
      if (!Array.isArray(tier) || !tier.length) throw fail(400, 'Each rank needs at least one image.');
      for (const label of tier) {
        if (typeof label !== 'string' || !labels.has(label) || seenLabels.has(label)) throw fail(400, 'Unknown or repeated image label.');
        seenLabels.add(label);
      }
    }
  }
  return value;
}

function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Use application/json.');
  return new Promise((accept, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!tooLarge) { tooLarge = true; chunks.length = 0; reject(fail(413, 'Submission is too large.')); }
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(fail(400, 'Invalid JSON.')); }
    });
    request.on('error', reject);
  });
}

async function persist(submission, batch, storageDir) {
  const directory = join(storageDir, batch.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const fingerprint = hash(JSON.stringify(submission));
  const envelope = { schemaVersion: 1, savedAt: new Date().toISOString(), fingerprint, batchSha256: hash(JSON.stringify(batch)), submission, batchSnapshot: batch };
  const destination = join(directory, `${submission.submissionId}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(envelope, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    try { await link(temporary, destination); created = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(destination, 'utf8'));
      if (previous.fingerprint !== fingerprint || previous.batchSha256 !== envelope.batchSha256) throw fail(409, 'That submission ID already contains different answers. Submit with a new ID.');
      envelope.savedAt = previous.savedAt;
    }
    // Persist the new directory entry before acknowledging success.
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { created, id: submission.submissionId, savedAt: envelope.savedAt, answeredCases: submission.answers.filter(answer => !['notes-only', 'skipped'].includes(answer.status)).length };
}

function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

export function createReviewServer({ batch, storageDir, staticRoot = ROOT }) {
  if (!/^[a-z0-9-]+$/.test(batch.id)) throw new Error('Unsafe batch ID.');
  const allowed = new Set(['evaluation/batch-review.html', 'evaluation/batch-review.css', 'evaluation/batch-review.mjs', ...batch.cases.flatMap(item => item.examples.map(example => example.filename))]);
  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/submissions') {
        if (request.method !== 'POST') throw fail(405, 'Submit using POST.');
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) throw fail(403, 'Cross-origin submissions are disabled.');
        const input = validateSubmission(await readBody(request), batch);
        const { created, ...receipt } = await persist(input, batch, storageDir);
        json(response, created ? 201 : 200, receipt);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw fail(405, 'Use GET for review files.');
      if (url.pathname === '/api/batch') { json(response, 200, batch); return; }
      let path;
      try { path = decodeURIComponent(url.pathname === '/' ? '/evaluation/batch-review.html' : url.pathname).slice(1); }
      catch { throw fail(400, 'Invalid URL.'); }
      if (!allowed.has(path)) throw fail(404, 'Not found.');
      const absolute = await realpath(resolve(staticRoot, path));
      const root = await realpath(staticRoot);
      if (!absolute.startsWith(root + sep) || !MIME[extname(absolute)]) throw fail(404, 'Not found.');
      const info = await stat(absolute);
      if (!info.isFile()) throw fail(404, 'Not found.');
      response.writeHead(200, { 'content-type': MIME[extname(absolute)], 'content-length': info.size, 'cache-control': path.startsWith('corpus/') ? 'public, max-age=3600' : 'no-store' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(absolute).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      if (!response.headersSent) json(response, status, { error: status === 500 ? 'Could not save or load the review. Your browser draft is still available; retry or export it.' : error.message });
      else response.destroy();
      if (status >= 500) console.error(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const batch = JSON.parse(await readFile(new URL('./batch-001.json', import.meta.url), 'utf8'));
  const port = Number(process.env.COLOR_REVIEW_PORT || 8222);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid COLOR_REVIEW_PORT.');
  const storageDir = process.env.COLOR_REVIEW_STORAGE || join(homedir(), '.local/share/wallpaperdb/color-evaluation/reviews');
  createReviewServer({ batch, storageDir }).listen(port, '0.0.0.0', () => console.log(`Color review: http://zerotwo:${port}/ (${batch.cases.length} comparisons); answers: ${storageDir}`));
}
