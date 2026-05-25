// YAML frontmatter parsing — mirrors A-Pedi's _parse_frontmatter behavior.
// Returns { data, body } where data is the parsed YAML object (or null if missing)
// and body is the markdown content after the closing ---.
import { parse as yamlParse } from "yaml";

export type Frontmatter = {
  department?: string;
  topic?: string;
  course_id?: number | string;
  course_name?: string;
};

export function parseFrontmatter(markdown: string): {
  data: Frontmatter | null;
  body: string;
} {
  if (!markdown) return { data: null, body: "" };
  const stripped = markdown.replace(/^\s+/, "");
  if (!stripped.startsWith("---")) return { data: null, body: markdown };
  const endIdx = stripped.indexOf("---", 3);
  if (endIdx === -1) return { data: null, body: markdown };
  const yamlBlock = stripped.slice(3, endIdx).trim();
  const body = stripped.slice(endIdx + 3).replace(/^\s+/, "");
  try {
    const data = yamlParse(yamlBlock) as Frontmatter | null;
    if (!data || typeof data !== "object") return { data: null, body };
    return { data, body };
  } catch {
    return { data: null, body };
  }
}

export function buildFrontmatterBlock(fm: Required<Frontmatter>): string {
  return `---
department: "${fm.department}"
topic: "${fm.topic}"
course_id: ${fm.course_id}
course_name: "${fm.course_name}"
---
`;
}
