import { randomBytes, randomUUID } from "node:crypto";

import { resolveClerkSecretKey } from "./auth-state";

type DisposableOwner = {
  readonly id: string;
  readonly email: string;
  readonly password: string;
};

/** A private owner for one browser journey; only its returned Clerk ID is deleted. */
export async function withDisposableOwner<T>(
  env: NodeJS.ProcessEnv,
  run: (owner: DisposableOwner) => Promise<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const secret = resolveClerkSecretKey(env);
  if (!secret.startsWith("sk_test_")) {
    throw new Error(
      "Disposable Clerk owners require a test instance secret key.",
    );
  }
  const marker = `wallpaperdb-e2e-${randomUUID()}`;
  const email = `${marker}+clerk_test@example.com`;
  const password = `${randomBytes(32).toString("base64url")}!aA1`;
  const failure = (operation: string, status?: number) =>
    new Error(
      `Disposable Clerk owner ${operation} failed${status === undefined ? "" : ` (HTTP ${status})`}; external_id=${marker}.`,
    );
  const request = async (method: string, path: string, body?: unknown) => {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.clerk.com/v1/users${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Fetch diagnostics and response bodies can contain authorization or credentials.
      throw failure(method);
    }
    if (!response.ok) throw failure(method, response.status);
    return response;
  };
  const created = await request("POST", "", {
    external_id: marker,
    email_address: [email],
    password,
  });
  let owner: unknown;
  try {
    owner = await created.json();
  } catch {
    throw failure("POST response decoding");
  }
  if (
    typeof owner !== "object" ||
    owner === null ||
    !("id" in owner) ||
    typeof owner.id !== "string" ||
    !/^user_[A-Za-z0-9]+$/.test(owner.id)
  ) {
    throw failure("POST response identity");
  }
  const id = owner.id;
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown };
  try {
    await request("PATCH", `/${id}`, { bypass_client_trust: true });
    outcome = { ok: true, value: await run({ id, email, password }) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await request("DELETE", `/${id}`);
  } catch (cleanupFailure) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.error, cleanupFailure],
        `Disposable Clerk owner journey and cleanup failed; external_id=${marker}.`,
      );
    }
    throw cleanupFailure;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
