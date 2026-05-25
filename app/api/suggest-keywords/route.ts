// POST /api/suggest-keywords
import { NextRequest, NextResponse } from "next/server";
import { chunkMarkdown } from "@/lib/chunking";
import { suggestForChunks } from "@/lib/suggestions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      markdown?: string;
      topic?: string;
      entity_name?: string;
      enable_role_tags?: boolean;
    };
    if (!body.markdown) {
      return NextResponse.json({ error: "Missing markdown" }, { status: 400 });
    }
    const chunks = chunkMarkdown(body.markdown);
    const suggestions = suggestForChunks(chunks, {
      topic: body.topic,
      entityName: body.entity_name,
      enableRoleTags: body.enable_role_tags ?? true,
    });
    return NextResponse.json({ suggestions });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
