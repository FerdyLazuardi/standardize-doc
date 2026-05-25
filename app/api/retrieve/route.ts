// POST /api/retrieve
import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/bm25";
import { chunkMarkdown } from "@/lib/chunking";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      markdown?: string;
      query?: string;
      top_k?: number;
    };
    if (!body.markdown || !body.query) {
      return NextResponse.json({ error: "Missing markdown or query" }, { status: 400 });
    }
    const chunks = chunkMarkdown(body.markdown);
    const results = search(chunks, body.query, body.top_k ?? 5);
    return NextResponse.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
