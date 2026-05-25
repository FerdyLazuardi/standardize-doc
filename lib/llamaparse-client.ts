// Browser-side LlamaParse uploader.
//
// Three-step flow that bypasses Vercel's 4.5 MB function body cap:
//   1. Ask /api/upload-url for a short-lived presigned PUT URL to Cloudflare R2.
//   2. PUT the file directly to R2 from the browser. R2's CORS policy allows
//      this origin; the upload never traverses our Vercel function.
//   3. POST the resulting R2 object key to /api/parse/start, which fetches the
//      file server-side and forwards it to LlamaParse using the server-only
//      LLAMA_CLOUD_API_KEY. The R2 object is deleted after handoff.
//
// LlamaParse API key never reaches the browser. R2 storage stays at ~0 because
// objects are deleted immediately after parsing.

export async function uploadDirectToLlamaParse(
  file: File,
  parsingInstruction?: string
): Promise<{ job_id: string }> {
  // Step 1: get presigned URL.
  const presignRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
    }),
  });
  if (!presignRes.ok) {
    const text = await presignRes.text().catch(() => "");
    throw new Error(`Presign failed: ${presignRes.status} ${text}`);
  }
  const { url, key } = (await presignRes.json()) as {
    url: string;
    key: string;
  };

  // Step 2: PUT directly to R2.
  const putRes = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw new Error(`R2 upload failed: ${putRes.status} ${text}`);
  }

  // Step 3: tell our function to relay it to LlamaParse.
  const startRes = await fetch("/api/parse/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      filename: file.name,
      parsing_instruction: parsingInstruction,
    }),
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`Parse start failed: ${startRes.status} ${text}`);
  }

  return (await startRes.json()) as { job_id: string };
}
