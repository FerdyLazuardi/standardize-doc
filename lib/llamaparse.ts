// LlamaParse REST client (server-side only — uses LLAMA_CLOUD_API_KEY).
// Async pattern: upload → poll status → fetch markdown.
// All calls go through the LlamaIndex Cloud REST API directly. We never expose
// the API key to the browser; the client gets back job_id only.

import { DEFAULT_PARSING_INSTRUCTION, LLAMAPARSE_BASE_URL } from "./llamaparse-shared";

export { DEFAULT_PARSING_INSTRUCTION };

const BASE_URL = LLAMAPARSE_BASE_URL;

type JobStatus = "PENDING" | "SUCCESS" | "ERROR" | "CANCELED";

export type LlamaParseStartResult = {
  job_id: string;
};

function authHeaders(): Record<string, string> {
  const key = process.env.LLAMA_CLOUD_API_KEY;
  if (!key) throw new Error("LLAMA_CLOUD_API_KEY not configured");
  return { Authorization: `Bearer ${key}` };
}

/**
 * Upload a .pptx file to LlamaParse. Returns the job_id which the client
 * polls via /api/parse/status.
 *
 * `file` is a File or Blob (small files <4.5 MB pass through Vercel; larger
 * files require the presigned-upload variant — not implemented here for v1
 * since most A-Pedi decks are <5 MB. If we hit the limit we'll add presigned).
 */
export async function startParseJob(
  file: File | Blob,
  filename: string,
  parsingInstruction?: string
): Promise<LlamaParseStartResult> {
  const fd = new FormData();
  fd.append("file", file, filename);
  fd.append("parsing_instruction", parsingInstruction || DEFAULT_PARSING_INSTRUCTION);
  fd.append("result_type", "markdown");

  const res = await fetch(`${BASE_URL}/api/v1/parsing/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LlamaParse upload failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: string };
  return { job_id: data.id };
}

export async function getJobStatus(jobId: string): Promise<{ status: JobStatus }> {
  const res = await fetch(`${BASE_URL}/api/v1/parsing/job/${jobId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LlamaParse status failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { status: JobStatus };
  return { status: data.status };
}

export async function getJobMarkdown(jobId: string): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/api/v1/parsing/job/${jobId}/result/markdown`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LlamaParse result failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { markdown?: string; text?: string };
  return data.markdown ?? data.text ?? "";
}
