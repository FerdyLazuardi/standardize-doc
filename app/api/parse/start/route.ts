// POST /api/parse/start
// DEPRECATED: uploads now go directly from the browser to LlamaParse.
// This route remains as a 410 Gone stub to clearly signal the change to any
// stale client or external integration.
// See lib/llamaparse-client.ts for the active upload path.

export const runtime = "nodejs";

export async function POST() {
  return new Response(
    JSON.stringify({
      error:
        "Direct upload only. The browser uploads files straight to LlamaParse to bypass Vercel's 4.5 MB function body cap. See lib/llamaparse-client.ts.",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    }
  );
}
