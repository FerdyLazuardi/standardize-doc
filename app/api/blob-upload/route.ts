// POST /api/blob-upload
// Issues a signed client upload token so the browser can PUT the file directly
// to Vercel Blob without proxying it through the Vercel function (which has a
// 4.5 MB body cap on Hobby tier). The signed token scopes uploads to allowed
// content types and a brief expiry. After upload, the browser hands the
// resulting blob URL to /api/parse/start.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/blob-upload — safe diagnostic. Verifies the server can actually
// reach the Blob store with the configured token. Does not leak the secret.
export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const explicitStoreId = process.env.BLOB_STORE_ID ?? "";
  if (!token) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "BLOB_READ_WRITE_TOKEN missing. Connect the Blob store in Vercel → Storage → Settings → Connected Projects, then redeploy.",
      },
      { status: 503 }
    );
  }

  const parts = token.split("_");
  const looksValid =
    parts.length >= 5 && parts[0] === "vercel" && parts[1] === "blob";
  const tokenStoreId = parts[3] ?? null;

  // BLOB_STORE_ID has format `store_<id>`; the token has `<id>` without prefix.
  const normalizedExplicit = explicitStoreId.replace(/^store_/, "");
  const idsMatch =
    !normalizedExplicit || !tokenStoreId || normalizedExplicit === tokenStoreId;

  // Live probe: try a tiny list() call. If the store is dead/unreachable, this
  // fails with a precise error that's easier to act on than the upload 400.
  let liveProbe: { ok: boolean; error?: string };
  try {
    await list({ limit: 1, token });
    liveProbe = { ok: true };
  } catch (e) {
    liveProbe = {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }

  return NextResponse.json({
    configured: true,
    looksValid,
    prefix: token.slice(0, 18) + "…",
    tokenStoreId,
    explicitStoreId: explicitStoreId || "(not set)",
    idsMatch,
    liveProbe,
    note: !looksValid
      ? "Token format wrong — should be vercel_blob_rw_<storeId>_<secret>."
      : !liveProbe.ok
        ? "Server cannot reach the Blob store with this token. Most likely the store was deleted/recreated and the env vars point to a dead store. Fix: delete the existing Blob store in Vercel dashboard, create a fresh one, ensure it auto-injects BLOB_READ_WRITE_TOKEN into this project (Production+Preview), then redeploy without cache."
        : "All checks pass. Uploads should work.",
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
        // Extension-based gate. We accept the modern PPTX mime, the legacy PPT
        // mime, the PDF mime, and a generic fallback because some browsers
        // don't set file.type for drag-and-drop or bin-typed uploads.
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
            "binary/octet-stream",
          ],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // /api/parse/start consumes the URL next; nothing to do here.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload token failure";
    console.error("[/api/blob-upload] error:", e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
