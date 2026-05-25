// Heuristic per-chunk keyword suggestions.
// Direct port of backend/app/suggestions/heuristics.py + apply.py.

import type { Chunk } from "./chunking";

const PROJECT_ALIASES: Record<string, string[]> = {
  "client protection": ["TCP", "Training Client Protection"],
  "anti harassment": ["Anti-Harassment"],
  "modal cycle zero": ["Modal", "Cycle Zero"],
  "amartha system architecture": ["ASA"],
  "amarthafin": ["AmarthaFin"],
  "agent network": ["AmarthaLink Agent"],
  "belajar tulang skuy": ["BTS"],
  "ai learning assistant": ["A-Pedi", "Amarthapedia"],
};

const QUESTION_HOOKS: [string, string[]][] = [
  ["definisi", ["pengertian", "what is", "apa itu"]],
  ["definition", ["pengertian", "definisi", "apa itu"]],
  ["prosedur", ["procedure", "langkah", "steps", "cara"]],
  ["procedure", ["prosedur", "langkah", "steps"]],
  ["policy", ["kebijakan", "aturan", "rules"]],
  ["kebijakan", ["policy", "aturan", "rules"]],
  ["compliance", ["kepatuhan", "wajib", "mandatory"]],
  ["kepatuhan", ["compliance", "wajib"]],
];

const ROLE_TAGS = [
  "Field Officer",
  "FO",
  "Business Partner",
  "BP",
  "A-Team",
  "Head Office",
  "HO",
  "Agent Partner",
];

const METRIC_LABEL_HINTS: [RegExp, string[]][] = [
  [/\d+\s*%/, ["completion rate", "tingkat penyelesaian", "satisfaction", "N-Gain"]],
  [/N-?Gain/i, ["learning gain", "Hake's normalized gain"]],
  [/\bpre-?test\b/i, ["post-test", "baseline"]],
];

export type SuggestionCategory =
  | "entity_alias"
  | "role_tag"
  | "question_hook"
  | "metric_label";

export type Suggestion = {
  chunk_index: number;
  category: SuggestionCategory;
  severity: "warn" | "info";
  message: string;
  suggested_terms: string[];
};

function hasTerm(text: string, term: string): boolean {
  if (!term) return false;
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}

export function suggestForChunks(
  chunks: Chunk[],
  opts: { topic?: string; entityName?: string; enableRoleTags?: boolean } = {}
): Suggestion[] {
  const topicLower = (opts.topic ?? "").toLowerCase().trim();
  const enableRoleTags = opts.enableRoleTags ?? true;

  let aliasBucket: string[] = [];
  if (topicLower) {
    for (const [key, aliases] of Object.entries(PROJECT_ALIASES)) {
      if (
        topicLower.includes(key) ||
        aliases.some((a) => a.toLowerCase() === topicLower)
      ) {
        aliasBucket = [key, ...aliases];
        break;
      }
    }
  }

  const out: Suggestion[] = [];

  for (const c of chunks) {
    const text = c.text || "";
    const idx = c.chunk_index;

    // 1. entity_alias
    for (const alias of aliasBucket) {
      if (alias && !hasTerm(text, alias)) {
        out.push({
          chunk_index: idx,
          category: "entity_alias",
          severity: "warn",
          message: `Chunk does not mention \`${alias}\` (alias of \`${opts.topic}\`).`,
          suggested_terms: [alias],
        });
        break;
      }
    }

    // 2. question_hook
    for (const [trigger, suggestions] of QUESTION_HOOKS) {
      if (hasTerm(text, trigger)) {
        const missing = suggestions.filter((s) => !hasTerm(text, s));
        if (missing.length) {
          out.push({
            chunk_index: idx,
            category: "question_hook",
            severity: "info",
            message: `Chunk discusses \`${trigger}\` but lacks query-friendly synonyms.`,
            suggested_terms: missing.slice(0, 3),
          });
        }
        break;
      }
    }

    // 3. role_tag
    if (enableRoleTags) {
      const looksProcedure = /(?:steps?|langkah|prosedur|how to|cara)\b/i.test(text);
      if (looksProcedure) {
        if (!ROLE_TAGS.some((r) => hasTerm(text, r))) {
          out.push({
            chunk_index: idx,
            category: "role_tag",
            severity: "info",
            message: "Procedure-style chunk doesn't name a target role/audience.",
            suggested_terms: ["Field Officer", "FO", "BP", "A-Team"],
          });
        }
      }
    }

    // 4. metric_label
    for (const [pat, hints] of METRIC_LABEL_HINTS) {
      if (pat.test(text)) {
        const missing = hints.filter((h) => !hasTerm(text, h));
        if (missing.length === hints.length) {
          out.push({
            chunk_index: idx,
            category: "metric_label",
            severity: "info",
            message: "Chunk has metric values without explanatory labels.",
            suggested_terms: missing.slice(0, 2),
          });
        }
        break;
      }
    }
  }

  return out;
}

export function insertTermIntoChunkText(text: string, term: string): string {
  if (!text || !term) return text;
  if (hasTerm(text, term)) return text;

  const lines = text.split("\n");
  if (!lines.length) return term;

  if (lines[0].startsWith("# ")) {
    const h1 = lines[0];
    if (h1.length < 80 && !h1.includes("(")) {
      lines[0] = `${h1} (${term})`;
      return lines.join("\n");
    }
    lines.splice(1, 0, "", `This section is also known by the term **${term}**.`);
    return lines.join("\n");
  }

  return `This section relates to **${term}**.\n\n${text}`;
}
