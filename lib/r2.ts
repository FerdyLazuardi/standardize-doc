// Cloudflare R2 helpers (server-side only).
// Uses aws4fetch (~3 KB) for SigV4 signing — R2 is S3-compatible.

import { AwsClient } from "aws4fetch";

function env(): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
} {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function client(): { aws: AwsClient; bucketUrl: string } {
  const { accountId, accessKeyId, secretAccessKey, bucket } = env();
  return {
    aws: new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    }),
    bucketUrl: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
  };
}

/**
 * Generate a presigned PUT URL the browser can use to upload directly to R2.
 * Expires in `expiresSeconds` (default 600 = 10 min).
 */
export async function presignPutUrl(
  key: string,
  contentType: string,
  expiresSeconds = 600
): Promise<string> {
  const { aws, bucketUrl } = client();
  const url = new URL(
    `${bucketUrl}/${encodeURIComponent(key)}?X-Amz-Expires=${expiresSeconds}`
  );
  const signed = await aws.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/** Server-side fetch of an R2 object's bytes. */
export async function fetchObject(key: string): Promise<Blob> {
  const { aws, bucketUrl } = client();
  const url = `${bucketUrl}/${encodeURIComponent(key)}`;
  const res = await aws.fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`R2 fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.blob();
}

/** Best-effort delete. Errors are swallowed by the caller. */
export async function deleteObject(key: string): Promise<void> {
  const { aws, bucketUrl } = client();
  const url = `${bucketUrl}/${encodeURIComponent(key)}`;
  await aws.fetch(url, { method: "DELETE" });
}

/** Generate a unique-enough object key for an upload. */
export function makeObjectKey(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `uploads/${stamp}-${rand}-${safe}`;
}
