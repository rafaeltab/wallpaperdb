import { Effect } from 'effect';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  Profiles,
  type ProfilePrincipal,
  type ProfileOutcome,
  type RejectionReason,
} from '../profile/index.js';
import type { Execution } from './execution.js';
import { problem } from './problem.js';
const titles: Record<RejectionReason, string> = {
  unauthorized: 'Unauthorized',
  'invalid-display-name': 'Invalid Display name',
  'invalid-biography': 'Invalid Biography',
  'unavailable-biography-wallpaper': 'Wallpaper unavailable',
  'invalid-handle': 'Invalid Handle',
  'invalid-alias-command': 'Invalid alias command',
  'ineligible-handle': 'Handle is not eligible',
  'alias-limit': 'Retained alias limit reached',
  'alias-not-found': 'Alias not found',
  'alias-not-scheduled': 'Alias not scheduled',
  'handle-unavailable': 'Handle unavailable',
  'handle-cooldown': 'Handle change cooldown',
  'version-conflict': 'Profile version conflict',
  'picture-unavailable': 'Picture unavailable',
};
const rejectionStatus: Record<RejectionReason, number> = {
  unauthorized: 401,
  'invalid-display-name': 400,
  'invalid-biography': 400,
  'unavailable-biography-wallpaper': 400,
  'invalid-handle': 400,
  'invalid-alias-command': 400,
  'ineligible-handle': 400,
  'alias-limit': 409,
  'alias-not-found': 404,
  'alias-not-scheduled': 409,
  'handle-unavailable': 409,
  'handle-cooldown': 429,
  'version-conflict': 409,
  'picture-unavailable': 400,
};
export function sendProfile(reply: FastifyReply, outcome: ProfileOutcome) {
  if (outcome._tag === 'Success') return reply.send(outcome.profile);
  const status = rejectionStatus[outcome.reason];
  return reply
    .code(status)
    .type('application/problem+json')
    .send({
      ...problem(
        status,
        outcome.reason === 'version-conflict'
          ? 'profile-version-conflict'
          : outcome.reason === 'unavailable-biography-wallpaper'
            ? 'unavailable-wallpaper'
            : outcome.reason,
        titles[outcome.reason],
        outcome.message
      ),
      instance: reply.request.url,
      ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
      ...(outcome.nextHandleChangeAt
        ? { nextHandleChangeAt: outcome.nextHandleChangeAt.toISOString() }
        : {}),
    });
}
export function profileCommand(
  execution: Execution,
  operation: (
    profiles: Profiles,
    principal: ProfilePrincipal,
    request: FastifyRequest
  ) => Effect.Effect<ProfileOutcome, import('../profile/index.js').ProfileUnavailable>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = request.profilePrincipal;
    if (!principal)
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'unauthorized', 'Unauthorized'));
    return execution.run(
      Profiles.use((profiles) => operation(profiles, principal, request)).pipe(
        Effect.match({
          onSuccess: (result) => sendProfile(reply, result),
          onFailure: (failure) => {
            const identity = failure.operation === 'identity-lookup';
            const status = identity ? 503 : 500;
            return reply
              .code(status)
              .type('application/problem+json')
              .send({
                ...problem(
                  status,
                  identity ? 'identity-unavailable' : 'generic-server',
                  identity ? 'Identity service unavailable' : 'Internal server error',
                  identity ? 'Clerk identity lookup failed' : undefined
                ),
                instance: request.url,
              });
          },
        })
      ),
      request,
      reply
    );
  };
}

const version = z.number().int().positive().safe();
const handleChange = z.object({ handle: z.string(), expectedVersion: version });
const aliasCommand = z.object({ expectedVersion: version });
const details = z
  .object({
    displayName: z.string().optional(),
    biographyMarkdown: z.string().optional(),
    expectedVersion: version,
  })
  .refine((body) => body.displayName !== undefined || body.biographyMarkdown !== undefined);
function validated<T>(
  execution: Execution,
  schema: z.ZodType<T>,
  name: string,
  operation: (
    profiles: Profiles,
    principal: ProfilePrincipal,
    body: T,
    request: FastifyRequest
  ) => Effect.Effect<ProfileOutcome, import('../profile/index.js').ProfileUnavailable>
) {
  return (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            name,
            'Invalid Profile command',
            'Command fields and a positive integer expected Profile version are required'
          )
        );
    return profileCommand(execution, (profiles, principal) =>
      operation(profiles, principal, parsed.data, request)
    )(request, reply);
  };
}
const aliasParams = z.object({ handle: z.string() });
export function registerProfileRoutes(app: FastifyInstance, execution: Execution) {
  app.post(
    '/profile/me/ensure',
    profileCommand(execution, (profiles, principal) => profiles.ensure(principal))
  );
  app.patch(
    '/profile/me',
    validated(execution, details, 'invalid-profile-update', (profiles, principal, body) => {
      const { expectedVersion, ...changes } = body;
      return profiles.updateDetails(principal, changes, expectedVersion);
    })
  );
  app.put(
    '/profile/me/handle',
    validated(execution, handleChange, 'invalid-handle', (profiles, principal, body) =>
      profiles.changeHandle(principal, body.handle, body.expectedVersion)
    )
  );
  for (const [method, url, action] of [
    ['PUT', '/profile/me/aliases/:handle', 'reactivateAlias'],
    ['DELETE', '/profile/me/aliases/:handle', 'scheduleAliasExpiry'],
    ['POST', '/profile/me/aliases/:handle/expire', 'expireAliasImmediately'],
  ] as const) {
    app.route({
      method,
      url,
      handler: validated(
        execution,
        aliasCommand,
        'invalid-alias-command',
        (profiles, principal, body, request) =>
          profiles[action](
            principal,
            aliasParams.parse(request.params).handle,
            body.expectedVersion
          )
      ),
    });
  }
}
