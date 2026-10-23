import { Context, Data, type Effect } from 'effect';
import type { Owner } from '../../capabilities/lifecycle/index.js';
export class AuthorAuthenticationFailure extends Data.TaggedError('AuthorAuthenticationFailure')<{
  readonly cause: unknown;
}> {}
export class AuthorAuthentication extends Context.Service<
  AuthorAuthentication,
  {
    readonly verify: (
      authorization: string | undefined
    ) => Effect.Effect<Owner | null, AuthorAuthenticationFailure>;
  }
>()('asset/authors/Authentication') {}

export class AuthorAuthenticationHealth extends Context.Service<
  AuthorAuthenticationHealth,
  {
    readonly check: () => Effect.Effect<boolean>;
  }
>()('asset/authors/Health') {}
