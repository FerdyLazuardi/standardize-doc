// POST /api/standardize
// Edge runtime — streams the LLM completion (text/event-stream of raw markdown
// deltas) back to the client. Hobby tier supports streaming responses on Edge
// with no max-duration cap as long as bytes flow.
import { streamStandardize } from "@/lib/llm";

export const runtime = "edge";

type Body = {
  raw_markdown: string;
  department: string;
  topic: string;
  course_id: string | number;
  course_name: string;
  entity_name: string;
  doc_type: string;
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
  if (!body?.raw_markdown || !body.department || !body.topic || !body.course_id || !body.course_name) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const stream = await streamStandardize({
      rawMarkdown: body.raw_markdown,
      department: body.department,
      topic: body.topic,
      course_id: body.course_id,
      course_name: body.course_name,
      entity_name: body.entity_name || "Amartha",
      doc_type: body.doc_type || "Policy / Compliance",
      usePro: !!body.use_pro,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
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
