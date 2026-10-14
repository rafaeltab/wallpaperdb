import { createPublicKey, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const require = createRequire(new URL('../../package.json', import.meta.url));
export const { createClerkClient, verifyToken } = require('@clerk/fastify');

export class Rejected extends Error {
  constructor(status, type, detail) { super(detail); this.status = status; this.type = type; }
}

export function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export async function body(request) {
  let bytes = 0; const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Rejected(413, 'body-limit', 'Prototype request exceeds 16 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new Rejected(400, 'invalid-request', 'Expected a JSON object.'); }
}

export function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Rejected(400, 'invalid-request', 'Unexpected fields. Author requests cannot assign ownership.');
}

export function serviceMatches(request, secret) {
  const presented = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function ownerMatches(left, right) {
  return left.namespace === right.namespace && left.subject === right.subject;
}

export function verifier(config) {
  // Keys and issuer are deployment inputs. The author cannot select a key source.
  const publicKeys = new Map(config.jwks.keys.map(key => [key.kid,
    createPublicKey({ key, format: 'jwk' }).export({ type: 'spki', format: 'pem' })]));
  return async request => {
    const match = /^Bearer ([^ ]+)$/.exec(request.headers.authorization || '');
    if (!match) throw new Rejected(401, 'unauthorized', 'A Clerk session token is required.');
    try {
      const header = JSON.parse(Buffer.from(match[1].split('.')[0], 'base64url'));
      const jwtKey = publicKeys.get(header.kid);
      if (!jwtKey || header.alg !== 'RS256') throw new Error('Untrusted key or algorithm');
      const claims = await verifyToken(match[1], { jwtKey, clockSkewInMs: 0 });
      if (claims.iss !== config.issuer || typeof claims.sub !== 'string' || !claims.sub.startsWith('user_') ||
          typeof claims.sid !== 'string' || !claims.sid.startsWith('sess_')) throw new Error('Wrong token profile');
      // Development-session JWTs may omit aud and azp. Do not invent those claims.
      // An interactive frontend token/origin profile is separate qualification work.
      return { owner: { namespace: config.namespace, subject: claims.sub }, sessionId: claims.sid };
    } catch {
      throw new Rejected(401, 'unauthorized', 'Clerk signature, validity or configured issuer verification failed.');
    }
  };
}

export async function serve(handler, port = 0) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(error => {
      const status = error instanceof Rejected ? error.status : 500;
      response.writeHead(status, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({
        type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${error instanceof Rejected ? error.type : 'generic-server'}.md`,
        status, title: status >= 500 ? 'Prototype request failed' : 'Request rejected',
        detail: error instanceof Rejected ? error.message : 'No internal diagnostics are exposed.',
      }));
    });
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export async function request(url, { token, method = 'GET', value, headers = {} } = {}) {
  const response = await fetch(url, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
  }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000) });
  const content = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(content) : content };
}
