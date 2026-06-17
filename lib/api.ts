// Client → Next.js API routes. Same-origin (works locally and on Vercel).
// Server-side secrets (LLAMA_CLOUD_API_KEY, OPENROUTER_API_KEY) stay in route
// handlers and never reach the browser.
//
// Exception: parseStart uploads directly to LlamaParse (bypassing Vercel's
// 4.5 MB function body cap on Hobby tier). See lib/llamaparse-client.ts.

import { uploadDirectToLlamaParse } from "./llamaparse-client";

// Type-only imports: these MUST stay `import type` so the server-only modules
// (which read process.env / call LLM SDKs) are erased from the client bundle.
import type { JudgePairInput, JudgeVerdict } from "./dedup-judge";
import type { RewriteResult } from "./dedup-rewrite";

// Re-export so UI code can import these from "@/lib/api" alongside the rest.
export type { JudgePairInput, JudgeVerdict } from "./dedup-judge";
export type { RewriteResult } from "./dedup-rewrite";

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

// === Cross-document duplicate detection ===

export async function judgeDuplicates(
  pairs: JudgePairInput[],
  usePro = false
): Promise<{ verdicts: JudgeVerdict[] }> {
  return jsonFetch("/api/dedup-judge", {
    method: "POST",
    body: JSON.stringify({ pairs, use_pro: usePro }),
  });
}

/**
 * Judge candidate pairs in small concurrent batches with a one-shot retry per
 * batch. A single oversized prompt risks a truncated JSON array that fails the
 * whole scan; chunking bounds each call and isolates failures so one bad batch
 * loses at most `batchSize` pairs instead of every result. Never throws — a
 * batch that fails twice contributes no verdicts and the scan continues.
 */
export async function judgeDuplicatesBatched(
  pairs: JudgePairInput[],
  opts: {
    batchSize?: number;
    usePro?: boolean;
    onBatch?: (completedBatches: number, totalBatches: number) => void;
  } = {}
): Promise<{ verdicts: JudgeVerdict[]; failedBatches: number }> {
  const batchSize = opts.batchSize ?? 8;
  const batches: JudgePairInput[][] = [];
  for (let i = 0; i < pairs.length; i += batchSize) {
    batches.push(pairs.slice(i, i + batchSize));
  }
  let completed = 0;
  let failedBatches = 0;
  const total = batches.length;

  const runBatch = async (batch: JudgePairInput[]): Promise<JudgeVerdict[]> => {
    try {
      try {
        return (await judgeDuplicates(batch, opts.usePro)).verdicts;
      } catch {
        return (await judgeDuplicates(batch, opts.usePro)).verdicts;
      }
    } catch {
      failedBatches++;
      return [];
    } finally {
      completed++;
      opts.onBatch?.(completed, total);
    }
  };

  // Bounded concurrency: process the batches in waves so we never have more
  // than `concurrency` in-flight LLM calls (avoids provider rate limits).
  const concurrency = 4;
  const verdicts: JudgeVerdict[] = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = batches.slice(i, i + concurrency);
    const waveResults = await Promise.all(wave.map(runBatch));
    for (const r of waveResults) verdicts.push(...r);
  }
  return { verdicts, failedBatches };
}

export async function rewriteDifferentiate(payload: {
  a_text: string;
  b_text: string;
  shared_topic: string;
  a_unique_angle: string;
  b_unique_angle: string;
  entity_name: string;
  usePro?: boolean;
}): Promise<RewriteResult> {
  return jsonFetch("/api/dedup-rewrite", {
    method: "POST",
    body: JSON.stringify({
      a_text: payload.a_text,
      b_text: payload.b_text,
      shared_topic: payload.shared_topic,
      a_unique_angle: payload.a_unique_angle,
      b_unique_angle: payload.b_unique_angle,
      entity_name: payload.entity_name,
      use_pro: !!payload.usePro,
    }),
  });
}
