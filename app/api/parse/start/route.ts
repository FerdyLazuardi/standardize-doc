// POST /api/parse/start
// Body: { key: string, filename: string, parsing_instruction?: string }
//
// Fetches the file from R2 (no body cap because the file never traverses the
// Vercel function as request body — we GET it from R2). Forwards to LlamaParse,
// returns the job_id, and deletes the R2 object immediately.

import { NextResponse } from "next/server";
import { deleteObject, fetchObject } from "@/lib/r2";
import { startParseJob } from "@/lib/llamaparse";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  key: string;
  filename: string;
  parsing_instruction?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.key || !body.filename) {
    return NextResponse.json(
      { error: "Missing key or filename" },
      { status: 400 }
    );
  }
  if (!body.filename.toLowerCase().match(/\.(pptx?|ppt|pdf)$/)) {
    return NextResponse.json(
      { error: "Only .pptx / .ppt / .pdf files are supported" },
      { status: 400 }
    );
  }

  try {
    const fileBlob = await fetchObject(body.key);

    const result = await startParseJob(
      fileBlob,
      body.filename,
      body.parsing_instruction || undefined
    );

    // Best-effort cleanup. Free tier R2 has plenty of room if this fails.
    try {
      await deleteObject(body.key);
    } catch {
      // ignore
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
