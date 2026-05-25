// Browser-side LlamaParse uploader. Uploads the file directly to LlamaIndex
// Cloud, bypassing Vercel's 4.5 MB function body cap. The API key is exposed
// to the client via NEXT_PUBLIC_LLAMA_CLOUD_API_KEY — acceptable for internal
// tools since the key is scoped to LlamaParse credits and easy to rotate.

import {
  DEFAULT_PARSING_INSTRUCTION,
  LLAMAPARSE_BASE_URL,
} from "./llamaparse-shared";

export async function uploadDirectToLlamaParse(
  file: File,
  parsingInstruction?: string
): Promise<{ job_id: string }> {
  const apiKey = process.env.NEXT_PUBLIC_LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXT_PUBLIC_LLAMA_CLOUD_API_KEY not configured. Add it to .env.local and restart the dev server."
    );
  }

  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("parsing_instruction", parsingInstruction || DEFAULT_PARSING_INSTRUCTION);
  fd.append("result_type", "markdown");

  const res = await fetch(`${LLAMAPARSE_BASE_URL}/api/v1/parsing/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LlamaParse upload failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return { job_id: data.id };
}
