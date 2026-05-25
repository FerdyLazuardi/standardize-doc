// Auto-fix LLM call for RAG compliance issues (shrink oversized H1s, merge undersized H1s).
// Server-only. Streams fixed markdown back as text.

export type AutoFixAction = {
  type: "shrink" | "merge_short" | "rewrite" | "fix_frontmatter";
  location: string;
  current_tokens: number;
  message: string;
};

const AUTO_FIX_SYSTEM_PROMPT = `# SYSTEM INSTRUCTION: Targeted RAG Markdown Fixer

You are an aggressive markdown editor. Your job is to apply the listed compliance fixes EFFECTIVELY. Returning the same input back unchanged is FAILURE. Your output MUST visibly differ from the input in the named sections, and MUST satisfy all the rules below.

## Strict rules — every output must pass

1. Output ONLY the corrected full markdown. NO commentary, NO code fences (\`\`\`). The first line must be \`---\`.
2. Preserve the YAML frontmatter EXACTLY — every key, every value, every line. Never edit, reorder, or drop frontmatter fields.
3. Preserve the original natural language. If input is Bahasa Indonesia, output Bahasa Indonesia. NEVER translate to English.
4. Every \`#\` H1 chunk MUST end up between 70 and 280 tokens. NEVER exceed 512.
5. The entity name MUST appear in every \`#\` H1 chunk's body text.
6. Every bullet list MUST be immediately preceded by a sentence ending with \`:\`.

## How to apply each fix type

- **shrink** (chunk > 280 tokens, especially > 512): you MUST aggressively shorten this H1 section. Apply in this order:
  1. **Rewrite tightly.** Replace verbose phrases with concise equivalents. Drop filler ("merupakan suatu", "perlu diketahui bahwa", "secara umum", "dengan demikian", "in order to", "it is important to note", "as we have seen"). Combine short sentences. Cut all redundancy. Keep the entity name and bridge sentences.
  2. **Split into multiple H1 sections** when shrinking alone cannot reach 280 tokens without losing facts. This is REQUIRED for chunks over 512. Each new H1 must:
     - include the entity name in its body
     - be 70-280 tokens
     - have bridge sentences (ending \`:\`) before any bullet list
     - keep all factual content from the original (no fact deletion — distribute facts across sections)
     - use natural breakpoints (a list of N principles → N H1 sections; "definition + implementation" → 2 sections; etc.)
  3. NEVER leave the named chunk over 280 tokens. NEVER leave any chunk over 512 tokens.

- **merge_short** (chunk < 70 tokens): merge into the immediately preceding \`#\` H1 section as bold inline text (e.g., \`**Heading Name:** body...\`) at the end. Remove the original \`#\` line. Combined section must stay ≤280 tokens; if it would overflow, instead expand the short section's body inline with 1-2 sentences (source language) using the entity name to lift it above 70 tokens.

- **rewrite — entity injection** (message: "Entity name ... is not mentioned in this section's body"): insert a contextual sentence at the TOP of that section's body, in the source language, explicitly using the entity. Examples (Bahasa Indonesia): "Sebagai bagian dari [topic] di [Entity], ..." or "Berikut adalah ketentuan [topic] di [Entity]:". Do NOT just rename the heading.

- **rewrite — bridge sentence** (message: "A bullet list lacks an introductory bridge sentence"): scan EVERY bulleted list inside the named section. For each list, check the immediately-preceding non-empty line. If that line does NOT end with \`:\`, insert a bridge sentence on its own line right before the first bullet. Bridge sentences MUST end with \`:\`. Source-language examples:
  - "Berikut adalah penerapannya di [Entity]:"
  - "Manfaat bagi [pihak] di [Entity]:"
  - "Persyaratan yang harus dipenuhi:"
  Do NOT modify the bullets themselves. After all insertions, verify top-to-bottom that every bullet list has a bridge sentence directly above.

- **rewrite — other**: rewrite minimally to address the specific issue described.

## Pre-output verification (MANDATORY)

Before emitting your output, mentally scan your draft and verify:
1. Every fix from the list was actually applied — open the named section, check the rule changed.
2. No \`#\` chunk exceeds 280 tokens (count: ~280 tokens ≈ 210 words ≈ 1100 chars).
3. Every bullet list has a bridge sentence ending with \`:\` immediately above.
4. Entity name appears in every \`#\` body.
5. YAML frontmatter unchanged.
6. Output is in the source language. No English template phrases injected if source is Indonesian.

If any check fails, REWRITE that part before outputting. Returning the original markdown unchanged is unacceptable.
`;

export type AutoFixInput = {
  markdown: string;
  fixes: AutoFixAction[];
  entity_name: string;
  usePro?: boolean;
};

function buildUserMessage(i: AutoFixInput): string {
  const fixesList = i.fixes
    .map(
      (f, idx) =>
        `${idx + 1}. **${f.type}** at \`${f.location}\` — currently ${f.current_tokens} tokens. ${f.message}`
    )
    .join("\n");

  return `Apply the following compliance fixes to the markdown below.

Entity name (must remain present in every remaining H1 body): **${i.entity_name}**

Fixes to apply:
${fixesList}

Output the FULL corrected markdown, including the unchanged YAML frontmatter and all unchanged sections. Do not include any commentary.

<markdown>
${i.markdown}
</markdown>
`;
}

export async function streamAutoFix(
  input: AutoFixInput
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const defaultModel = process.env.LLM_MODEL || "google/gemini-2.5-flash";
  const proModel = process.env.LLM_MODEL_PRO || defaultModel;

  if (!apiKey) throw new Error("LLM_API_KEY not configured");

  const model = input.usePro ? proModel : defaultModel;

  const upstream = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.2,
      messages: [
        { role: "system", content: AUTO_FIX_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`LLM call failed: ${upstream.status} ${text}`);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let firstChunkSeen = false;
  let inOpeningFence = false;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          controller.terminate();
          return;
        }
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
          let delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (!delta) continue;

          if (!firstChunkSeen) {
            firstChunkSeen = true;
            if (delta.startsWith("```")) {
              const nl = delta.indexOf("\n");
              if (nl !== -1) {
                delta = delta.slice(nl + 1);
              } else {
                inOpeningFence = true;
                continue;
              }
            }
          } else if (inOpeningFence) {
            const nl = delta.indexOf("\n");
            if (nl !== -1) {
              delta = delta.slice(nl + 1);
              inOpeningFence = false;
            } else {
              continue;
            }
          }

          if (delta) controller.enqueue(encoder.encode(delta));
        } catch {
          // skip malformed line
        }
      }
    },
    flush(controller) {
      controller.terminate();
    },
  });

  return upstream.body.pipeThrough(transform);
}
