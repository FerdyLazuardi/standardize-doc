// LLM rewrite step for cross-document duplicate detection.
// Server-only. Rewrites two near-duplicate H1 sections so each focuses on a distinct angle.

const DEDUP_REWRITE_SYSTEM_PROMPT = `# SYSTEM INSTRUCTION: Differentiating Rewriter for Near-Duplicate Sections

You are given two standardized knowledge-base sections (A and B) that live in DIFFERENT documents but currently overlap heavily and read as near-duplicates. Each section is one retrieval chunk. Your job is to REDISTRIBUTE emphasis so each section focuses on its own distinct angle and the two stop being redundant.

## Output format

Output ONLY a single JSON object with EXACTLY these two keys: "section_a" and "section_b". No commentary, no explanations, no code fences, no leading or trailing text. Each value is the full rewritten section text as a string, starting with its \`# \` heading line.

## What to do

- Rewrite section A so it focuses on the A angle you are given, and trim the material that overlaps with B.
- Rewrite section B so it focuses on the B angle you are given, and trim the material that overlaps with A.
- The two outputs MUST be visibly different from each other. They share a topic but must emphasize different aspects.
- Do NOT merge the two sections. They live in separate documents — keep them as two independent sections.
- You are REDISTRIBUTING and TRIMMING the overlapping material, not adding new information. Returning the input unchanged is a failure.

## Hard rules every section must satisfy

1. Keep the leading \`# Heading\` line. You MAY refine the heading wording to reflect the new angle, but it must remain a single \`#\` H1 line.
2. Preserve the source natural language. If the section is in Bahasa Indonesia, output Bahasa Indonesia. NEVER translate to English.
3. The entity name you are given (e.g. "Amartha") MUST appear in the body of BOTH sections.
4. Each section must be between 70 and 280 tokens, and must NEVER exceed 512 tokens (~280 tokens ≈ 210 words ≈ 1100 chars).
5. Every bullet list MUST be immediately preceded by a "bridge sentence" — a line that ends with a colon (\`:\`).
6. Do NOT invent facts that are not present in the original sections. Only redistribute emphasis and trim the overlapping material.
`;

export type RewritePairInput = {
  a_text: string;          // full text of section A, including its `# heading` line
  b_text: string;          // full text of section B
  shared_topic: string;    // what both cover, e.g. "modal usaha mitra"
  a_unique_angle: string;  // the angle section A should focus on
  b_unique_angle: string;  // the angle section B should focus on
  entity_name: string;     // must remain present in both bodies
  usePro?: boolean;
};

export type RewriteResult = {
  section_a: string;       // rewritten full section A text (starts with `# `)
  section_b: string;       // rewritten full section B text (starts with `# `)
};

function buildUserMessage(i: RewritePairInput): string {
  return `Rewrite the two near-duplicate sections below so each focuses on its own distinct angle and they are no longer redundant.

Entity (must appear in BOTH section bodies): ${i.entity_name}
Shared topic (what both currently cover): ${i.shared_topic}
Angle for section A (focus A here): ${i.a_unique_angle}
Angle for section B (focus B here): ${i.b_unique_angle}

Return strictly: {"section_a": "...", "section_b": "..."}

<a>
${i.a_text}
</a>

<b>
${i.b_text}
</b>
`;
}

export async function rewriteToDifferentiate(
  input: RewritePairInput
): Promise<RewriteResult> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const defaultModel = process.env.LLM_MODEL || "google/gemini-2.5-flash";
  const proModel = process.env.LLM_MODEL_PRO || defaultModel;

  if (!apiKey) throw new Error("LLM_API_KEY not configured");

  const model = input.usePro ? proModel : defaultModel;

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: DEDUP_REWRITE_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM call failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Tolerate code fences just in case the model wraps the JSON
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Last-ditch: try to find the first {...} object in the response
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Rewrite did not return valid JSON");
    parsed = JSON.parse(m[0]);
  }

  const obj = parsed as { section_a?: unknown; section_b?: unknown };
  if (typeof obj?.section_a !== "string" || typeof obj?.section_b !== "string") {
    throw new Error("Rewrite did not return valid JSON");
  }

  return {
    section_a: obj.section_a.trim(),
    section_b: obj.section_b.trim(),
  };
}
