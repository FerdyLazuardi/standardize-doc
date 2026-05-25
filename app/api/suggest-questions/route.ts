// POST /api/suggest-questions
// Edge runtime — generates FAQ-style retrieval test queries from the standardized markdown.
import { generateQuestionSuggestions } from "@/lib/suggest-questions";

export const runtime = "edge";

type Body = {
  markdown: string;
  entity_name?: string;
  topic?: string;
  use_pro?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body?.markdown) {
    return new Response(JSON.stringify({ error: "Missing markdown" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const questions = await generateQuestionSuggestions({
      markdown: body.markdown,
      entity_name: body.entity_name || "Amartha",
      topic: body.topic || "",
      usePro: !!body.use_pro,
    });
    return new Response(JSON.stringify({ questions }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not configured") ? 503 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
