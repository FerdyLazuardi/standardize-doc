// POST /api/apply-suggestion
import { NextRequest, NextResponse } from "next/server";
import { chunkMarkdown } from "@/lib/chunking";
import { insertTermIntoChunkText } from "@/lib/suggestions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      markdown?: string;
      chunk_index?: number;
      term?: string;
    };
    if (!body.markdown || body.chunk_index === undefined || !body.term) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const chunks = chunkMarkdown(body.markdown);
    if (body.chunk_index < 0 || body.chunk_index >= chunks.length) {
      return NextResponse.json({ markdown: body.markdown, applied: false });
    }
    const target = chunks[body.chunk_index].text;
    const updated = insertTermIntoChunkText(target, body.term);
    if (updated === target) {
      return NextResponse.json({ markdown: body.markdown, applied: false });
    }
    const newMd = body.markdown.replace(target, updated);
    return NextResponse.json({ markdown: newMd, applied: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
