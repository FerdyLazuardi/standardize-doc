// POST /api/blob-upload
// Issues a signed client upload token so the browser can PUT the file directly
// to Vercel Blob without proxying it through the Vercel function (which has a
// 4.5 MB body cap on Hobby tier). The signed token scopes uploads to allowed
// content types and a brief expiry. After upload, the browser hands the
// resulting blob URL to /api/parse/start.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/blob-upload — safe diagnostic. Returns whether the server has
// BLOB_READ_WRITE_TOKEN configured and what the parsed store id is. Does NOT
// leak the secret part. Visit https://<your-domain>/api/blob-upload in a
// browser to verify the deploy is reading the token correctly.
export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  if (!token) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "BLOB_READ_WRITE_TOKEN missing on the server. Connect the Blob store in Vercel → Storage → Settings → Connected Projects, then redeploy.",
      },
      { status: 503 }
    );
  }

  const parts = token.split("_");
  const looksValid =
    parts.length >= 5 && parts[0] === "vercel" && parts[1] === "blob";

  return NextResponse.json({
    configured: true,
    looksValid,
    prefix: token.slice(0, 18) + "…",
    storeIdGuess: parts[3] ?? null,
    note: looksValid
      ? "Token format looks valid. If uploads still 400, the token's store id may not match the store the SDK is calling."
      : "Token format looks wrong — should be vercel_blob_rw_<storeId>_<secret>.",
  });
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN not configured. Enable Vercel Blob: Vercel dashboard → Project → Storage → Create → Blob → then redeploy.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Limit what the browser can upload — extension-based gate.
        const lower = pathname.toLowerCase();
        const ok =
          lower.endsWith(".pdf") ||
          lower.endsWith(".pptx") ||
          lower.endsWith(".ppt");
        if (!ok) {
          throw new Error("Only .pdf / .pptx / .ppt files are allowed");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-powerpoint",
            "application/octet-stream",
          ],
          // 30 minutes is more than enough; LlamaParse pull happens within seconds
          // of upload completion, but we leave room for slow networks.
          validUntil: Date.now() + 30 * 60 * 1000,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do — /api/parse/start consumes the URL next.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload token failure";
    // Surface the underlying Vercel Blob error verbatim so the browser console
    // shows what actually went wrong (token missing, scope issue, etc).
    console.error("[/api/blob-upload] error:", e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
