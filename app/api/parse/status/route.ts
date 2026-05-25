// GET /api/parse/status?job_id=xxx
import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/llamaparse";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }
  try {
    const result = await getJobStatus(jobId);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
