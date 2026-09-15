// Exercise the actual Compose service in an isolated project with disposable data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// Use the same SDK dependency as the test infrastructure without adding a root dependency.
const require = createRequire(new URL("../packages/test-utils/package.json", import.meta.url));
const { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const project = `wallpaperdb-storage-test-${randomUUID().slice(0, 8)}`;
const credentials = { accessKeyId: "storage-test-admin", secretAccessKey: "storage-test-secret" };

function compose(...args) {
  return execFileSync("docker", [
    "compose", "--env-file", "/dev/null", "-p", project,
    "-f", "infra/docker-compose.yml", ...args,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      S3_API_HOST_PORT: "0",
      S3_ACCESS_KEY_ID: credentials.accessKeyId,
      S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    },
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

let client;
function storageEndpoint() {
  const port = compose("port", "seaweedfs", "9000").split("\n")[0].split(":").at(-1);
  return `http://127.0.0.1:${port}`;
}

try {
  compose("up", "-d", "--wait", "--wait-timeout", "120", "seaweedfs");
  let endpoint = storageEndpoint();
  client = new S3Client({ endpoint, credentials, region: "us-east-1", forcePathStyle: true });
  const key = "storage-smoke/original.jpg";
  const body = "persistent wallpaper bytes";

  for (const bucket of ["wallpapers", "example-bucket"]) {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: "image/jpeg",
      Metadata: { "wallpaper-id": "storage-smoke" },
    }));
    const response = await fetch(`${endpoint}/${bucket}/${key}`);
    assert.equal(response.status, 200, `${bucket} allows public downloads`);
    assert.equal(await response.text(), body);
    assert.equal((await fetch(`${endpoint}/${bucket}/unauthorized`, {
      method: "PUT", body: "must not be stored",
    })).status, 403, `${bucket} rejects anonymous writes`);
    assert.equal((await fetch(`${endpoint}/${bucket}?list-type=2`)).status, 403,
      `${bucket} rejects anonymous listing`);
  }

  await client.send(new CreateBucketCommand({ Bucket: "private-bucket" }));
  await client.send(new PutObjectCommand({ Bucket: "private-bucket", Key: key, Body: body }));
  assert.equal((await fetch(`${endpoint}/private-bucket/${key}`)).status, 403,
    "anonymous access is limited to the two development buckets");
  await assert.rejects(client.send(new PutObjectCommand({
    Bucket: "missing-bucket", Key: key, Body: body,
  })), { name: "NoSuchBucket" }, "uploads cannot implicitly create buckets");

  compose("restart", "seaweedfs");
  compose("up", "-d", "--wait", "--wait-timeout", "120", "seaweedfs");
  // Docker may allocate a new ephemeral host port on restart.
  endpoint = storageEndpoint();
  client.destroy();
  client = new S3Client({ endpoint, credentials, region: "us-east-1", forcePathStyle: true });
  for (const bucket of ["wallpapers", "example-bucket"]) {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    assert.equal(await object.Body.transformToString(), body);
    assert.equal(object.ContentType, "image/jpeg");
    assert.equal(object.Metadata["wallpaper-id"], "storage-smoke");
    assert.equal((await fetch(`${endpoint}/${bucket}/${key}`)).status, 200);
  }
  console.log("Compose storage checks passed: bucket bootstrap, scoped public reads, authenticated writes, and persistence.");
} catch (error) {
  console.error(compose("logs", "--no-color", "--tail", "100", "seaweedfs"));
  throw error;
} finally {
  client?.destroy();
  // Only this script's uniquely named project and disposable volume are removed.
  compose("down", "--volumes");
}
