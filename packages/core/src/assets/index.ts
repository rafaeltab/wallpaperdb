import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

export interface AssetReference {
  readonly owner: "ingestor" | "variant-generator" | "user";
  readonly id: string;
}
export interface AssetLocation {
  readonly bucket: string;
  readonly key: string;
}
export interface AssetRequestOptions {
  readonly abortSignal?: AbortSignal;
}
const referenceSchema = z.object({
  owner: z.enum(["ingestor", "variant-generator", "user"]),
  id: z.string().min(1).max(1024),
});
const locationSchema = z
  .object({
    bucket: z.string().min(1).max(255),
    key: z.string().min(1).max(1024),
  })
  .strict();
const descriptorSchema = z
  .object({
    version: z.literal(1),
    reference: referenceSchema,
    location: locationSchema,
  })
  .strict();
const conflict = z.object({ $metadata: z.object({ httpStatusCode: z.literal(412) }) });
function descriptorKey(reference: AssetReference): string {
  referenceSchema.parse(reference);
  return `${reference.owner}/${encodeURIComponent(reference.id)}.json`;
}
export async function registerAssetReference(
  client: S3Client,
  referenceBucket: string,
  reference: AssetReference,
  location: AssetLocation,
  options: AssetRequestOptions = {}
): Promise<void> {
  const descriptor = descriptorSchema.parse({ version: 1, reference, location });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: referenceBucket,
        Key: descriptorKey(reference),
        Body: JSON.stringify(descriptor),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
      options
    );
  } catch (cause) {
    if (!conflict.safeParse(cause).success) throw cause;
    const existing = await resolveAssetReference(client, referenceBucket, reference, options);
    if (existing.bucket !== location.bucket || existing.key !== location.key)
      throw new Error("Asset reference is already assigned to another stored object");
  }
}
export async function resolveAssetReference(
  client: S3Client,
  referenceBucket: string,
  reference: AssetReference,
  options: AssetRequestOptions = {}
): Promise<AssetLocation> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: referenceBucket,
      Key: descriptorKey(reference),
    }),
    options
  );
  if (!(response.Body instanceof Readable)) throw new Error("Missing asset descriptor body");
  const body = response.Body;
  const cancel = () => body.destroy(new Error("Asset descriptor read interrupted"));
  options.abortSignal?.addEventListener("abort", cancel, { once: true });
  try {
    options.abortSignal?.throwIfAborted();
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Invalid asset descriptor bytes");
      size += chunk.byteLength;
      if (size > 8192) throw new Error("Asset descriptor exceeds 8 KiB");
      chunks.push(Buffer.from(chunk));
    }
    const descriptor = descriptorSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (descriptor.reference.owner !== reference.owner || descriptor.reference.id !== reference.id)
      throw new Error("Asset descriptor identity mismatch");
    return descriptor.location;
  } finally {
    options.abortSignal?.removeEventListener("abort", cancel);
    body.destroy();
  }
}
