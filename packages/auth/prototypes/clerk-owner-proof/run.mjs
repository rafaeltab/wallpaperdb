import { randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createClerkClient, request as call, serve, json, body, Rejected } from './runtime.mjs';

const once = process.argv.includes('--once');
const repository = process.env.CONFIG_REPO || resolve(import.meta.dirname, '../../../..');
const environment = parseEnv(await readFile(resolve(repository, 'apps/user/.env'), 'utf8'));
const secretKey = environment.CLERK_SECRET_KEY; const publishableKey = environment.CLERK_PUBLISHABLE_KEY;
if (!secretKey?.startsWith('sk_test_') || !publishableKey?.startsWith('pk_test_')) throw new Error('This prototype requires Clerk development credentials.');
const issuer = `https://${Buffer.from(publishableKey.slice('pk_test_'.length), 'base64').toString().replace(/\$$/, '')}`;
const jwksResponse = await fetch(`${issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10000) });
if (!jwksResponse.ok) throw new Error(`Configured public JWKS unavailable: HTTP ${jwksResponse.status}`);
const jwks = await jwksResponse.json();
const authConfig = { issuer, namespace: 'wallpaperdb-development', jwks };
const clerk = createClerkClient({ secretKey, publishableKey });
const serviceToken = randomBytes(32).toString('hex');
const users = []; const workers = []; const sessions = new Map();
const report = { startedAt: new Date().toISOString(), sdk: '@clerk/backend 3.4.1 via @clerk/fastify 3.1.19', issuer,
  namespace: authConfig.namespace, realClerkAccounts: [], processes: [], checks: [], cleanup: [],
  limits: ['Real Clerk development accounts and Clerk-issued session JWTs; no locally signed or mocked user credentials.',
    'Sessions are created through Clerk development testing APIs, not a browser password sign-in.',
    'The actual session JWTs omit audience and authorized-party claims; their absence is reported, not replaced with invented claims.',
    'Only the configured issuer and its public keys are exercised. Cross-provider collisions, production frontend origins, live revocation and rotation recovery remain unproved.',
    'In-memory Assets and sample byte strings only. No image processing, durable command transport, database, production service, or public rendition delivery.'] };
let uiServer; let shuttingDown = false; let currentAsset; let currentSource; let currentOwner;
const sourceContent = 'Immutable proof source bytes for issue 391.';
const outcomes = [];

async function clerkCall(name, action) {
  try { return await action(); }
  catch (error) {
    const codes = Array.isArray(error.errors) ? error.errors.map(item => item.code).filter(code => /^[a-z_]+$/.test(code)).join(', ') : '';
    throw new Error(`${name} failed${error.status ? ` (HTTP ${error.status})` : ''}${codes ? `: ${codes}` : ''}. No external response or credentials logged.`);
  }
}

async function start(file, additions) {
  // Deliberately do not inherit repository secrets into either application server.
  const child = fork(new URL(file, import.meta.url), [], {
    env: { PATH: process.env.PATH, NODE_ENV: 'development', PROOF_AUTH_CONFIG: JSON.stringify(authConfig), ...additions },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  workers.push(child);
  const ready = await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${file} startup timed out.`)), 10000);
    child.once('message', message => { clearTimeout(timeout); resolveReady(message); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`${file} exited (${code}) before readiness.`)); });
  });
  report.processes.push(ready); return ready;
}

async function tokenFor(persona) {
  const session = sessions.get(persona);
  const result = await clerkCall('Clerk session token issuance', () => clerk.sessions.getToken(session.id));
  return result.jwt;
}

async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  if (uiServer) await new Promise(resolveClose => uiServer.close(resolveClose));
  for (const child of workers) {
    if (child.exitCode === null) {
      await new Promise(resolveExit => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); }); child.kill('SIGTERM');
      });
    }
  }
  for (const user of [...users].reverse()) {
    try {
      await clerkCall('Disposable Clerk account deletion', () => clerk.users.deleteUser(user.id));
      report.cleanup.push({ userId: user.id, deleted: true });
    } catch { report.cleanup.push({ userId: user.id, deleted: false }); process.exitCode = 1; }
  }
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(import.meta.dirname, 'proof-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cleanup: report.cleanup, report: resolve(import.meta.dirname, 'proof-result.json') }));
}

try {
  for (const persona of ['owner', 'other']) {
    const marker = `wdb391-${persona}-${randomUUID()}`;
    const user = await clerkCall('Disposable Clerk account creation', () => clerk.users.createUser({
      externalId: marker, emailAddress: [`${marker}+clerk_test@example.com`], password: `${randomBytes(32).toString('base64url')}!aA1`,
    }));
    users.push(user);
    const session = await clerkCall('Clerk development session creation', () => clerk.sessions.createSession({ userId: user.id }));
    sessions.set(persona, session);
    const token = await tokenFor(persona);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    report.realClerkAccounts.push({ persona, userId: user.id, sessionId: session.id,
      sessionStatus: session.status, tokenFacts: { issuer: claims.iss, subject: claims.sub,
        sessionId: claims.sid, audience: claims.aud ?? null, authorizedParty: claims.azp ?? null,
        issuedAt: claims.iat, expiresAt: claims.exp } });
  }
  const media = await start('media.mjs', { PROOF_SERVICE_TOKEN: serviceToken });
  const application = await start('application.mjs', { PROOF_SERVICE_TOKEN: serviceToken, PROOF_MEDIA_URL: media.url });
  const ownerToken = await tokenFor('owner'); const otherToken = await tokenFor('other');
  const check = async (name, expectedStatus, url, options, validate) => {
    const result = await call(url, options);
    const passed = result.status === expectedStatus && (!validate || validate(result.body));
    const row = { name, expectedStatus, status: result.status, passed };
    report.checks.push(row); outcomes.push(row); console.log(JSON.stringify(row));
    if (!passed) throw new Error(`Real HTTP proof failed: ${name}, HTTP ${result.status}.`);
    return result.body;
  };
  const created = await check('Authenticated application creates Asset for real Clerk owner', 201, `${application.url}/wallpapers`,
    { token: ownerToken, method: 'POST', value: { reference: 'wlpr_391_real_clerk_proof' } },
    value => value.ownerReference === users[0].id && value.reference === 'wlpr_391_real_clerk_proof');
  currentAsset = created.id; currentOwner = created.ownerReference; report.asset = created;
  const assetUrl = `${media.url}/assets/${currentAsset}`;
  await check('Owner reads Asset', 200, assetUrl, { token: ownerToken }, value => value.owner.subject === users[0].id);
  await check('Other real Clerk user cannot read Asset', 403, assetUrl, { token: otherToken });
  await check('Anonymous caller cannot read Asset', 401, assetUrl);
  await check('Application credential cannot authenticate as a user', 401, assetUrl, { token: serviceToken });
  const source = await check('Owner adds immutable Source', 201, `${assetUrl}/sources`,
    { token: ownerToken, method: 'POST', value: { content: sourceContent } });
  currentSource = source.sourceId;
  await check('Owner reads exact Source bytes', 200, `${assetUrl}/sources/${currentSource}`, { token: ownerToken }, value => value === sourceContent);
  await check('Other user cannot read Source bytes', 403, `${assetUrl}/sources/${currentSource}`, { token: otherToken });
  await check('Other user cannot add a Source', 403, `${assetUrl}/sources`, { token: otherToken, method: 'POST', value: { content: 'unauthorized bytes' } });
  await check('Other user cannot withdraw a Source', 403, `${assetUrl}/sources/${currentSource}`, { token: otherToken, method: 'DELETE' });
  await check('Other user cannot spoof Owner with request fields', 403, `${assetUrl}/sources`,
    { token: otherToken, method: 'POST', value: { content: 'spoof attempt', ownerReference: users[0].id } });
  await check('Owner also cannot override ownership fields', 400, `${assetUrl}/sources`,
    { token: ownerToken, method: 'POST', value: { content: sourceContent, ownerReference: users[1].id } });
  const segments = otherToken.split('.');
  const payload = JSON.parse(Buffer.from(segments[1], 'base64url')); payload.sub = users[0].id;
  segments[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  await check('Changing JWT subject without Clerk signature fails', 401, assetUrl, { token: segments.join('.') });
  await check('Owner JWT cannot exercise service creation authority', 401, `${media.url}/internal/assets`,
    { token: ownerToken, method: 'POST', value: { type: 'wallpaper', ownerReference: users[0].id, reference: 'bad', commandId: randomUUID() } });
  await check('Application cannot accept client-supplied ownership', 400, `${application.url}/wallpapers`,
    { token: otherToken, method: 'POST', value: { ownerReference: users[0].id } });
  await check('Rejected operations leave original Source bytes unchanged', 200, `${assetUrl}/sources/${currentSource}`, { token: ownerToken }, value => value === sourceContent);
  await check('Rejected operations leave source membership unchanged', 200, assetUrl, { token: ownerToken },
    value => value.sources.length === 1 && value.sources[0] === currentSource && value.owner.subject === users[0].id);
  await check('Owner withdraws the Source', 200, `${assetUrl}/sources/${currentSource}`, { token: ownerToken, method: 'DELETE' });
  currentSource = null;
  await check('Stable empty Asset remains owned by same user', 200, assetUrl, { token: ownerToken }, value => value.sources.length === 0 && value.id === currentAsset && value.owner.subject === users[0].id);
  await check('Other user remains forbidden after last withdrawal', 403, assetUrl, { token: otherToken });
  report.passed = report.checks.every(row => row.passed) && report.processes.every(row => row.hasClerkSecretKey === false);
  if (!report.passed) throw new Error('A service received a Clerk administrative secret.');
  if (once) { await shutdown(); }
  else {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const ui = await serve(async (request, response) => {
      const path = new URL(request.url, 'http://prototype').pathname;
      if (path === '/' && request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return response.end(html); }
      if (path === '/state' && request.method === 'GET') return json(response, 200, { ...report, outcomes, currentAsset, currentSource,
        currentOwner: { namespace: authConfig.namespace, subject: currentOwner }, mediaUrl: media.url, applicationUrl: application.url });
      if (path !== '/act' || request.method !== 'POST') throw new Rejected(404, 'not-found', 'Unknown prototype action.');
      if (request.headers.origin !== `http://${request.headers.host}` || !request.headers['content-type']?.includes('application/json'))
        throw new Rejected(403, 'forbidden', 'Use this local proof page.');
      const input = await body(request);
      if (!['owner', 'other', 'anonymous'].includes(input.actor)) throw new Rejected(400, 'invalid-request', 'Choose an available proof account.');
      const token = input.actor === 'anonymous' ? undefined : await tokenFor(input.actor);
      const target = `${media.url}/assets/${currentAsset}`; let result;
      if (input.action === 'create') {
        result = await call(`${application.url}/wallpapers`, { token, method: 'POST', value: {} });
        if (result.status === 201) { currentAsset = result.body.id; currentOwner = result.body.ownerReference; currentSource = null; }
      } else if (input.action === 'inspect') result = await call(target, { token });
      else if (input.action === 'add') {
        result = await call(`${target}/sources`, { token, method: 'POST', value: { content: sourceContent } });
        if (result.status === 201) currentSource = result.body.sourceId;
      } else if (input.action === 'read' || input.action === 'withdraw') {
        result = await call(`${target}/sources/${currentSource || 'no_source'}`, { token, method: input.action === 'read' ? 'GET' : 'DELETE' });
        if (result.status === 200 && input.action === 'withdraw') currentSource = null;
      } else throw new Rejected(400, 'invalid-request', 'Choose an available operation.');
      outcomes.push({ name: `${input.actor} / ${input.action}`, status: result.status, body: result.body });
      return json(response, 200, result);
    });
    uiServer = ui.server;
    console.log(JSON.stringify({ demoUrl: ui.url, mediaUrl: media.url, applicationUrl: application.url, checksPassed: report.checks.length,
      accounts: report.realClerkAccounts.map(({ persona, userId }) => ({ persona, userId })), autoCleanupMinutes: 30 }));
    process.on('SIGINT', () => void shutdown().then(() => process.exit(process.exitCode || 0)));
    process.on('SIGTERM', () => void shutdown().then(() => process.exit(process.exitCode || 0)));
    setTimeout(() => void shutdown().then(() => process.exit(process.exitCode || 0)), 30 * 60 * 1000).unref();
  }
} catch (error) {
  report.passed = false; report.failure = error.message; console.error(error.message);
  process.exitCode = 1; await shutdown();
}
