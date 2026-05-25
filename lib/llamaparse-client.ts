// Browser-side LlamaParse uploader.
//
// Posts the file directly to /api/parse/start as multipart/form-data. The route
// forwards to LlamaParse using the server-only LLAMA_CLOUD_API_KEY. The browser
// never sees the key.
//
// File size is bounded by Vercel's function body cap (~4.5 MB on Hobby).
// lib/compress.ts shrinks PDFs/PPTX below that before this is called.

export async function uploadDirectToLlamaParse(
  file: File,
  parsingInstruction?: string
): Promise<{ job_id: string }> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("filename", file.name);
  if (parsingInstruction) {
    fd.append("parsing_instruction", parsingInstruction);
  }

  const res = await fetch("/api/parse/start", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Parse start failed: ${res.status} ${text}`);
  }

  return (await res.json()) as { job_id: string };
}
