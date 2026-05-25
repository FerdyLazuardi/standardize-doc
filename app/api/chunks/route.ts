// POST /api/chunks
import { NextRequest, NextResponse } from "next/server";
import { chunkMarkdown, summarizeChunks } from "@/lib/chunking";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { markdown?: string };
    if (!body.markdown) {
      return NextResponse.json({ error: "Missing markdown" }, { status: 400 });
    }
    const chunks = chunkMarkdown(body.markdown);
    return NextResponse.json({
      chunks,
      summary: summarizeChunks(chunks),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
