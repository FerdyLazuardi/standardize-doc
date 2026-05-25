// Vendor-agnostic LLM client for the standardizer call.
// Calls any OpenAI-compatible /chat/completions endpoint and streams back
// raw markdown deltas. Server-only — uses LLM_API_KEY.
//
// Compatible providers (set LLM_BASE_URL accordingly):
//   - OpenRouter:        https://openrouter.ai/api/v1
//   - Google AI Studio:  https://generativelanguage.googleapis.com/v1beta/openai
//   - Anthropic Claude:  https://api.anthropic.com/v1  (via OpenAI-compat)
//   - OpenAI direct:     https://api.openai.com/v1
//   - Ollama (local):    http://localhost:11434/v1

import { ASKFER_RAG_STANDARDIZER_SYSTEM_PROMPT } from "./standardizer-prompt";

export type StandardizeInput = {
  rawMarkdown: string;
  department: string;
  topic: string;
  course_id: string | number;
  course_name: string;
  entity_name: string;
  doc_type: string;
  usePro?: boolean;
};

function buildUserMessage(i: StandardizeInput): string {
  return `Convert the raw markdown below into RAG-optimized markdown for A-Pedi ingestion.

Use these inputs verbatim in the YAML frontmatter:
- department: "${i.department}"
- topic: "${i.topic}"
- course_id: ${i.course_id}
- course_name: "${i.course_name}"

Entity Name to use throughout the body: **${i.entity_name}**

Document Type to apply: **${i.doc_type}**
(Templates: "Policy / Compliance" | "Company Profile / Culture" | "Procedure / SOP")

Strict rules:
- Output ONLY the final standardized markdown. NO commentary, NO code fences (\`\`\`), NOT even around the YAML frontmatter. The first line of your output MUST be \`---\` with no \`\`\`yaml line before it. Never wrap any part of the output in triple backticks.
- Start with the YAML frontmatter (the \`---\` block). The frontmatter MUST contain all four fields above with the exact values supplied.
- Apply the matching document-type template.
- Adhere to all 4 core principles + the 7-point self-check.

## LANGUAGE PRESERVATION (CRITICAL — failures here are unacceptable)

Write the ENTIRE standardized markdown — including every heading, every paragraph, every bullet, every bridge sentence — in the SAME natural language as the source raw markdown below.

- If the source is Bahasa Indonesia → output 100% Bahasa Indonesia. Every word.
- If the source mixes languages → follow the DOMINANT language of the source body content.
- **NEVER translate any part to English.** Not even the template scaffolding phrases.
- Template phrases must be translated into the source language. For Bahasa Indonesia source, use these Indonesian equivalents instead of English template phrases:
  - "About [X] — [Entity]" → "Tentang [X] — [Entity]"
  - "Summary of [N] Principles of [X] at [Entity]" → "Ringkasan [N] Prinsip [X] di [Entity]"
  - "Principle [N]: ..." → "Prinsip [N]: ..."
  - "As part of ... at [Entity]" → "Sebagai bagian dari ... di [Entity]"
  - "Here is the implementation of [X] at [Entity]:" → "Berikut adalah penerapan [X] di [Entity]:"
  - "Requirements for [X] at [Entity]" → "Persyaratan [X] di [Entity]"
  - "Steps for [X] at [Entity]" → "Langkah-langkah [X] di [Entity]"
  - "Contact and Escalation" → "Kontak dan Eskalasi"
  - "Company Profile & Vision-Mission" → "Profil Perusahaan & Visi-Misi"
  - "Business Model & Services" → "Model Bisnis & Layanan"
  - "Core Values and Culture" → "Nilai-Nilai Inti dan Budaya"
- A heading mixing English template + Indonesian topic (e.g., "About Pelecehan Seksual") is WRONG. Make it fully Indonesian: "Tentang Pelecehan Seksual di Amartha".
- Self-check before outputting: scan every heading and paragraph. If you see English template words ("About", "Summary", "Steps", "Requirements", "Here is", "As part of") and the source is Indonesian, replace them with Indonesian.

<raw_markdown>
${i.rawMarkdown}
</raw_markdown>
`;
}

/**
 * Streams the LLM completion. Returns a ReadableStream of raw delta text
 * (already extracted from SSE). The route handler pipes this to the client.
 */
export async function streamStandardize(
  input: StandardizeInput
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
      temperature: 0,
      messages: [
        { role: "system", content: ASKFER_RAG_STANDARDIZER_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`LLM call failed: ${upstream.status} ${text}`);
  }

  // Parse SSE → emit raw delta text chunks. Strip wrapping ``` if model adds it.
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
