// Markdown chunking that mirrors A-Pedi's MarkdownNodeParser + 600-token resplit.
// We split on H1/H2/H3 headers, then any chunk >600 tokens is re-split by token
// budget (chunk_size=512, overlap=50).

import { countTokens } from "./tokens";
import { parseFrontmatter } from "./frontmatter";

export type Chunk = {
  chunk_index: number;
  header: string;
  text: string;
  token_count: number;
  oversized_resplit: boolean;
};

const HEADER_RE = /^(#{1,3})\s+(.+?)\s*$/m;

function firstHeading(text: string): string {
  const m = HEADER_RE.exec(text);
  return m ? m[2].trim() : "";
}

function splitOnHeaders(body: string): { header: string; text: string }[] {
  if (!body.trim()) return [];
  // Split before each line that starts with #, ##, or ###
  const parts = body.split(/(?=^#{1,3}\s+)/m).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => ({ header: firstHeading(p), text: p }));
}

function tokensToText(tokens: number[]): string {
  // We don't reverse-encode; TokenTextSplitter operates on string. We mimic by
  // splitting on words proportional to target token count. This is good enough
  // for preview because A-Pedi's actual storage uses LlamaIndex TokenTextSplitter
  // which we don't run client-side. The user will see this as a "warning: section
  // too long, will be re-split during ingest".
  return tokens.join(" ");
}

function resplitByTokenBudget(text: string, chunkTokens = 512, overlapTokens = 50): string[] {
  // Approximation: split by paragraphs first, then group until token budget hits.
  const paras = text.split(/\n\n+/).filter((p) => p.trim());
  const groups: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const p of paras) {
    const pt = countTokens(p);
    if (currentTokens + pt > chunkTokens && current.length) {
      groups.push(current.join("\n\n"));
      // Apply overlap by carrying the last paragraph into next group if it fits
      const last = current[current.length - 1];
      const lastTok = countTokens(last);
      if (lastTok < overlapTokens * 1.5) {
        current = [last, p];
        currentTokens = lastTok + pt;
      } else {
        current = [p];
        currentTokens = pt;
      }
    } else {
      current.push(p);
      currentTokens += pt;
    }
  }
  if (current.length) groups.push(current.join("\n\n"));
  return groups.length ? groups : [text];
}

export function chunkMarkdown(markdown: string): Chunk[] {
  if (!markdown || !markdown.trim()) return [];
  const { body } = parseFrontmatter(markdown);
  if (!body.trim()) return [];

  const sections = splitOnHeaders(body);
  const flat: Omit<Chunk, "chunk_index">[] = [];

  for (const sec of sections) {
    const toks = countTokens(sec.text);
    if (toks > 600) {
      const subs = resplitByTokenBudget(sec.text, 512, 50);
      for (const sub of subs) {
        if (!sub.trim()) continue;
        flat.push({
          header: sec.header,
          text: sub,
          token_count: countTokens(sub),
          oversized_resplit: true,
        });
      }
    } else {
      flat.push({
        header: sec.header,
        text: sec.text,
        token_count: toks,
        oversized_resplit: false,
      });
    }
  }

  return flat
    .filter((c) => c.text.trim())
    .map((c, i) => ({ chunk_index: i, ...c }));
}

export type ChunksSummary = {
  total: number;
  oversized_resplit: number;
  max_tokens: number;
  min_tokens: number;
  avg_tokens?: number;
};

export function summarizeChunks(chunks: Chunk[]): ChunksSummary {
  if (!chunks.length) {
    return { total: 0, oversized_resplit: 0, max_tokens: 0, min_tokens: 0 };
  }
  const counts = chunks.map((c) => c.token_count);
  return {
    total: chunks.length,
    oversized_resplit: chunks.filter((c) => c.oversized_resplit).length,
    max_tokens: Math.max(...counts),
    min_tokens: Math.min(...counts),
    avg_tokens: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
  };
}
