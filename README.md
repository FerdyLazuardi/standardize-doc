# Standardize Knowledge Studio

A web app to convert PowerPoint decks (`.pptx`) into RAG-optimized Markdown for the **A-Pedi** knowledge base.

**Single Next.js app** — deploys to Vercel with zero extra config.

## What it does

- Upload `.pptx` → parse with **LlamaParse** (LlamaIndex Cloud, async via job polling)
- Strip noise (cover slides, "Amartha Confidential" footers, page numbers, thank-you back-cover)
- **Standardize** raw markdown via any **OpenAI-compatible LLM** (default Gemini 2.5 Flash via OpenRouter; swap providers via env vars — streamed via Vercel Edge runtime) using a strict RAG-optimization system prompt
- Validate against an 8-point compliance check (frontmatter, 80–512 token range, entity-in-body, bridge sentences, etc.)
- Preview chunks (mirrors A-Pedi's `MarkdownNodeParser` + 600-token re-split exactly)
- Surface keyword suggestions (entity aliases, role tags, query hooks, metric labels) — click "Apply" to insert
- Local BM25 retrieval test — no Qdrant, no embedding, no LLM
- Download the final `.md` ready for `/ingest/moodle/sync`

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Parser | LlamaParse REST API (async job pattern) |
| LLM | Vendor-agnostic (OpenAI-compatible) — default OpenRouter / Gemini 2.5 Flash, streaming |
| Token counter | `js-tiktoken` (cl100k_base) |
| Markdown chunking | inline TS (mirror of A-Pedi behavior) |
| BM25 | inline TS implementation |
| YAML | `yaml` npm package |
| UI | Monaco editor + Tailwind + Sonner |

**No Python, no Docker, no Postgres.** Everything runs on Vercel Hobby (free tier).

## Quick start

### 1. Configure secrets

```bash
cp .env.example .env.local
```

Then fill in `.env.local`:

```
LLAMA_CLOUD_API_KEY=<get from https://cloud.llamaindex.ai/>
NEXT_PUBLIC_LLAMA_CLOUD_API_KEY=<same key — exposes upload to the browser so files >4.5 MB still work>

# LLM — pick any OpenAI-compatible provider:
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<your key>
LLM_MODEL=google/gemini-2.5-flash
LLM_MODEL_PRO=google/gemini-2.5-pro    # optional, for the "Regenerate" button
```

> **Why the duplicate `NEXT_PUBLIC_*` key?** Vercel Hobby caps serverless function bodies at 4.5 MB, but PPT/PDF decks can be larger. The browser uploads files directly to LlamaParse, bypassing Vercel entirely. The key is scoped to LlamaParse credits — rotate via the LlamaIndex dashboard if it leaks.

Other compatible providers (just swap `LLM_BASE_URL` + `LLM_MODEL`):

| Provider | `LLM_BASE_URL` | `LLM_MODEL` example |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` |
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-sonnet-4-5` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

### 2. Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### 3. Deploy to Vercel

```bash
npm i -g vercel
vercel
# answer prompts (link / new project)
# add LLAMA_CLOUD_API_KEY, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL in Vercel dashboard → Settings → Environment Variables
vercel --prod
```

Done. Single Vercel project, no external services needed.

## Workflow

1. Open the studio.
2. (Optional) Add a `parsing_instruction` to LlamaParse — e.g., "Preserve flowchart steps as a numbered list."
3. Drop a `.pptx`. Studio uploads → LlamaParse async job → polls until done → applies noise filter → shows raw cleaned markdown.
4. Fill the frontmatter form: `department`, `topic`, `course_id`, `course_name`, `entity_name`, `doc_type`.
5. Click **Standardize Markdown**. The configured LLM streams the standardized output token-by-token (visible in real time in the right pane).
6. Studio runs analysis automatically:
   - **Validation** — 8-point compliance summary (errors / warnings / info)
   - **Chunks** — token counts per H1, oversized warnings
   - **Keyword suggestions** — what to add to improve retrievability
   - **Retrieval test** — type a query, see top-K BM25 chunks
7. Click "Apply" on any keyword suggestion to insert the term, or click **Regenerate (Pro model)** for a stronger pass (uses `LLM_MODEL_PRO` if set).
8. **Download .md** when satisfied.

## A-Pedi compatibility

The studio mirrors A-Pedi's chunking exactly:

- Frontmatter schema: `department`, `topic`, `course_id`, `course_name` (read by A-Pedi's `_parse_frontmatter`)
- Header parsing: H1/H2/H3 boundaries (same as `MarkdownNodeParser`)
- Re-split rule: any header section >600 tokens → split into ~512-token chunks with overlap (same as `TokenTextSplitter(512, 50)`)
- Token counter: `cl100k_base` (same as A-Pedi)

What the studio shows = what A-Pedi will store in Qdrant.

## API routes (all under `/api`)

| Method | Path | Runtime | Purpose |
|---|---|---|---|
| POST | `/parse/start` | Node | Upload `.pptx` to LlamaParse, return `{job_id}` |
| GET | `/parse/status?job_id=` | Node | Poll job status |
| GET | `/parse/result?job_id=` | Node | Fetch markdown + apply noise filter |
| POST | `/standardize` | **Edge** (streaming) | Raw MD + frontmatter → SSE-streamed standardized MD |
| POST | `/chunks` | Node | MD → chunk list with token counts |
| POST | `/validate` | Node | MD → 8-point compliance issues |
| POST | `/suggest-keywords` | Node | MD → per-chunk keyword recommendations |
| POST | `/apply-suggestion` | Node | Insert a suggested term into a chunk |
| POST | `/retrieve` | Node | MD + query → top-K BM25 results |

## Vercel Hobby tier notes

- **Body limit 4.5 MB** is **bypassed**: file uploads go directly from the browser to LlamaParse via the `NEXT_PUBLIC_LLAMA_CLOUD_API_KEY` key. Practical cap is whatever LlamaParse itself accepts (well above 5 MB).
- **Function timeout 10s:** mitigated by:
  - **LlamaParse:** async polling — the browser uploads to LlamaParse, then `/api/parse/status` polls every 2s.
  - **Standardize:** Edge runtime + streaming. Even if total response takes 30s, connection stays alive while bytes flow.
  - **Other routes:** all complete in <1s (pure compute).

## Troubleshooting

- **"LLAMA_CLOUD_API_KEY not configured"** → set it in `.env.local` (local) or Vercel env vars (prod).
- **"LLM_API_KEY not configured"** → same.
- **Standardize streams stop mid-way** → likely the LLM provider ran out of credit / hit a rate limit. Check your provider dashboard.
- **PPT with complex flowcharts** → add a `parsing_instruction` like "preserve flowchart steps as numbered list" in the parser options.
- **Validation shows H1 chunks > 512 tokens** → click **Regenerate (Pro model)** (set `LLM_MODEL_PRO` first).

## Project layout

```
standardize-knowledge/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                      # studio orchestration
│   └── api/                          # all backend logic as Next.js route handlers
│       ├── parse/
│       │   ├── start/route.ts
│       │   ├── status/route.ts
│       │   └── result/route.ts
│       ├── standardize/route.ts      # Edge runtime, streams
│       ├── chunks/route.ts
│       ├── validate/route.ts
│       ├── suggest-keywords/route.ts
│       ├── apply-suggestion/route.ts
│       └── retrieve/route.ts
├── components/                       # 8 UI components
├── lib/
│   ├── api.ts                        # client → API
│   ├── llamaparse.ts                 # LlamaParse REST (server-only)
│   ├── llm.ts                        # OpenAI-compatible REST (server-only, streaming)
│   ├── chunking.ts                   # mirror of A-Pedi MarkdownNodeParser
│   ├── tokens.ts                     # tiktoken count
│   ├── frontmatter.ts                # YAML parse
│   ├── noise-filter.ts               # cover/back/footer strip
│   ├── validators.ts                 # 8-point compliance
│   ├── suggestions.ts                # heuristic keyword recs + apply
│   ├── bm25.ts                       # local BM25
│   └── standardizer-prompt.ts        # the user's verbatim system prompt
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── vercel.json
├── .env.example
└── README.md
```
