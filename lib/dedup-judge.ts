// LLM-as-judge for cross-document duplicate detection. Server-only.
//
// Takes the cosine-prefiltered candidate pairs from lib/dedup.ts and asks the
// model to make the final call on each pair: are these two H1 sections actually
// redundant for retrieval, do they merely overlap, or are they distinct? It also
// names the shared topic and proposes a distinct angle for each side, which the
// rewrite step (lib/dedup-rewrite.ts) consumes. Returns plain JSON.

export type JudgePairInput = {
  pair_id: string;
  a_doc: string;
  a_heading: string;
  a_text: string;
  b_doc: string;
  b_heading: string;
  b_text: string;
  cosine: number;
};

export type JudgeVerdict = {
  pair_id: string;
  verdict: "duplicate" | "overlap" | "distinct";
  similarity: number; // 0..1, the model's own judgement (not the cosine)
  shared_topic: string;
  reason: string;
  a_unique_angle: string;
  b_unique_angle: string;
  // Which side covers the shared topic in more depth. "a"/"b" mark a clearly
  // dominant side (the other is a shallow mention safe to drop); "neither"
  // means both treat it substantively and should be differentiated, not cut.
  dominant: "a" | "b" | "neither";
};

const DEDUP_JUDGE_SYSTEM_PROMPT = `# SYSTEM INSTRUCTION: RAG Duplicate-Context Judge

You compare pairs of knowledge-base sections that were pre-flagged as topically similar. Each section is one retrieval chunk from a course document in Amartha's internal knowledge base (A-Pedi). Your job is to decide, for each pair, whether the two chunks are REDUNDANT for retrieval — i.e. a user query about the shared topic would pull both and get near-identical information.

## Decision lens — judge by PURPOSE, not by shared words

The cosine prefilter only measured vocabulary overlap, so many pairs share words while doing completely different jobs. Before you assign a verdict, first identify each section's FUNCTIONAL ROLE — the job it does for the reader. Common roles:

- **policy/principle**: states a rule, principle, or standard and (often) how it is implemented operationally — who executes it, in which unit (e.g. HO/FO), under what procedure.
- **product/feature overview**: a catalog-style summary describing a product or feature at a glance.
- **procedure/how-to**: ordered steps, requirements, or mechanisms to do something.
- **definition/concept**: explains what a term or concept means.
- **FAQ/scenario**: answers a specific question or handles a specific case.

Rules of thumb:
- Two sections with DIFFERENT roles are almost never "duplicate", even when they share heading words. Example: a "Prinsip: Privacy of Client Data" section (policy + HO/FO implementation) and a "Keamanan dan Perlindungan Pengguna" section inside a product catalog (overview) share vocabulary but answer different questions → "distinct", or at most "overlap" if there is genuine shared teaching.
- Redundancy ("duplicate") requires SAME role AND same teaching about the same topic. Same topic but different role is "overlap" at most.
- A section that names concrete operational specifics (executor units like HO/FO, named procedures, thresholds, numbers) is doing a different job than a generic overview that merely mentions the topic — do not flatten the two into "duplicate".

## Verdict definitions

- **duplicate**: SAME functional role AND the same teaching about the same topic. Keeping both creates redundant retrieval results. Differences are only wording, examples, or length. If the roles differ, it is NOT duplicate.
- **overlap**: They share a topic and a meaningful chunk of content, but each also has a distinct purpose or angle worth keeping (often because their roles differ). Differentiating them (sharpening each toward its own angle) would remove the redundancy.
- **distinct**: They merely mention the same keywords but actually answer different questions, or serve different functional roles. No action needed — the prefilter was a false positive.

## Strict output rules

1. Output ONLY a JSON array. No commentary, no code fences, no leading or trailing text.
2. One object per input pair, each with EXACTLY these keys:
   - "pair_id": copy the pair_id from the input verbatim.
   - "verdict": one of "duplicate", "overlap", "distinct".
   - "similarity": your own number 0.0–1.0 for how redundant they are (1.0 = identical teaching). This is YOUR judgement, not the supplied cosine.
   - "shared_topic": a short phrase (source language) naming what they both cover. Empty string if verdict is "distinct".
   - "reason": one sentence (source language) explaining the verdict.
   - "a_unique_angle": for verdict "duplicate" or "overlap", a short phrase describing the angle section A should focus on so it differs from B (e.g. "kenapa modal penting bagi mitra"). REQUIRED and non-empty for every "duplicate"/"overlap" pair, regardless of the dominant value. Empty string ONLY if "distinct".
   - "b_unique_angle": same, for section B (e.g. "mekanisme & syarat pengajuan modal"). REQUIRED and non-empty for every "duplicate"/"overlap" pair, regardless of the dominant value. Empty string ONLY if "distinct".
   - "dominant": which section covers the shared topic in real depth. "a" if section A is the substantive treatment and B only mentions it shallowly; "b" if B is substantive and A is the shallow mention; "neither" if BOTH cover it substantively (or verdict is "distinct"). A shallow mention = a sentence or two in passing, where the topic is NOT that section's main subject. This is only a HINT for a human reviewer (it offers an optional manual "delete the shallow side" shortcut) — it does NOT mean the shallow side will be dropped automatically, and it does NOT excuse you from filling both angles.
3. The two angles MUST be genuinely different from each other and each faithful to what its own section already emphasises. Do not invent facts not present in the section.
4. Write shared_topic, reason, and angles in the SAME natural language as the sections. Bahasa Indonesia stays Bahasa Indonesia. Never translate to English.
5. Judge conservatively: only "duplicate" when the two share the SAME functional role AND keeping both would clearly harm retrieval. When the roles differ (e.g. policy/principle vs product overview), never say "duplicate" — use "overlap" only if there is real shared teaching, otherwise "distinct". When unsure between overlap and distinct, prefer "distinct" unless there is genuine shared substance beyond shared keywords.
6. Set "dominant" to "a" or "b" ONLY when one side is clearly a shallow mention and the other is the dedicated, in-depth treatment. Treat it as a soft hint for an optional manual delete, NOT a deletion order — the default fix is a differentiating rewrite, so you MUST still provide both unique angles even when one side is dominant. A shorter section is not automatically droppable: a deliberately concise entry (e.g. one product inside a Product Knowledge catalog) is real content, not a stray mention. When both sides genuinely teach the topic, use "neither".

## Example output (style only)

[{"pair_id":"0:2__1:0","verdict":"overlap","similarity":0.72,"shared_topic":"modal usaha mitra","reason":"Keduanya menjelaskan modal mitra, tetapi satu fokus manfaat dan satu fokus prosedur.","a_unique_angle":"manfaat modal bagi mitra Amartha","b_unique_angle":"syarat dan langkah pengajuan modal","dominant":"neither"},{"pair_id":"0:5__2:1","verdict":"duplicate","similarity":0.9,"shared_topic":"modal mitra","reason":"Course Product menyinggung modal secara ringkas sebagai salah satu produk, sedangkan course Modal membahas mekanismenya secara lengkap.","a_unique_angle":"modal sebagai salah satu produk Amartha","b_unique_angle":"mekanisme & syarat pengajuan modal","dominant":"b"},{"pair_id":"0:7__3:4","verdict":"distinct","similarity":0.2,"shared_topic":"","reason":"Section A adalah prinsip kebijakan beserta implementasinya di HO/FO, sedangkan section B hanya overview keamanan dalam katalog produk — peran berbeda walau banyak kata sama.","a_unique_angle":"","b_unique_angle":"","dominant":"neither"}]
`;

export type JudgeInput = {
  pairs: JudgePairInput[];
  usePro?: boolean;
};

function buildUserMessage(pairs: JudgePairInput[]): string {
  const blocks = pairs
    .map((p, idx) => {
      return `### Pair ${idx + 1} — pair_id: ${p.pair_id} (cosine ${p.cosine.toFixed(
        2
      )})

[Section A] document: "${p.a_doc}" — heading: "${p.a_heading}"
<a>
${p.a_text}
</a>

[Section B] document: "${p.b_doc}" — heading: "${p.b_heading}"
<b>
${p.b_text}
</b>`;
    })
    .join("\n\n---\n\n");

  return `Judge the following ${pairs.length} section pair(s). Return a JSON array with one verdict object per pair, in the same order, copying each pair_id verbatim.

${blocks}`;
}

// Bound a single section's size in the prompt. Sections are usually 70–512
// tokens (~2k chars); this is a safety cap for oversized inputs only.
const MAX_SECTION_CHARS = 4000;

function clampSection(text: string): string {
  if (text.length <= MAX_SECTION_CHARS) return text;
  return text.slice(0, MAX_SECTION_CHARS) + "\n…[truncated]";
}

export async function judgeDuplicatePairs(
  input: JudgeInput
): Promise<JudgeVerdict[]> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
  const defaultModel = process.env.LLM_MODEL || "google/gemini-2.5-flash";
  const proModel = process.env.LLM_MODEL_PRO || defaultModel;

  if (!apiKey) throw new Error("LLM_API_KEY not configured");
  if (!input.pairs.length) return [];

  const model = input.usePro ? proModel : defaultModel;
  const pairs = input.pairs.map((p) => ({
    ...p,
    a_text: clampSection(p.a_text),
    b_text: clampSection(p.b_text),
  }));

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      messages: [
        { role: "system", content: DEDUP_JUDGE_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(pairs) },
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

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("Judge did not return valid JSON");
    parsed = JSON.parse(m[0]);
  }

  if (!Array.isArray(parsed)) throw new Error("Judge did not return a JSON array");

  const validVerdicts = new Set(["duplicate", "overlap", "distinct"]);
  const validDominant = new Set(["a", "b", "neither"]);
  return parsed
    .filter(
      (v): v is JudgeVerdict =>
        !!v &&
        typeof v === "object" &&
        typeof (v as JudgeVerdict).pair_id === "string" &&
        validVerdicts.has((v as JudgeVerdict).verdict)
    )
    .map((v) => ({
      pair_id: v.pair_id,
      verdict: v.verdict,
      similarity:
        typeof v.similarity === "number"
          ? Math.max(0, Math.min(1, v.similarity))
          : 0,
      shared_topic: typeof v.shared_topic === "string" ? v.shared_topic : "",
      reason: typeof v.reason === "string" ? v.reason : "",
      a_unique_angle:
        typeof v.a_unique_angle === "string" ? v.a_unique_angle : "",
      b_unique_angle:
        typeof v.b_unique_angle === "string" ? v.b_unique_angle : "",
      dominant: validDominant.has((v as JudgeVerdict).dominant)
        ? (v as JudgeVerdict).dominant
        : "neither",
    }));
}
