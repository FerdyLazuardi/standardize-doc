// Browser-side LlamaParse uploader.
//
// Two-step flow that works with Vercel Hobby's 4.5 MB function body cap:
//   1. Upload the file directly from the browser to Vercel Blob using a
//      short-lived signed token issued by /api/blob-upload. Files of any size
//      bypass the function body cap because the upload goes to Blob, not to
//      our function.
//   2. Hand the resulting blob URL to /api/parse/start, which fetches the file
//      from Blob server-side and forwards it to LlamaParse using the
//      server-only LLAMA_CLOUD_API_KEY. The Blob is deleted after handoff.
//
// The LlamaParse API key never reaches the browser. The Blob URL is short-lived
// and the file is removed within seconds of upload, so storage stays at ~0.

import { upload } from "@vercel/blob/client";

export async function uploadDirectToLlamaParse(
  file: File,
  parsingInstruction?: string
): Promise<{ job_id: string }> {
  // Step 1: upload to Vercel Blob via signed client token.
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/blob-upload",
    contentType: file.type || undefined,
  });

  // Step 2: tell our function to relay it to LlamaParse.
  const res = await fetch("/api/parse/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blob_url: blob.url,
      filename: file.name,
      parsing_instruction: parsingInstruction,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Parse start failed: ${res.status} ${text}`);
  }

  return (await res.json()) as { job_id: string };
}
