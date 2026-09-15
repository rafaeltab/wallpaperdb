import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyOverrides, extractKeys, filterApplicableSecrets, parseEnvValues } from "./env-pipeline.mjs";

const templatePaths = [
  "infra/.env.example",
  "apps/ingestor/.env.example",
  "apps/media/.env.example",
  "apps/color-extractor/.env.example",
  "apps/variant-generator/.env.example",
];

for (const path of templatePaths) {
  test(`${path} preserves custom S3 credentials during environment generation`, () => {
    const template = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const credentials = Object.freeze({
      S3_ACCESS_KEY_ID: "custom-storage-user",
      S3_SECRET_ACCESS_KEY: "custom-storage-secret",
    });
    const applicable = filterApplicableSecrets(credentials, extractKeys(template), path, () => {});
    const generated = parseEnvValues(applyOverrides(template, applicable, {}));

    assert.equal(generated.S3_ACCESS_KEY_ID, credentials.S3_ACCESS_KEY_ID);
    assert.equal(generated.S3_SECRET_ACCESS_KEY, credentials.S3_SECRET_ACCESS_KEY);
  });
}

test("storage host port overrides the worktree slot without leaking unrelated secrets", () => {
  const template = readFileSync(new URL("../../infra/.env.example", import.meta.url), "utf8");
  const secrets = { S3_API_HOST_PORT: "8122", UNRELATED_API_SECRET: "private-value" };
  const worktreeContent = applyOverrides(template, { S3_API_HOST_PORT: "8012" }, {});
  const applicable = filterApplicableSecrets(secrets, extractKeys(template), "infra", () => {});
  const generated = parseEnvValues(applyOverrides(worktreeContent, applicable, {}));

  assert.equal(generated.S3_API_HOST_PORT, "8122");
  assert.equal(generated.UNRELATED_API_SECRET, undefined);
});

test("empty storage secrets preserve development credentials from the template", () => {
  const template = readFileSync(new URL("../../infra/.env.example", import.meta.url), "utf8");
  const applicable = filterApplicableSecrets({ S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" },
    extractKeys(template), "infra", () => {});
  const generated = parseEnvValues(applyOverrides(template, applicable, {}));

  assert.equal(generated.S3_ACCESS_KEY_ID, "storageadmin");
  assert.equal(generated.S3_SECRET_ACCESS_KEY, "storageadmin");
});

test("ingestor environment generation preserves a custom S3 cleanup interval", () => {
  const template = readFileSync(new URL("../../apps/ingestor/.env.example", import.meta.url), "utf8");
  const applicable = filterApplicableSecrets({ S3_CLEANUP_INTERVAL_MS: "60000" },
    extractKeys(template), "apps/ingestor", () => {});
  const generated = parseEnvValues(applyOverrides(template, applicable, {}));

  assert.equal(generated.S3_CLEANUP_INTERVAL_MS, "60000");
});
