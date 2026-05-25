// POST /api/validate
import { NextRequest, NextResponse } from "next/server";
import { summarizeIssues, validateMarkdown } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      markdown?: string;
      entity_name?: string;
      min_tokens?: number;
      max_tokens?: number;
    };
    if (!body.markdown) {
      return NextResponse.json({ error: "Missing markdown" }, { status: 400 });
    }
    const issues = validateMarkdown(body.markdown, {
      entityName: body.entity_name,
      minTokens: body.min_tokens,
      maxTokens: body.max_tokens,
    });
    return NextResponse.json({
      issues,
      summary: summarizeIssues(issues),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
