import { expect, it } from "vitest";

import { withDisposableOwner } from "../src/disposable-owner";

const env = { CLERK_SECRET_KEY: "sk_test_fixture" };

function clerkFixture(failedMethods: readonly string[] = []) {
  const requests: Request[] = [];
  const accounts = new Set<string>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (failedMethods.includes(request.method)) {
      return new Response(`Sensitive server response ${env.CLERK_SECRET_KEY}`, {
        status: 503,
      });
    }
    if (request.method === "POST") {
      accounts.add("user_disposable");
      return Response.json({ id: "user_disposable" });
    }
    if (request.method === "DELETE") accounts.delete("user_disposable");
    return Response.json({ id: "user_disposable" });
  };
  return { requests, accounts, fetchImpl };
}

it("creates an isolated test owner, enables sign-in, and deletes that owner after use", async () => {
  const clerk = clerkFixture();
  const result = await withDisposableOwner(
    env,
    async (owner) => {
      expect(owner.id).toBe("user_disposable");
      expect(owner.email).toMatch(
        /^wallpaperdb-e2e-[\da-f-]+\+clerk_test@example\.com$/,
      );
      expect(owner.password.length).toBeGreaterThanOrEqual(32);
      expect(clerk.accounts.has(owner.id)).toBe(true);
      const created = await clerk.requests[0].clone().json();
      expect(created).toMatchObject({
        email_address: [owner.email],
        password: owner.password,
      });
      expect(created.external_id).toMatch(/^wallpaperdb-e2e-[\da-f-]+$/);
      const configured = clerk.requests.find(
        (request) => request.method === "PATCH",
      );
      expect(configured?.url).toBe(
        "https://api.clerk.com/v1/users/user_disposable",
      );
      expect(await configured?.clone().json()).toEqual({
        bypass_client_trust: true,
      });
      return "journey complete";
    },
    clerk.fetchImpl,
  );
  expect(result).toBe("journey complete");
  expect(clerk.accounts.size).toBe(0);
  expect(
    clerk.requests.find((request) => request.method === "DELETE")?.url,
  ).toBe("https://api.clerk.com/v1/users/user_disposable");
});

it("rejects a production secret before making any Clerk request", async () => {
  const clerk = clerkFixture();
  await expect(
    withDisposableOwner(
      { CLERK_SECRET_KEY: "sk_live_secret" },
      async () => "unused",
      clerk.fetchImpl,
    ),
  ).rejects.toThrow("test instance");
  expect(clerk.requests).toHaveLength(0);
});

it("deletes the created owner when the browser journey throws", async () => {
  const clerk = clerkFixture();
  const failedJourney = new Error("Browser assertion failed");
  await expect(
    withDisposableOwner(
      env,
      async () => {
        throw failedJourney;
      },
      clerk.fetchImpl,
    ),
  ).rejects.toBe(failedJourney);
  expect(clerk.accounts.size).toBe(0);
});

it("deletes the created owner when sign-in setup fails without exposing response bodies", async () => {
  const clerk = clerkFixture(["PATCH"]);
  let ran = false;
  const result = withDisposableOwner(
    env,
    async () => {
      ran = true;
    },
    clerk.fetchImpl,
  );
  await expect(result).rejects.toThrow("PATCH failed (HTTP 503)");
  await expect(result).rejects.not.toThrow(env.CLERK_SECRET_KEY);
  expect(ran).toBe(false);
  expect(clerk.accounts.size).toBe(0);
});

it("reports cleanup failure after a successful journey", async () => {
  const clerk = clerkFixture(["DELETE"]);
  const result = withDisposableOwner(env, async () => "done", clerk.fetchImpl);
  await expect(result).rejects.toThrow("DELETE failed (HTTP 503)");
  await expect(result).rejects.not.toThrow(env.CLERK_SECRET_KEY);
  expect(clerk.accounts.has("user_disposable")).toBe(true);
});

it("preserves both the journey failure and cleanup failure", async () => {
  const clerk = clerkFixture(["DELETE"]);
  const failedJourney = new Error("Browser assertion failed");
  const result = withDisposableOwner(
    env,
    async () => {
      throw failedJourney;
    },
    clerk.fetchImpl,
  );
  await expect(result).rejects.toBeInstanceOf(AggregateError);
  await expect(result).rejects.toMatchObject({
    errors: [
      failedJourney,
      expect.objectContaining({
        message: expect.stringContaining("DELETE failed"),
      }),
    ],
  });
});

it.each([
  "transport",
  "response",
  "identity",
])("keeps ambiguous creation diagnosable without deleting an unconfirmed account (%s)", async (failure) => {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    if (failure === "transport")
      throw new Error(`Sensitive fetch detail ${env.CLERK_SECRET_KEY}`);
    if (failure === "response")
      return new Response(`Sensitive body ${env.CLERK_SECRET_KEY}`);
    return Response.json({ id: "user_/../unrelated" });
  };
  const result = withDisposableOwner(env, async () => "unused", fetchImpl);
  const marker = (await requests[0].clone().json()).external_id;
  await expect(result).rejects.toThrow(`external_id=${marker}`);
  await expect(result).rejects.not.toThrow(env.CLERK_SECRET_KEY);
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("POST");
});

it("assigns different credentials and ownership markers to simultaneous journeys", async () => {
  const owners: Array<{ email: string; password: string }> = [];
  await Promise.all(
    [clerkFixture(), clerkFixture()].map((clerk) =>
      withDisposableOwner(
        env,
        async (owner) => {
          owners.push(owner);
        },
        clerk.fetchImpl,
      ),
    ),
  );
  expect(new Set(owners.map((owner) => owner.email)).size).toBe(2);
  expect(new Set(owners.map((owner) => owner.password)).size).toBe(2);
});
