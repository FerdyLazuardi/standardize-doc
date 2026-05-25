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

export async function POST(request: Request) {
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
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
