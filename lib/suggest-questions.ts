// LLM-generated FAQ-style question suggestions for the Retrieval test panel.
// Server-only. Returns plain JSON array of question strings in the document's source language.

const QUESTION_GEN_SYSTEM_PROMPT = `# SYSTEM INSTRUCTION: FAQ Question Generator for RAG Retrieval Testing

You generate realistic FAQ-style search queries that an end user would type to retrieve information from the given document. The questions are used to manually test the document's RAG retrieval quality.

## Strict rules

1. Output ONLY a JSON array of strings. No commentary, no code fences, no leading/trailing text.
2. Generate exactly 6 questions, ordered from most likely to least likely query.
3. Use the SAME natural language as the document body. Bahasa Indonesia stays Bahasa Indonesia. Mixed → use the dominant language. Never translate to English.
4. Questions must be answerable from the document content — base them on actual H1 headings, key terms, contact details, principles, steps, or benefits present in the markdown.
5. Mix question shapes: at least one "what is" / "apa itu", one "how to" / "bagaimana cara", one specific lookup (a contact, a step number, a principle name), and one comparison or benefit question if the content allows.
6. Keep each question short (under 12 words ideally). No question marks at the end? Optional — natural style is fine.

## Examples (style only — do not copy verbatim)

["Apa itu Client Protection di Amartha?", "Bagaimana cara melaporkan pelecehan?", "Siapa kontak HR untuk klaim?", ...]
`;

export type QuestionSuggestionInput = {
  markdown: string;
  entity_name: string;
  topic: string;
  usePro?: boolean;
};

function buildUserMessage(i: QuestionSuggestionInput): string {
  return `Generate 6 FAQ-style retrieval test queries for the following document.

Entity: ${i.entity_name}
Topic: ${i.topic}

Output strictly as a JSON array of strings, in the document's natural language.

<markdown>
${i.markdown}
</markdown>
`;
}

export async function generateQuestionSuggestions(
  input: QuestionSuggestionInput
): Promise<string[]> {
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
      temperature: 0.4,
      messages: [
        { role: "system", content: QUESTION_GEN_SYSTEM_PROMPT },
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
    // Last-ditch: try to find the first [...] in the response
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("LLM did not return valid JSON");
    parsed = JSON.parse(m[0]);
  }

  if (!Array.isArray(parsed)) throw new Error("LLM did not return a JSON array");
  return parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
}
