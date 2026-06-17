// Cross-document duplicate-context detection at the H1 (chunk) level.
//
// A standardized A-Pedi doc is a list of `#` H1 sections — each H1 is one RAG
// chunk. Two different course docs can end up with H1 sections covering the same
// topic (e.g. a "Product" course and a dedicated "Modal" course both explaining
// modal). Those near-duplicate chunks pollute retrieval. This module finds the
// candidate pairs cheaply client-side (TF-IDF cosine) so the LLM judge only has
// to look at a bounded shortlist instead of every O(n²) pair.

import { countTokens } from "./tokens";
import { parseFrontmatter } from "./frontmatter";
import { validateMarkdown, type ValidationIssue } from "./validators";

export type DocSection = {
  doc_index: number;
  doc_name: string;
  topic: string;
  section_index: number; // 0-based H1 index within its own doc
  heading: string;
  text: string; // full section text including the `# heading` line, trimmed
  token_count: number;
};

export type CandidatePair = {
  pair_id: string; // stable id: "<aDoc>:<aSec>__<bDoc>:<bSec>"
  a: DocSection;
  b: DocSection;
  similarity: number; // cosine, 0..1, rounded to 4dp
};

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

// Light stopword list (ID + EN) so common glue words don't inflate the cosine
// prefilter. The LLM judge makes the final call, so this only needs to be a
// rough topical filter — missing a word here is harmless.
const STOPWORDS = new Set([
  // Indonesian
  "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "adalah",
  "ini", "itu", "atau", "juga", "dalam", "tidak", "akan", "agar", "oleh",
  "sebagai", "para", "kami", "kita", "anda", "mereka", "dia", "saya",
  "bisa", "dapat", "harus", "telah", "sudah", "saat", "jika", "maka",
  "karena", "tersebut", "secara", "antara", "setiap", "namun", "serta",
  "lebih", "agar", "hal", "bagi", "yaitu", "yakni", "ada", "menjadi",
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "as", "by", "at", "this", "that", "it", "from",
  "we", "you", "they", "will", "can", "must", "has", "have", "its",
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const t = m[0].toLowerCase();
    if (t.length < 3) continue; // drop 1-2 char noise
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * The set of significant (non-stopword, 3+ char) tokens shared by both
 * sections. Used by the UI to highlight the overlapping vocabulary so a
 * reviewer can see at a glance *which words* make the two chunks read alike.
 * Lowercased; callers match case-insensitively.
 */
export function sharedSignificantTokens(aText: string, bText: string): Set<string> {
  const a = new Set(tokenize(aText));
  const shared = new Set<string>();
  for (const t of new Set(tokenize(bText))) {
    if (a.has(t)) shared.add(t);
  }
  return shared;
}

// Split a doc body into H1 blocks only. `^#[ \t]+` matches a line that opens
// with exactly one `#` followed by whitespace — `##`/`###` do not match because
// the char after the first `#` is another `#`, not whitespace.
function splitH1Blocks(body: string): string[] {
  if (!body.trim()) return [];
  return body
    .split(/(?=^#[ \t]+)/m)
    .map((p) => p.trim())
    .filter((p) => /^#[ \t]+/.test(p));
}

export function firstH1Heading(block: string): string {
  const m = /^#[ \t]+(.+?)[ \t]*$/m.exec(block);
  return m ? m[1].trim() : "";
}

/**
 * Extract the H1 sections of one standardized markdown document.
 * Frontmatter is stripped; `topic` is read from frontmatter unless overridden.
 */
export function extractH1Sections(
  markdown: string,
  docName: string,
  docIndex: number,
  topicOverride?: string
): DocSection[] {
  const { data, body } = parseFrontmatter(markdown);
  const topic = (topicOverride || data?.topic || "").toString();
  const blocks = splitH1Blocks(body);
  return blocks.map((text, i) => ({
    doc_index: docIndex,
    doc_name: docName,
    topic,
    section_index: i,
    heading: firstH1Heading(text),
    text,
    token_count: countTokens(text),
  }));
}

type Vec = Map<string, number>;

function buildTfIdfVectors(sections: DocSection[]): Vec[] {
  const docsTokens = sections.map((s) => tokenize(s.text));
  const N = sections.length;

  // Document frequency per term.
  const df = new Map<string, number>();
  for (const toks of docsTokens) {
    const seen = new Set<string>();
    for (const t of toks) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    // Smoothed idf, always positive so a term shared by all sections still
    // contributes a little rather than zeroing out.
    idf.set(term, Math.log((N + 1) / (freq + 1)) + 1);
  }

  return docsTokens.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec: Vec = new Map();
    for (const [term, f] of tf) {
      vec.set(term, f * (idf.get(term) ?? 0));
    }
    return vec;
  });
}

function cosine(a: Vec, b: Vec): number {
  if (!a.size || !b.size) return 0;
  // Iterate the smaller vector for the dot product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const o = large.get(term);
    if (o) dot += w * o;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const w of a.values()) na += w * w;
  let nb = 0;
  for (const w of b.values()) nb += w * w;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export type CandidateOptions = {
  threshold?: number; // min cosine to be a candidate (default 0.12)
  maxPairs?: number; // cap sent to the LLM judge (default 80)
};

/**
 * Find cross-document H1 section pairs that look topically similar. Same-doc
 * pairs are skipped — duplicate sections within one doc are a single-doc concern
 * the existing validators already cover. Returns the highest-similarity pairs
 * first, capped to bound LLM judge cost.
 */
export function findCandidatePairs(
  sections: DocSection[],
  opts: CandidateOptions = {}
): CandidatePair[] {
  const threshold = opts.threshold ?? 0.12;
  const maxPairs = opts.maxPairs ?? 80;
  if (sections.length < 2) return [];

  const vecs = buildTfIdfVectors(sections);
  const pairs: CandidatePair[] = [];

  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[i].doc_index === sections[j].doc_index) continue; // cross-doc only
      const sim = cosine(vecs[i], vecs[j]);
      if (sim < threshold) continue;
      const a = sections[i];
      const b = sections[j];
      pairs.push({
        pair_id: `${a.doc_index}:${a.section_index}__${b.doc_index}:${b.section_index}`,
        a,
        b,
        similarity: Math.round(sim * 10000) / 10000,
      });
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs.slice(0, maxPairs);
}

export type ReplaceResult = {
  markdown: string; // the (possibly) updated document
  replaced: boolean; // false when the original block could not be located
};

/**
 * Replace one H1 section's text inside a full markdown document. Matches the
 * original (trimmed) section block as a literal substring and swaps in the new
 * text. When the block can't be located the markdown is returned unchanged with
 * `replaced: false` so callers can detect a no-op instead of silently assuming
 * success (e.g. when the section was already rewritten by an earlier pair).
 */
export function replaceH1Section(
  fullMarkdown: string,
  originalSectionText: string,
  newSectionText: string
): ReplaceResult {
  const needle = originalSectionText.trim();
  const idx = fullMarkdown.indexOf(needle);
  if (idx === -1) return { markdown: fullMarkdown, replaced: false };
  const markdown =
    fullMarkdown.slice(0, idx) +
    newSectionText.trim() +
    fullMarkdown.slice(idx + needle.length);
  return { markdown, replaced: true };
}

/**
 * Remove one H1 section entirely from a document. Used when the judge decides
 * one side of a pair is non-dominant (a shallow mention) and the other doc
 * already covers the topic in depth — e.g. a Product course briefly mentions
 * modal while a dedicated Modal course explains the mechanism, so the Product
 * doc's modal chunk is dropped rather than rewritten.
 *
 * Locates the section as a literal substring, then also swallows surrounding
 * blank lines so the splice doesn't leave a double gap. Returns
 * `removed: false` (markdown unchanged) when the section can't be located,
 * mirroring replaceH1Section so callers can detect a stale no-op.
 */
export function deleteH1Section(
  fullMarkdown: string,
  sectionText: string
): { markdown: string; removed: boolean } {
  const needle = sectionText.trim();
  const idx = fullMarkdown.indexOf(needle);
  if (idx === -1) return { markdown: fullMarkdown, removed: false };

  const spliced =
    fullMarkdown.slice(0, idx) + fullMarkdown.slice(idx + needle.length);
  // Collapse the gap the removal leaves (3+ newlines → blank line) and
  // normalize the trailing edge so the doc ends with a single newline.
  const markdown = spliced.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { markdown, removed: true };
}

/**
 * Validate a single rewritten H1 section against the same RAG-compliance rules
 * the Studio flow enforces, so dedup output isn't trusted blindly. Wraps the
 * section in throwaway frontmatter (the section itself has none) and keeps only
 * body-level checks — entity presence, token range, bridge sentences, heading.
 * Frontmatter-completeness issues are filtered out since a bare section has no
 * frontmatter of its own.
 */
export function validateSection(
  sectionText: string,
  entityName: string
): ValidationIssue[] {
  const wrapped = `---\ndepartment: x\ntopic: x\ncourse_id: 0\ncourse_name: x\n---\n\n${sectionText.trim()}\n`;
  const issues = validateMarkdown(wrapped, { entityName });
  return issues.filter((i) => i.check !== "frontmatter");
}
