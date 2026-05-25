// POST /api/parse/start
// Accepts multipart/form-data with `file` + `filename` + optional
// `parsing_instruction`. Forwards to LlamaParse using the server-only
// LLAMA_CLOUD_API_KEY and returns the job_id to the client.
//
// File size is bounded by Vercel's function body cap (~4.5 MB on Hobby).
// lib/compress.ts shrinks PDFs/PPTX below that before upload.

import { NextResponse } from "next/server";
import { startParseJob } from "@/lib/llamaparse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const filename = formData.get("filename")?.toString() || "";
  const parsingInstruction =
    formData.get("parsing_instruction")?.toString() || undefined;

  if (!(file instanceof Blob) || !filename) {
    return NextResponse.json(
      { error: "Missing file or filename" },
      { status: 400 }
    );
  }
  if (!filename.toLowerCase().match(/\.(pptx?|ppt|pdf)$/)) {
    return NextResponse.json(
      { error: "Only .pptx / .ppt / .pdf files are supported" },
      { status: 400 }
    );
  }

  try {
    const result = await startParseJob(file, filename, parsingInstruction);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
