// POST /api/auto-fix
// Edge runtime — streams the fixed markdown back as text.
import { streamAutoFix, type AutoFixAction } from "@/lib/auto-fix";

export const runtime = "edge";

type Body = {
  markdown: string;
  fixes: AutoFixAction[];
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
  if (!body?.markdown || !Array.isArray(body.fixes) || body.fixes.length === 0) {
    return new Response(JSON.stringify({ error: "Missing markdown or fixes" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const stream = await streamAutoFix({
      markdown: body.markdown,
      fixes: body.fixes,
      entity_name: body.entity_name || "Amartha",
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
