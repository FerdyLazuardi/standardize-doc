// 8-point self-check from the user's RAG-optimization system prompt.
// Direct port of backend/app/validators/rag_compliance.py.

import { parseFrontmatter } from "./frontmatter";
import { countTokens } from "./tokens";

const REQUIRED_FIELDS = ["department", "topic", "course_id", "course_name"] as const;

export type Severity = "error" | "warn" | "info";

export type ValidationIssue = {
  check: string;
  severity: Severity;
  location: string;
  message: string;
};

function getH1Sections(body: string): { title: string; text: string }[] {
  if (!body.trim()) return [];
  const parts = body.split(/(?=^#\s+)/m).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    const firstLine = p.split("\n")[0];
    const m = /^#\s+(.+)$/.exec(firstLine);
    return { title: m ? m[1].trim() : "", text: p };
  });
}

function bulletListBlocks(text: string): { startLine: number; text: string }[] {
  const lines = text.split("\n");
  const blocks: { startLine: number; text: string }[] = [];
  let curStart: number | null = null;
  let cur: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
    if (isBullet) {
      if (curStart === null) curStart = i;
      cur.push(line);
    } else {
      if (cur.length) {
        blocks.push({ startLine: curStart ?? 0, text: cur.join("\n") });
      }
      cur = [];
      curStart = null;
    }
  }
  if (cur.length) blocks.push({ startLine: curStart ?? 0, text: cur.join("\n") });
  return blocks;
}

function hasBridgeSentence(text: string, listStartLine: number): boolean {
  const lines = text.split("\n");
  for (let j = listStartLine - 1; j >= Math.max(0, listStartLine - 3); j--) {
    if (j < 0 || j >= lines.length) continue;
    const ln = lines[j].trim();
    if (!ln) continue;
    if (ln.startsWith("#") || ln.startsWith("-") || ln.startsWith("*") || ln.startsWith("+")) {
      return false;
    }
    if (/^\s*\d+\.\s+/.test(ln)) return false;
    if (ln.endsWith(":")) return true;
    return false;
  }
  return false;
}

function entityPresent(body: string, entity: string): boolean {
  if (!entity) return true;
  return body.toLowerCase().includes(entity.toLowerCase());
}

export function validateMarkdown(
  markdown: string,
  opts: { entityName?: string; minTokens?: number; maxTokens?: number } = {}
): ValidationIssue[] {
  const entity = opts.entityName ?? "";
  const minTokens = opts.minTokens ?? 70;
  const maxTokens = opts.maxTokens ?? 512;

  const issues: ValidationIssue[] = [];
  const { data: fm, body } = parseFrontmatter(markdown);

  // 1. Frontmatter present + complete
  if (!fm) {
    issues.push({
      check: "frontmatter",
      severity: "error",
      location: "top",
      message: "YAML frontmatter is missing or unparseable.",
    });
  }
  for (const field of REQUIRED_FIELDS) {
    const v = fm?.[field];
    if (v === undefined || v === null || v === "") {
      issues.push({
        check: "frontmatter",
        severity: "error",
        location: `frontmatter.${field}`,
        message: `Required field \`${field}\` is missing or empty.`,
      });
    }
  }

  // Stray --- separators
  const dashLines = (markdown.match(/^---\s*$/gm) || []).length;
  if (dashLines > 2) {
    issues.push({
      check: "frontmatter",
      severity: "warn",
      location: "body",
      message: `Found ${dashLines} \`---\` separators; should be exactly 2 (open/close of frontmatter).`,
    });
  }

  // 2 + 4: H1 sections token range + entity presence
  const sections = getH1Sections(body);
  if (!sections.length) {
    issues.push({
      check: "structure",
      severity: "warn",
      location: "body",
      message: "No H1 (`#`) sections found. Document will be a single chunk.",
    });
  }

  for (const sec of sections) {
    const toks = countTokens(sec.text);
    const loc = `# ${sec.title}`;
    if (toks < minTokens) {
      issues.push({
        check: "token_min",
        severity: "warn",
        location: loc,
        message: `Chunk has ${toks} tokens; below the ${minTokens}-token minimum for strong embeddings.`,
      });
    }
    if (toks > maxTokens) {
      issues.push({
        check: "token_max",
        severity: "warn",
        location: loc,
        message: `Chunk has ${toks} tokens; exceeds the ${maxTokens}-token reranker limit.`,
      });
    }
    if (entity && !entityPresent(sec.text, entity)) {
      issues.push({
        check: "entity",
        severity: "warn",
        location: loc,
        message: `Entity name \`${entity}\` is not mentioned in this section's body.`,
      });
    }
  }

  // 3. Subheadings (##) under min_tokens should be merged
  for (const sec of sections) {
    const subBlocks = sec.text.split(/(?=^##\s+)/m);
    for (let i = 1; i < subBlocks.length; i++) {
      const sub = subBlocks[i];
      const subToks = countTokens(sub);
      if (subToks < minTokens) {
        const firstLine = sub.split("\n")[0].trim();
        issues.push({
          check: "merge_short_h2",
          severity: "info",
          location: firstLine,
          message: `H2 subsection has only ${subToks} tokens. Consider merging into parent H1.`,
        });
      }
    }
  }

  // 5. Bullet lists need bridge sentences (one warning per section)
  for (const sec of sections) {
    const blocks = bulletListBlocks(sec.text);
    for (const block of blocks) {
      if (!hasBridgeSentence(sec.text, block.startLine)) {
        issues.push({
          check: "bridge_sentence",
          severity: "info",
          location: `# ${sec.title}`,
          message: "A bullet list lacks an introductory bridge sentence (ending with `:`).",
        });
        break;
      }
    }
  }

  // 7. Explicit contact mention
  if (/\bcontact\s+(us|me)\b/i.test(body)) {
    const hasPhone = /\+?\d[\d\s\-()]{7,}/.test(body);
    const hasEmail = /[\w.%+\-]+@[\w.-]+\.\w+/.test(body);
    if (!hasPhone && !hasEmail) {
      issues.push({
        check: "explicit_contact",
        severity: "info",
        location: "body",
        message: "Mentions of 'contact' but no explicit phone or email found.",
      });
    }
  }

  return issues;
}

export type ValidationSummary = { error: number; warn: number; info: number };

export function summarizeIssues(issues: ValidationIssue[]): ValidationSummary {
  const out: ValidationSummary = { error: 0, warn: 0, info: 0 };
  for (const it of issues) out[it.severity]++;
  return out;
}
