// Client → Next.js API routes. Same-origin (works locally and on Vercel).
// Server-side secrets (LLAMA_CLOUD_API_KEY, OPENROUTER_API_KEY) stay in route
// handlers and never reach the browser.
//
// Exception: parseStart uploads directly to LlamaParse (bypassing Vercel's
// 4.5 MB function body cap on Hobby tier). See lib/llamaparse-client.ts.

import { uploadDirectToLlamaParse } from "./llamaparse-client";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// === Parse (async via job polling) ===

export type ParseStartResult = { job_id: string };

export async function parseStart(
  file: File,
  parsingInstruction?: string
): Promise<ParseStartResult> {
  return uploadDirectToLlamaParse(file, parsingInstruction);
}

export type JobStatus = { status: "PENDING" | "SUCCESS" | "ERROR" | "CANCELED" };

export async function parseStatus(jobId: string): Promise<JobStatus> {
  return jsonFetch(`/api/parse/status?job_id=${encodeURIComponent(jobId)}`);
}

export type ParseResult = {
  raw_markdown: string;
  cleaned_markdown: string;
  noise_stats: {
    original_slides: number;
    kept_slides: number;
    dropped_slides: string[];
    noise_lines_stripped: number;
  };
};

export async function parseResult(jobId: string): Promise<ParseResult> {
  return jsonFetch(`/api/parse/result?job_id=${encodeURIComponent(jobId)}`);
}

/**
 * Poll status until SUCCESS or ERROR. Each call is a separate ~1s function
 * invocation (fits Hobby tier 10s limit).
 */
export async function parsePollUntilDone(
  jobId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (status: string) => void } = {}
): Promise<ParseResult> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 120000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { status } = await parseStatus(jobId);
    opts.onTick?.(status);
    if (status === "SUCCESS") return parseResult(jobId);
    if (status === "ERROR" || status === "CANCELED") {
      throw new Error(`Parse job ${jobId} ended with status ${status}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Parse job ${jobId} timed out after ${timeout}ms`);
}

// === Standardize (Edge streaming, raw text body) ===

export type StandardizePayload = {
  raw_markdown: string;
  department: string;
  topic: string;
  course_id: string | number;
  course_name: string;
  entity_name: string;
  doc_type: string;
  use_pro?: boolean;
};

// Strip orphan code-fence lines the LLM sometimes emits despite "no code fences"
// instructions. The standardized markdown is a knowledge document — it should
// never contain ``` lines. Safe to remove all of them.
function stripOrphanFences(md: string): string {
  return md
    .replace(/^[ \t]*```[\w]*[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "") + "\n";
}

/**
 * Streams the standardized markdown text from the Edge route.
 * Calls onChunk with each delta; returns the full assembled markdown.
 */
export async function standardizeStream(
  payload: StandardizePayload,
  onChunk: (delta: string, accumulated: string) => void
): Promise<string> {
  const res = await fetch(`/api/standardize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    full += piece;
    onChunk(piece, full);
  }
  const cleaned = stripOrphanFences(full);
  if (cleaned !== full) onChunk("", cleaned);
  return cleaned;
}

// === Pure compute endpoints (Node runtime, fast) ===

export type ChunkPreview = {
  chunk_index: number;
  header: string;
  text: string;
  token_count: number;
  oversized_resplit: boolean;
};

export type ChunksResult = {
  chunks: ChunkPreview[];
  summary: {
    total: number;
    oversized_resplit: number;
    max_tokens: number;
    min_tokens: number;
    avg_tokens?: number;
  };
};

export async function getChunks(markdown: string): Promise<ChunksResult> {
  return jsonFetch("/api/chunks", {
    method: "POST",
    body: JSON.stringify({ markdown }),
  });
}

export type ValidationIssue = {
  check: string;
  severity: "error" | "warn" | "info";
  location: string;
  message: string;
};

export type ValidateResult = {
  issues: ValidationIssue[];
  summary: { error: number; warn: number; info: number };
};

export async function validateMd(
  markdown: string,
  entityName: string
): Promise<ValidateResult> {
  return jsonFetch("/api/validate", {
    method: "POST",
    body: JSON.stringify({ markdown, entity_name: entityName }),
  });
}

export type Suggestion = {
  chunk_index: number;
  category: "entity_alias" | "role_tag" | "question_hook" | "metric_label";
  severity: "warn" | "info";
  message: string;
  suggested_terms: string[];
};

export async function getSuggestions(
  markdown: string,
  topic: string,
  entityName: string
): Promise<{ suggestions: Suggestion[] }> {
  return jsonFetch("/api/suggest-keywords", {
    method: "POST",
    body: JSON.stringify({ markdown, topic, entity_name: entityName }),
  });
}

export async function applySuggestion(
  markdown: string,
  chunkIndex: number,
  term: string
): Promise<{ markdown: string; applied: boolean }> {
  return jsonFetch("/api/apply-suggestion", {
    method: "POST",
    body: JSON.stringify({ markdown, chunk_index: chunkIndex, term }),
  });
}

export type RetrieveResult = {
  results: {
    chunk_index: number;
    score: number;
    header: string;
    snippet: string;
  }[];
};

export async function retrieve(
  markdown: string,
  query: string,
  topK = 5
): Promise<RetrieveResult> {
  return jsonFetch("/api/retrieve", {
    method: "POST",
    body: JSON.stringify({ markdown, query, top_k: topK }),
  });
}

// === Auto-fix (Edge streaming, raw text body) ===

export type AutoFixAction = {
  type: "shrink" | "merge_short" | "rewrite" | "fix_frontmatter";
  location: string;
  current_tokens: number;
  message: string;
};

export type AutoFixPayload = {
  markdown: string;
  fixes: AutoFixAction[];
  entity_name: string;
  use_pro?: boolean;
};

export async function autoFixStream(
  payload: AutoFixPayload,
  onChunk: (delta: string, accumulated: string) => void
): Promise<string> {
  const res = await fetch(`/api/auto-fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    full += piece;
    onChunk(piece, full);
  }
  const cleaned = stripOrphanFences(full);
  if (cleaned !== full) onChunk("", cleaned);
  return cleaned;
}

export async function suggestQuestions(
  markdown: string,
  entityName: string,
  topic: string
): Promise<{ questions: string[] }> {
  return jsonFetch("/api/suggest-questions", {
    method: "POST",
    body: JSON.stringify({ markdown, entity_name: entityName, topic }),
  });
}
