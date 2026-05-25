// GET /api/parse/result?job_id=xxx
// Fetch the markdown from LlamaParse, run noise filter, return both raw + cleaned.
import { NextRequest, NextResponse } from "next/server";
import { getJobMarkdown } from "@/lib/llamaparse";
import { defaultConfig, filterNoise } from "@/lib/noise-filter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }
  try {
    const raw = await getJobMarkdown(jobId);
    const { cleaned, stats } = filterNoise(raw, defaultConfig());
    return NextResponse.json({
      raw_markdown: raw,
      cleaned_markdown: cleaned,
      noise_stats: stats,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
