// POST /api/dedup-rewrite
// Edge runtime — rewrites two near-duplicate sections so each focuses on a distinct angle.
import { rewriteToDifferentiate, type RewritePairInput } from "@/lib/dedup-rewrite";

export const runtime = "edge";

type Body = {
  a_text: string;
  b_text: string;
  shared_topic?: string;
  a_unique_angle?: string;
  b_unique_angle?: string;
  entity_name?: string;
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
  if (
    !body?.a_text ||
    typeof body.a_text !== "string" ||
    !body.a_text.trim() ||
    !body?.b_text ||
    typeof body.b_text !== "string" ||
    !body.b_text.trim()
  ) {
    return new Response(JSON.stringify({ error: "Missing section text" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const input: RewritePairInput = {
      a_text: body.a_text,
      b_text: body.b_text,
      shared_topic: body.shared_topic || "",
      a_unique_angle: body.a_unique_angle || "",
      b_unique_angle: body.b_unique_angle || "",
      entity_name: body.entity_name || "Amartha",
      usePro: !!body.use_pro,
    };
    const result = await rewriteToDifferentiate(input);
    return new Response(JSON.stringify(result), {
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
