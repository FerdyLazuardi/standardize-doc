# Plan: Cross-Document Duplicate-Context Detection (LLM-as-Judge) + Auto-Fix

## Context

The Standardize Knowledge Studio turns one course document at a time into
RAG-optimized markdown for A-Pedi. Because courses are standardized
independently, two different course docs can end up with H1 sections covering
the same topic — e.g. an Amartha **Product** course and a dedicated **Modal**
course both explaining *modal*. Those near-duplicate chunks pollute retrieval
(a query pulls both and returns redundant information).

This feature lets a user **bulk-upload all standardized `.md` files**, runs an
**LLM-as-judge** to find which H1 sections are "kembar" (redundant), and offers
an **auto-fix that rewrites each side toward a distinct angle** so the chunks
stop competing — instead of silently dropping content.

Decisions (confirmed with user):
- Input: **upload many `.md` files**.
- Granularity: **per-section (H1 / chunk)**, cross-document only.
- Auto-fix action: **rewrite both sections so each focuses on a distinct angle**.

## Architecture (reuses existing patterns)

```
MdBulkUploader (multi .md) ──> docs: {name, markdown}[]
        │
        ▼  (client-side, no LLM)
lib/dedup.ts: extractH1Sections() per doc
        │   findCandidatePairs() — TF-IDF cosine, cross-doc only, threshold+cap
        ▼
POST /api/dedup-judge (Edge) ──> lib/dedup-judge.ts
        │   one batched LLM call → verdict per pair
        │   {verdict: duplicate|overlap|distinct, similarity, shared_topic,
        │    reason, a_unique_angle, b_unique_angle}
        ▼
DedupView lists duplicate/overlap pairs with reason + angles
        │   per-pair "Rewrite to differentiate"
        ▼
POST /api/dedup-rewrite (Edge) ──> lib/dedup-rewrite.ts
        │   {section_a, section_b} rewritten toward each angle
        ▼
lib/dedup.replaceH1Section() splices both back into their docs
        ▼
Download all (jszip) — corrected .md files
```

LLM calls mirror `lib/suggest-questions.ts` exactly (OpenAI-compatible
`/chat/completions`, env-configured model, server-only). Routes mirror
`app/api/suggest-questions/route.ts` (Edge, JSON in/out). The cosine prefilter
keeps the judge cost bounded (no O(n²) LLM calls).

## Files

Created (done):
- `lib/dedup.ts` — section extraction, TF-IDF cosine prefilter (`findCandidatePairs`), `replaceH1Section` splice. Reuses `parseFrontmatter` (lib/frontmatter.ts), `countTokens` (lib/tokens.ts).
- `lib/dedup-judge.ts` + `app/api/dedup-judge/route.ts` — batched LLM judge.
- `lib/dedup-rewrite.ts` + `app/api/dedup-rewrite/route.ts` — rewrite-to-differentiate.
- `lib/api.ts` — added `judgeDuplicates()`, `rewriteDifferentiate()` wrappers + `import type` of judge/rewrite types.
- `components/MdBulkUploader.tsx` — multi-file `.md` drag-drop/browse → `{name, markdown}[]`.

Remaining:
- `components/DedupView.tsx` — full-width view: uploader + doc list, "Scan for duplicates", pair cards (similarity badge, reason, angles), per-pair Rewrite button, Download-all. Own local busy state.
- `app/page.tsx` — add `mode: "studio" | "dedup"` toggle bar; render existing grid for studio, `<DedupView/>` full-width for dedup.

## Verification

1. `npm run lint` and `npx tsc --noEmit` clean.
2. `npm run build` succeeds.
3. `npm run dev`, switch to Dedup mode, upload 2+ standardized `.md` files that
   share a topic (e.g. a Product course + a Modal course), Scan → confirm
   candidate pairs surface and the judge labels the modal pair duplicate/overlap.
4. Click "Rewrite to differentiate" → both sections visibly diverge in focus,
   language preserved, entity present, headings intact. Download all → corrected
   files contain the spliced rewrites.
