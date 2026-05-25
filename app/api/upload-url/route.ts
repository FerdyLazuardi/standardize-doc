// POST /api/upload-url
// Body: { filename: string, content_type: string }
// Returns: { url: string, key: string }
//
// Issues a short-lived presigned PUT URL the browser can use to upload the file
// directly to Cloudflare R2. Bypasses Vercel's 4.5 MB function body cap because
// the file never traverses our function.

import { NextResponse } from "next/server";
import { makeObjectKey, presignPutUrl } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 10;

type Body = {
  filename?: string;
  content_type?: string;
};

const ALLOWED_EXT = /\.(pptx?|ppt|pdf)$/i;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = body.filename?.toString() || "";
  const contentType = body.content_type?.toString() || "application/octet-stream";

  if (!filename || !ALLOWED_EXT.test(filename)) {
    return NextResponse.json(
      { error: "Only .pptx / .ppt / .pdf files are allowed" },
      { status: 400 }
    );
  }

  try {
    const key = makeObjectKey(filename);
    const url = await presignPutUrl(key, contentType);
    return NextResponse.json({ url, key });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to presign URL";
    const status = msg.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
