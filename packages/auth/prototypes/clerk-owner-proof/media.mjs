import { randomUUID } from 'node:crypto';
import { Rejected, body, fields, json, ownerMatches, serve, serviceMatches, verifier } from './runtime.mjs';

const config = JSON.parse(process.env.PROOF_AUTH_CONFIG);
const authenticate = verifier(config);
const assets = new Map(); const commands = new Map();

const { server, url } = await serve(async (request, response) => {
  const path = new URL(request.url, 'http://prototype').pathname;
  if (path === '/internal/assets' && request.method === 'POST') {
    if (!serviceMatches(request, process.env.PROOF_SERVICE_TOKEN)) throw new Rejected(401, 'unauthorized', 'Trusted application authentication is required.');
    const input = await body(request);
    fields(input, ['type', 'ownerReference', 'reference', 'commandId']);
    if (input.type !== 'wallpaper') throw new Rejected(403, 'forbidden', 'This application may create only the configured wallpaper type.');
    if (['ownerReference', 'reference', 'commandId'].some(key => typeof input[key] !== 'string' || !input[key] || input[key].length > 256))
      throw new Rejected(400, 'invalid-request', 'Creation requires bounded non-empty Owner, application reference and command identity.');
    const existing = commands.get(input.commandId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Rejected(409, 'version-conflict', 'A command identity cannot change creation facts.');
      return json(response, 200, existing.confirmation);
    }
    const asset = { id: `ast_${randomUUID()}`, type: input.type,
      owner: { namespace: config.namespace, subject: input.ownerReference },
      reference: input.reference, sources: new Map() };
    assets.set(asset.id, asset);
    const confirmation = { type: asset.type, id: asset.id, reference: asset.reference, ownerReference: asset.owner.subject };
    commands.set(input.commandId, { input, confirmation });
    return json(response, 201, confirmation);
  }

  const route = /^\/assets\/([^/]+)(?:\/sources(?:\/([^/]+))?)?$/.exec(path);
  if (!route) throw new Rejected(404, 'not-found', 'No prototype operation exists here.');
  const principal = await authenticate(request);
  const asset = assets.get(route[1]);
  if (!asset) throw new Rejected(404, 'not-found', 'No such Asset.');
  if (!ownerMatches(principal.owner, asset.owner)) throw new Rejected(403, 'forbidden', 'The authenticated Clerk user is not the Asset owner.');
  if (path === `/assets/${asset.id}` && request.method === 'GET')
    return json(response, 200, { id: asset.id, type: asset.type, owner: asset.owner, reference: asset.reference,
      sources: [...asset.sources.keys()], authenticatedOwner: principal.owner });
  if (path === `/assets/${asset.id}/sources` && request.method === 'POST') {
    const input = await body(request); fields(input, ['content']);
    if (typeof input.content !== 'string' || !input.content) throw new Rejected(400, 'invalid-request', 'Provide sample source content.');
    const id = `src_${randomUUID()}`;
    asset.sources.set(id, Buffer.from(input.content));
    return json(response, 201, { assetId: asset.id, sourceId: id, authenticatedOwner: principal.owner });
  }
  const source = asset.sources.get(route[2]);
  if (!source) throw new Rejected(404, 'not-found', 'No such Source.');
  if (request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    return response.end(source);
  }
  if (request.method === 'DELETE') {
    asset.sources.delete(route[2]);
    return json(response, 200, { withdrawn: route[2], assetId: asset.id });
  }
  throw new Rejected(405, 'invalid-request', 'Operation not supported by this prototype.');
});

process.send?.({ ready: true, role: 'media', url, pid: process.pid, hasClerkSecretKey: Boolean(process.env.CLERK_SECRET_KEY) });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
