import { Effect, Layer } from 'effect';
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify } from 'jose';
import { CreatorAuthentication, WorkflowFailure } from '../../capabilities/creation/index.js';
import type { WorkflowConfig } from '../../workflow-config.js';
export function creatorAuthenticationLayer(providers: WorkflowConfig['identityProviders']) {
  return Layer.sync(CreatorAuthentication, () => {
    const configured = new Map(
      providers.map((provider) => [
        provider.issuer,
        {
          provider,
          keys: createRemoteJWKSet(new URL(provider.jwksUrl), { timeoutDuration: 5000 }),
        },
      ])
    );
    return CreatorAuthentication.of({
      verify: (authorization) =>
        Effect.tryPromise({
          try: async () => {
            if (
              !authorization ||
              authorization.length > 8192 ||
              !/^Bearer [^\s]+$/i.test(authorization)
            )
              return null;
            const token = authorization.slice(7);
            let issuer: string | undefined;
            try {
              issuer = decodeJwt(token).iss;
            } catch {
              return null;
            }
            const selected = issuer ? configured.get(issuer) : undefined;
            if (!selected) return null;
            const { provider, keys } = selected;
            try {
              const { payload } = await jwtVerify(token, keys, {
                issuer: provider.issuer,
                algorithms: ['RS256'],
                requiredClaims: ['sub', 'exp', 'iat'],
                ...(provider.audience.length ? { audience: provider.audience } : {}),
              });
              if (!provider.audience.length && payload.aud !== undefined) return null;
              if (
                payload.azp === undefined
                  ? provider.requireAuthorizedParty
                  : typeof payload.azp !== 'string' ||
                    !provider.authorizedParties.includes(payload.azp)
              )
                return null;
              if (
                typeof payload.sub !== 'string' ||
                !payload.sub.length ||
                Buffer.byteLength(payload.sub) > 256
              )
                return null;
              return { namespace: provider.ownerNamespace, subject: payload.sub };
            } catch (cause) {
              if (
                cause instanceof errors.JWTExpired ||
                cause instanceof errors.JWTClaimValidationFailed ||
                cause instanceof errors.JWSSignatureVerificationFailed ||
                cause instanceof errors.JWSInvalid ||
                cause instanceof errors.JWTInvalid ||
                cause instanceof errors.JWKSNoMatchingKey ||
                cause instanceof errors.JOSEAlgNotAllowed
              )
                return null;
              throw cause;
            }
          },
          catch: (cause) => new WorkflowFailure({ operation: 'verify-creator', cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Creator identity provider unavailable', { cause: error.cause })
          ),
          Effect.withSpan('wallpaper.creator.verify')
        ),
    });
  });
}
