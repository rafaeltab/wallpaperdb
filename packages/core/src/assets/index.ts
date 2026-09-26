import { z } from "zod";

export interface AssetReference {
  readonly owner: "ingestor" | "variant-generator" | "user";
  readonly id: string;
}
export interface AssetLocation {
  readonly bucket: string;
  readonly key: string;
}
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const imageMimeType = z.enum(["image/jpeg", "image/png", "image/webp"]);
const pathComponent = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);
const bucketName = z.string().min(1).max(255);
function ownedId(reference: AssetReference, owner: AssetReference["owner"]): string {
  if (reference.owner !== owner)
    throw new Error("Asset reference owner does not match its purpose");
  return pathComponent.parse(reference.id);
}

export function resolveOriginalAsset(
  reference: AssetReference,
  mimeType: string,
  bucket: string
): AssetLocation {
  const id = ownedId(reference, "ingestor");
  return {
    bucket: bucketName.parse(bucket),
    key: `${id}/original.${extensions[imageMimeType.parse(mimeType)]}`,
  };
}

export function resolveVariantAsset(
  reference: AssetReference,
  metadata: { readonly wallpaperId: string; readonly mimeType: string },
  bucket: string
): AssetLocation {
  if (reference.owner !== "variant-generator")
    throw new Error("Asset reference owner does not match its purpose");
  const wallpaperId = pathComponent.parse(metadata.wallpaperId);
  const mimeType = imageMimeType.parse(metadata.mimeType);
  const match = /^([A-Za-z0-9_-]+):([1-9][0-9]*)x([1-9][0-9]*):(image\/(?:jpeg|png|webp))$/.exec(
    reference.id
  );
  if (
    !match ||
    match[1] !== wallpaperId ||
    match[4] !== mimeType ||
    !Number.isSafeInteger(Number(match[2])) ||
    !Number.isSafeInteger(Number(match[3]))
  )
    throw new Error("Variant identity does not match its wallpaper, target or format");
  return {
    bucket: bucketName.parse(bucket),
    key: `${wallpaperId}/variant_${match[2]}x${match[3]}.${extensions[mimeType]}`,
  };
}

export function resolveProfilePictureAsset(
  reference: AssetReference,
  profileId: string,
  bucket: string
): AssetLocation {
  const id = ownedId(reference, "user");
  return { bucket: bucketName.parse(bucket), key: `${pathComponent.parse(profileId)}/${id}.webp` };
}
