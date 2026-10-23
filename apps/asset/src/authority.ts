import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AssetIdentifierSchema, OwnerValueSchema } from '@wallpaperdb/events/schemas';
import { z } from 'zod';
import { resolveSourceOperations } from './capabilities/sources/index.js';

const credential = z
  .object({ user: AssetIdentifierSchema, password: z.string().min(1), revision: OwnerValueSchema })
  .strict();
const streamBudget = z
  .object({
    maxBytes: z.number().int().min(65536).max(Number.MAX_SAFE_INTEGER),
    maxMessages: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
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
    requireAuthorizedParty: z.boolean().default(false),
    audience: z.array(OwnerValueSchema),
  })
  .strict()
  .refine(
    (value) => new URL(value.jwksUrl).origin === new URL(value.issuer).origin,
    'Issuer and JWKS must share an origin'
  );
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sourcePolicy = z
  .object({
    maxActiveSources: positive,
    maxCandidates: positive,
    aspectRatioTolerance: z.number().finite().min(0).max(1).default(0.03),
    operations: z.array(z.enum(['add', 'replace-one', 'replace-set'])).min(1),
    admission: z
      .object({
        maxBytes: positive,
        maxPixels: positive,
        maxAxis: positive,
        squareSize: positive.optional(),
        // HDR classes remain disabled until an exact mandatory-inspection adapter is qualified.
        sourceModels: z
          .array(z.enum(['sdr-jpeg', 'sdr-png', 'sdr-webp', 'animated-sdr-webp']))
          .min(1),
      })
      .strict(),
    retention: z.object({ evidenceMs: positive, candidateMs: positive }).strict(),
    temporaryInput: z.object({ maxBytes: positive, abandonedMs: positive }).strict(),
  })
  .strict();
const schema = z
  .object({
    revision: OwnerValueSchema,
    operatorNotification: z
      .object({
        url: z
          .string()
          .url()
          .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
        token: z.string().min(1),
        revision: OwnerValueSchema,
      })
      .strict(),
    broker: z
      .object({
        service: credential,
        operator: credential,
        maxAckPending: z.number().int().min(2).max(10000),
        streams: z
          .object({
            ASSET_COMMANDS: streamBudget,
            ASSET_RESULTS: streamBudget,
            ASSET_QUARANTINE: streamBudget,
            ASSET_OPERATIONS: streamBudget,
          })
          .strict(),
      })
      .strict(),
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
    assetTypes: z.record(AssetIdentifierSchema, sourcePolicy),
    sourceOperations: z
      .object({
        readLifetimeMs: positive.max(3600000).optional(),
        reclamationTimeoutMs: positive.max(30000).optional(),
      })
      .strict()
      .default({})
      .transform(resolveSourceOperations),
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
  const picture = parsed.assetTypes.picture;
  if (
    picture &&
    (picture.maxActiveSources !== 1 ||
      picture.operations.some((operation) => !['add', 'replace-set'].includes(operation)) ||
      picture.admission.squareSize === undefined ||
      picture.admission.sourceModels.some(
        (model) => !['sdr-webp', 'animated-sdr-webp'].includes(model)
      ))
  )
    throw new Error('Picture policy requires one canonical WebP Source and full-set replacement');
  const namespaces = new Set(
    Object.values(parsed.identityProviders).map((entry) => entry.ownerNamespace)
  );
  if (
    new Set(Object.values(parsed.identityProviders).map((entry) => entry.issuer)).size !==
    Object.keys(parsed.identityProviders).length
  )
    throw new Error('Each configured issuer must select one Owner namespace');
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
    operatorNotification: {
      url: parsed.operatorNotification.url,
      revision: parsed.operatorNotification.revision,
    },
    broker: {
      ...parsed.broker,
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
