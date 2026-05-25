// Local BM25 retrieval over chunks. No embedding, no LLM, no Qdrant.
// Inline BM25 implementation (no external dep needed).

import type { Chunk } from "./chunking";

const TOKEN_RE = /\w+/gu;

function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push(m[0].toLowerCase());
  }
  return out;
}

export type RetrieveResult = {
  chunk_index: number;
  score: number;
  header: string;
  snippet: string;
};

// Standard BM25Okapi: k1=1.5, b=0.75
const K1 = 1.5;
const B = 0.75;

export function search(
  chunks: Chunk[],
  query: string,
  topK = 5
): RetrieveResult[] {
  if (!chunks.length || !query.trim()) return [];

  const corpus = chunks.map((c) => tokenize(c.text));
  if (!corpus.some((d) => d.length)) return [];

  // Document frequencies
  const N = corpus.length;
  const df = new Map<string, number>();
  for (const doc of corpus) {
    const seen = new Set<string>();
    for (const t of doc) {
      if (!seen.has(t)) {
        df.set(t, (df.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }

  // Inverse doc frequency: log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = new Map<string, number>();
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }

  const docLens = corpus.map((d) => d.length);
  const avgLen = docLens.reduce((a, b) => a + b, 0) / N;

  const queryTokens = tokenize(query);
  const scores = corpus.map((doc, i) => {
    const dl = docLens[i];
    if (!dl) return 0;
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + B * (dl / avgLen));
      score += (idf.get(q) ?? 0) * (numerator / denominator);
    }
    return score;
  });

  const ranked = chunks
    .map((c, i) => ({ chunk: c, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked.map(({ chunk, score }) => {
    const text = chunk.text || "";
    const snippet = text.length > 240 ? text.slice(0, 240).trimEnd() + "..." : text;
    return {
      chunk_index: chunk.chunk_index,
      score: Math.round(score * 10000) / 10000,
      header: chunk.header,
      snippet,
    };
  });
}
