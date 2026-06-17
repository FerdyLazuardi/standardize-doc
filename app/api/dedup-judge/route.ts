// POST /api/dedup-judge
// Edge runtime — LLM-as-judge over cosine-prefiltered candidate section pairs.
// Returns a verdict per pair (duplicate / overlap / distinct + suggested angles).
import { judgeDuplicatePairs, type JudgePairInput } from "@/lib/dedup-judge";

export const runtime = "edge";

type Body = {
  pairs?: JudgePairInput[];
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
  if (!Array.isArray(body?.pairs) || body.pairs.length === 0) {
    return new Response(JSON.stringify({ error: "Missing pairs" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const verdicts = await judgeDuplicatePairs({
      pairs: body.pairs,
      usePro: !!body.use_pro,
    });
    return new Response(JSON.stringify({ verdicts }), {
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
