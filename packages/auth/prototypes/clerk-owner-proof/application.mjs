import { randomUUID } from 'node:crypto';
import { Rejected, body, fields, json, request as call, serve, verifier } from './runtime.mjs';

const authenticate = verifier(JSON.parse(process.env.PROOF_AUTH_CONFIG));
const { server, url } = await serve(async (request, response) => {
  if (request.url !== '/wallpapers' || request.method !== 'POST') throw new Rejected(404, 'not-found', 'No such application operation.');
  const principal = await authenticate(request);
  const input = await body(request); fields(input, ['reference']);
  if (input.reference !== undefined && (typeof input.reference !== 'string' || !input.reference || input.reference.length > 256))
    throw new Rejected(400, 'invalid-request', 'Invalid application reference.');
  const command = { type: 'wallpaper', ownerReference: principal.owner.subject,
    reference: input.reference || `wlpr_${randomUUID()}`, commandId: randomUUID() };
  const result = await call(`${process.env.PROOF_MEDIA_URL}/internal/assets`, {
    token: process.env.PROOF_SERVICE_TOKEN, method: 'POST', value: command,
  });
  return json(response, result.status, result.body);
});

process.send?.({ ready: true, role: 'application', url, pid: process.pid, hasClerkSecretKey: Boolean(process.env.CLERK_SECRET_KEY) });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
