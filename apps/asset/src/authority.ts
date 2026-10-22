import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AssetIdentifierSchema, OwnerValueSchema } from '@wallpaperdb/events/schemas';
import { z } from 'zod';

const credential = z
  .object({ user: AssetIdentifierSchema, password: z.string().min(1), revision: OwnerValueSchema })
  .strict();
const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:');
const provider = z
  .object({
    adapter: z.literal('clerk'),
    ownerNamespace: OwnerValueSchema,
    issuer: httpsUrl,
    jwksUrl: httpsUrl,
    tokenProfile: z.literal('session'),
    authorizedParties: z.array(z.string().url()),
    audience: z.array(OwnerValueSchema),
  })
  .strict()
  .refine(
    (value) => new URL(value.jwksUrl).origin === new URL(value.issuer).origin,
    'Issuer and JWKS must share an origin'
  );
const schema = z
  .object({
    revision: OwnerValueSchema,
    broker: z.object({ service: credential, operator: credential }).strict(),
    applications: z.record(
      AssetIdentifierSchema,
      z
        .object({
          ownerNamespace: OwnerValueSchema,
          allowedOperations: z.array(z.enum(['create', 'delete'])).min(1),
          allowedTypes: z.array(AssetIdentifierSchema).min(1),
          credentials: z.array(credential).min(1),
        })
        .strict()
    ),
    identityProviders: z.record(AssetIdentifierSchema, provider),
    // Later Source tickets extend each type's policy. Empty creation has no processing defaults.
    assetTypes: z.record(AssetIdentifierSchema, z.object({}).strict()),
    delivery: z
      .object({
        maxAttempts: z.number().int().min(1).max(100),
        retryDelayMs: z.number().int().min(1).max(30000),
        pollMs: z.number().int().min(1).max(30000),
        shutdownTimeoutMs: z.number().int().min(1).max(30000),
      })
      .strict(),
  })
  .strict();
export type IdentityProvider = z.infer<typeof provider>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function parseAuthority(input: unknown) {
  const parsed = schema.parse(input);
  const namespaces = new Set(
    Object.values(parsed.identityProviders).map((entry) => entry.ownerNamespace)
  );
  const users = new Set<string>();
  const credentials = [
    parsed.broker.service,
    parsed.broker.operator,
    ...Object.values(parsed.applications).flatMap((entry) => entry.credentials),
  ];
  for (const entry of credentials) {
    if (users.has(entry.user) || entry.user === 'legacy')
      throw new Error('Credential users must be unique');
    users.add(entry.user);
  }
  for (const entry of Object.values(parsed.applications)) {
    if (
      !namespaces.has(entry.ownerNamespace) ||
      entry.allowedTypes.some((type) => !Object.hasOwn(parsed.assetTypes, type))
    )
      throw new Error('Application references an unknown type or Owner namespace');
  }
  const applications = Object.fromEntries(
    Object.entries(parsed.applications).map(([id, entry]) => [
      id,
      {
        ...entry,
        id,
        createSubject: `asset.commands.${id}.create`,
        deleteSubject: `asset.commands.${id}.delete`,
        resultSubject: `asset.results.${id}`,
        resultConsumer: `results_${id}`,
        inboxPrefix: `_ASSET_INBOX.${id}`,
        account: `ASSET_${id}`,
        serviceUser: `${parsed.broker.service.user}_${id}`,
        operatorUser: `${parsed.broker.operator.user}_${id}`,
      },
    ])
  );
  for (const application of Object.values(applications)) {
    for (const user of [application.serviceUser, application.operatorUser]) {
      if (users.has(user)) throw new Error('Derived broker users must be unique');
      users.add(user);
    }
  }
  const effective = {
    ...parsed,
    broker: {
      service: { user: parsed.broker.service.user, revision: parsed.broker.service.revision },
      operator: { user: parsed.broker.operator.user, revision: parsed.broker.operator.revision },
    },
    applications: Object.fromEntries(
      Object.entries(applications).map(([id, entry]) => [
        id,
        {
          ...entry,
          credentials: entry.credentials.map(({ user, revision }) => ({ user, revision })),
        },
      ])
    ),
  };
  return {
    ...parsed,
    applications,
    identity: createHash('sha256').update(canonical(effective)).digest('hex'),
  };
}
export type Authority = ReturnType<typeof parseAuthority>;
export function readAuthority(path: string): Authority {
  return parseAuthority(JSON.parse(readFileSync(path, 'utf8')));
}
