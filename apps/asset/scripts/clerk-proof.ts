import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { connect } from 'nats';
import { z } from 'zod';
import { AssetCommandResultSchema, OwnerValueSchema } from '@wallpaperdb/events/schemas';
import { readAuthority } from '../src/authority.js';
import { runOperator } from './operator.js';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    'broker-url': { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values['base-url'] || !values['broker-url'] || !values.output)
  throw new Error('The proof requires base-url, broker-url and output');
const base = values['base-url'].replace(/\/$/, '');
const brokerUrl = values['broker-url'];
const environment = parse(await readFile(resolve('../user/.env'), 'utf8'));
const secretKey = environment.CLERK_SECRET_KEY;
if (!secretKey?.startsWith('sk_test_'))
  throw new Error('Only Clerk development credentials may run this proof');
const authority = readAuthority(process.env.ASSET_AUTHORITY_FILE ?? './.authority.json');
if (
  !['asset-operator-inbox', 'localhost', '127.0.0.1'].includes(
    new URL(authority.operatorNotification.url).hostname
  )
)
  throw new Error('The proof requires a local operator destination');
const users: Array<{ id: string; persona: string }> = [];
const sessions: string[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  limitations: [
    'Development session JWTs and public issuer keys only. This does not qualify production key rotation, live revocation or browser password sign-in.',
    'Audience and authorized-party evidence is limited to the actual selected session claims recorded below. Adapter contracts separately verify configured claim requirements.',
  ],
};
async function clerk(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Clerk development fixture failed with HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}
const idSchema = z.object({ id: z.string().min(1) });
async function tokenFor(index: number) {
  const session = sessions[index];
  if (!session) throw new Error('Session unavailable');
  return z
    .object({ jwt: z.string().min(1) })
    .parse(await clerk('POST', `/sessions/${session}/tokens`, {})).jwt;
}
try {
  for (const persona of ['owner', 'other']) {
    const marker = `wdb466-${persona}-${randomUUID()}`;
    const user = idSchema.parse(
      await clerk('POST', '/users', {
        external_id: marker,
        email_address: [`${marker}+clerk_test@example.com`],
        password: `${randomBytes(32).toString('base64url')}!aA1`,
      })
    );
    users.push({ id: user.id, persona });
    sessions.push(idSchema.parse(await clerk('POST', '/sessions', { user_id: user.id })).id);
  }
  const owner = users[0];
  if (!owner) throw new Error('Owner unavailable');
  const ownerToken = await tokenFor(0);
  const otherToken = await tokenFor(1);
  const claims = z
    .object({
      iss: z.string(),
      sub: OwnerValueSchema,
      aud: z.unknown().optional(),
      azp: z.unknown().optional(),
    })
    .parse(JSON.parse(Buffer.from(ownerToken.split('.')[1] ?? '', 'base64url').toString()));
  report.tokenProfile = {
    issuer: claims.iss,
    subjectBytes: Buffer.byteLength(claims.sub),
    audiencePresent: claims.aud !== undefined,
    authorizedPartyPresent: claims.azp !== undefined,
  };
  const command = [
    'create',
    '--url',
    brokerUrl,
    '--application',
    'user',
    '--command-id',
    `proof-${randomUUID()}`,
    '--owner-subject',
    owner.id,
    '--asset-type',
    'picture',
    '--reference',
    'synthetic-466-proof',
  ];
  const result = AssetCommandResultSchema.parse(await runOperator(command));
  if (result.outcome !== 'created') throw new Error('Durable creation failed');
  if (AssetCommandResultSchema.parse(await runOperator(command)).assetId !== result.assetId)
    throw new Error('Replay changed the assigned identity');
  const inspection = `${base}/assets/${encodeURIComponent(result.assetId)}/sources`;
  const request = (url: string, authorization?: string) =>
    fetch(url, {
      headers: authorization ? { authorization } : {},
      signal: AbortSignal.timeout(10000),
    });
  const ownerResponse = await request(inspection, `Bearer ${ownerToken}`);
  const otherResponse = await request(inspection, `Bearer ${otherToken}`);
  const anonymousResponse = await request(inspection);
  report.inspectionStatuses = {
    owner: ownerResponse.status,
    other: otherResponse.status,
    anonymous: anonymousResponse.status,
  };
  if (
    ownerResponse.status !== 200 ||
    otherResponse.status !== 404 ||
    anonymousResponse.status !== 401
  )
    throw new Error('Real Clerk Owner inspection qualification failed');
  report.checks = {
    durableCreate: result.outcome,
    replayAssetIdentityStable: true,
    ownerInspection: ownerResponse.status,
    differentSubject: otherResponse.status,
    unauthenticated: anonymousResponse.status,
    emptyAsset: await ownerResponse.json(),
  };
  await otherResponse.body?.cancel();
  await anonymousResponse.body?.cancel();
  const application = authority.applications.user;
  if (!application) throw new Error('Configured User application missing');
  const notificationId = createHash('sha256').update(randomUUID()).digest('hex');
  const service = await connect({
    servers: brokerUrl,
    user: application.serviceUser,
    pass: authority.broker.service.password,
    inboxPrefix: '_ASSET_INBOX.service',
    timeout: 5000,
  });
  try {
    await service.jetstream().publish(
      'asset.operator.notifications',
      JSON.stringify({
        id: notificationId,
        kind: 'result-quarantine',
        subject: application.resultSubject,
        reason: 'exhausted',
      }),
      { timeout: 5000 }
    );
  } finally {
    await service.close();
  }
  report.syntheticNotificationId = notificationId;
} finally {
  const cleanup: unknown[] = [];
  for (const user of users.reverse()) {
    try {
      await clerk('DELETE', `/users/${user.id}`);
      cleanup.push({ persona: user.persona, deleted: true });
    } catch {
      cleanup.push({ persona: user.persona, deleted: false });
      process.exitCode = 1;
    }
  }
  report.cleanup = cleanup;
  report.completedAt = new Date().toISOString();
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Clerk development proof report written to ${values.output}\n`);
}
