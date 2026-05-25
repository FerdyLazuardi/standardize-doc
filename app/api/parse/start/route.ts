// POST /api/parse/start
// Body: { blob_url: string, filename: string, parsing_instruction?: string }
//
// Fetches the file from Vercel Blob (no body cap because the file never traverses
// the Vercel function as request body — we GET it from Blob). Forwards to
// LlamaParse, returns the job_id to the client, and deletes the Blob immediately
// to keep storage near zero.

import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { startParseJob } from "@/lib/llamaparse";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  blob_url: string;
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
  if (!body.blob_url || !body.filename) {
    return NextResponse.json(
      { error: "Missing blob_url or filename" },
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
    // Pull the file bytes from Blob storage.
    const fileRes = await fetch(body.blob_url);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `Could not fetch blob: ${fileRes.status}` },
        { status: 502 }
      );
    }
    const fileBlob = await fileRes.blob();

    // Forward to LlamaParse using the existing server-side helper.
    const result = await startParseJob(
      fileBlob,
      body.filename,
      body.parsing_instruction || undefined
    );

    // Best-effort cleanup. If this fails, Blob still purges via free-tier
    // storage limits, so we don't fail the parse.
    try {
      await del(body.blob_url);
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
