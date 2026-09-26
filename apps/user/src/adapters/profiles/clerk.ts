import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { Identities, ProfileUnavailable } from '../../profile/index.js';

const clerkIdentity = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  has_image: z.boolean(),
  image_url: z.string(),
});

/** Native fetch makes the request abortable, including response-body consumption. */
export const clerkIdentitiesLayer = (config: { readonly clerkSecretKey?: string }) => Layer.succeed(Identities, {
  getIdentity: profileId => Effect.tryPromise({
    try: async signal => {
      if (!config.clerkSecretKey) throw new Error('Identity lookup is not configured');
      const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(profileId)}`, {
        headers: { authorization: `Bearer ${config.clerkSecretKey}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Identity lookup returned HTTP ${response.status}`);
      }
      const identity = clerkIdentity.parse(await response.json());
      return { displayName: null, firstName: identity.first_name, lastName: identity.last_name, imageUrl: identity.has_image ? identity.image_url : null };
    },
    catch: cause => new ProfileUnavailable({ operation: 'identity-lookup', cause }),
  }),
});
