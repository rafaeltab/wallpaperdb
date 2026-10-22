import { OwnerValueSchema } from '@wallpaperdb/events/schemas';
import { Context, Effect, Layer } from 'effect';
import { createRemoteJWKSet, customFetch, decodeJwt, errors, jwtVerify } from 'jose';
import type { IdentityProvider } from '../../authority.js';
import {
  AuthorAuthentication,
  AuthorAuthenticationFailure,
  AuthorAuthenticationHealth,
} from './contract.js';

const rejected = (cause: unknown) =>
  cause instanceof errors.JWTExpired ||
  cause instanceof errors.JWTClaimValidationFailed ||
  cause instanceof errors.JWSSignatureVerificationFailed ||
  cause instanceof errors.JWSInvalid ||
  cause instanceof errors.JWTInvalid ||
  cause instanceof errors.JWKSNoMatchingKey ||
  cause instanceof errors.JOSEAlgNotAllowed;
/** Remote keys are shared per configured issuer. jose bounds each underlying key
 * request; no author request can choose the issuer, key endpoint or namespace. */
export function clerkAuthorLayer(providers: readonly IdentityProvider[]) {
  return Layer.syncContext(() => {
    const contactHealth = new Map(providers.map((provider) => [provider.issuer, true]));
    const configured = new Map(
      providers.map((provider) => [
        provider.issuer,
        {
          provider,
          keys: createRemoteJWKSet(new URL(provider.jwksUrl), {
            timeoutDuration: 5000,
            [customFetch]: async (...args) => {
              try {
                const response = await fetch(...args);
                contactHealth.set(provider.issuer, response.ok);
                return response;
              } catch (cause) {
                contactHealth.set(provider.issuer, false);
                throw cause;
              }
            },
          }),
        },
      ])
    );
    const authentication = AuthorAuthentication.of({
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
              const subject = OwnerValueSchema.safeParse(payload.sub);
              return subject.success
                ? { namespace: provider.ownerNamespace, subject: subject.data }
                : null;
            } catch (cause) {
              if (rejected(cause)) return null;
              contactHealth.set(provider.issuer, false);
              throw cause;
            }
          },
          catch: (cause) => new AuthorAuthenticationFailure({ cause }),
        }).pipe(
          Effect.tapError(() => Effect.logError('Configured author identity provider unavailable')),
          Effect.withSpan('asset.authors.verify')
        ),
    });
    return Context.make(AuthorAuthentication, authentication).pipe(
      Context.add(AuthorAuthenticationHealth, {
        check: () => Effect.sync(() => [...contactHealth.values()].every(Boolean)),
      })
    );
  });
}
