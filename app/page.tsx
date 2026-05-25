"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  autoFixStream,
  getChunks,
  parsePollUntilDone,
  parseStart,
  retrieve,
  standardizeStream,
  suggestQuestions,
  validateMd,
  type AutoFixAction,
  type ChunksResult,
  type ParseResult,
  type RetrieveResult,
  type ValidateResult,
  type ValidationIssue,
} from "@/lib/api";
import { buildFrontmatterBlock } from "@/lib/frontmatter";
import { type FormState } from "@/components/FrontmatterForm";
import {
  StandardizedView,
  type StandardizedViewHandle,
} from "@/components/StandardizedView";
import { RightPanel } from "@/components/RightPanel";

type Busy = null | "parsing" | "standardize" | "analyze" | "fixing";

function applyFrontmatterFix(markdown: string, form: FormState): string {
  const block = buildFrontmatterBlock({
    department: form.department,
    topic: form.topic,
    course_id: form.course_id || "0",
    course_name: form.course_name,
  });
  const stripped = markdown.replace(/^\s+/, "");
  if (stripped.startsWith("---")) {
    // Find the closing --- line
    const closeIdx = stripped.indexOf("\n---", 3);
    if (closeIdx !== -1) {
      const afterClose = stripped.indexOf("\n", closeIdx + 4);
      const body = afterClose === -1 ? "" : stripped.slice(afterClose + 1);
      return block + "\n" + body;
    }
  }
  return block + "\n" + stripped;
}

/**
 * Map a ValidationIssue.location string back to a 1-indexed line number in the
 * standardized markdown. The validator emits these location formats:
 *  - "top"                          → line 1
 *  - "frontmatter.<field>"          → first line containing `<field>:`
 *  - "body"                         → first H1 line, or line 1
 *  - "# <H1 title>"                 → first matching H1 line
 *  - "## <H2 title>"                → first matching H2 line
 */
function locateIssueLine(markdown: string, location: string): number {
  if (!markdown) return 1;
  const lines = markdown.split("\n");
  const loc = location.trim();

  if (!loc || loc === "top") return 1;

  if (loc.startsWith("frontmatter.")) {
    const field = loc.slice("frontmatter.".length).trim();
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^\\s*${field}\\s*:`, "i").test(lines[i])) return i + 1;
    }
    return 1;
  }

  if (loc.startsWith("# ") || loc.startsWith("## ") || loc.startsWith("### ")) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === loc) return i + 1;
    }
    // Try a relaxed match (heading text only, ignoring trailing whitespace)
    const heading = loc.replace(/^#+\s+/, "");
    for (let i = 0; i < lines.length; i++) {
      const m = /^#{1,3}\s+(.+?)\s*$/.exec(lines[i]);
      if (m && m[1] === heading) return i + 1;
    }
    return 1;
  }

  if (loc === "body") {
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+/.test(lines[i])) return i + 1;
    }
    return 1;
  }

  // Fallback: substring search
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(loc)) return i + 1;
  }
  return 1;
}

export default function StudioPage() {
  const [compressEnabled, setCompressEnabled] = useState(true);

  const [form, setForm] = useState<FormState>({
    department: "Global",
    course_id: "",
    course_name: "",
    entity_name: "Amartha",
    topic: "Policy / Compliance",
  });

  const [parseResultState, setParseResultState] = useState<ParseResult | null>(null);
  const [standardized, setStandardized] = useState<string>("");
  const [chunks, setChunks] = useState<ChunksResult | null>(null);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [retrieval, setRetrieval] = useState<RetrieveResult | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    blob: Blob;
    type: "pdf" | "pptx";
    name: string;
  } | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [parseStatus, setParseStatus] = useState<string>("");
  const [parseProgress, setParseProgress] = useState<number>(0);
  const [standardizeProgress, setStandardizeProgress] = useState<number>(0);

  // Refs for the edit debounce + loop-prevention against programmatic Monaco updates
  const standardizedRef = useRef(standardized);
  useEffect(() => {
    standardizedRef.current = standardized;
  }, [standardized]);
  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<StandardizedViewHandle | null>(null);

  const onJumpToIssue = useCallback((issue: ValidationIssue) => {
    const line = locateIssueLine(standardizedRef.current, issue.location);
    viewRef.current?.jumpToLine(line);
  }, []);

  const onJumpToChunk = useCallback((chunk: { header: string }) => {
    const loc = chunk.header ? `# ${chunk.header}` : "body";
    const line = locateIssueLine(standardizedRef.current, loc);
    viewRef.current?.jumpToLine(line);
  }, []);

  const onJumpToResult = useCallback((r: { header: string }) => {
    const loc = r.header ? `# ${r.header}` : "body";
    const line = locateIssueLine(standardizedRef.current, loc);
    viewRef.current?.jumpToLine(line);
  }, []);

  const onUpload = useCallback(
    async (incoming: File) => {
      setBusy("parsing");
      setParseStatus("Uploading...");
      setParseProgress(0);
      try {
        setParseResultState(null);
        setStandardized("");
        setChunks(null);
        setValidation(null);
        setRetrieval(null);
        setSuggestedQuestions([]);
        setPreviewFile(null);

        let file = incoming;
        const lname = incoming.name.toLowerCase();
        if (!lname.endsWith(".pdf")) {
          toast.error(
            "Only PDF is supported. Save your PowerPoint deck as PDF first (File → Save As → PDF)."
          );
          return;
        }

        if (compressEnabled) {
          setParseStatus("Loading compressor…");
          try {
            const { compressPdf } = await import("@/lib/compress");
            const onProgress = (current: number, total: number, label: string) => {
              setParseStatus(`${label} (${current}/${total})`);
              // Map compression to 0-50% of total parse progress
              setParseProgress(Math.round((current / total) * 50));
            };
            const result = await compressPdf(incoming, { onProgress });

            const beforeMb = (result.originalBytes / (1024 * 1024)).toFixed(1);
            const afterMb = (result.compressedBytes / (1024 * 1024)).toFixed(1);
            const savings = Math.max(
              0,
              Math.round((1 - result.compressedBytes / result.originalBytes) * 100)
            );

            if (result.compressedBytes < result.originalBytes) {
              file = new File([result.blob], incoming.name, {
                type: incoming.type || result.blob.type,
              });
              toast.success(
                `Compressed ${beforeMb} MB → ${afterMb} MB (-${savings}%)`
              );
            } else {
              toast.info("Compression skipped — file is already small.");
            }
            if (result.notes.length > 0) {
              toast.info(result.notes.join(" "));
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Compression failed";
            toast.error(`${msg} — uploading original file.`);
          }
        }

        setPreviewFile({ blob: file, type: "pdf", name: incoming.name });

        setParseStatus("Uploading to parser…");
        setParseProgress(55);
        const { job_id } = await parseStart(file);
        setParseStatus("Parsing PDF…");
        setParseProgress(60);
        toast.info(`LlamaParse job ${job_id} queued. Polling...`);

        // Time-based monotonic curve from 60 → 95 while polling.
        // 60 + 35 * elapsed / (elapsed + 15s) — starts fast, slows toward 95.
        const pollStart = Date.now();
        const result = await parsePollUntilDone(job_id, {
          intervalMs: 2000,
          timeoutMs: 180000,
          onTick: (s) => {
            const elapsed = Date.now() - pollStart;
            const pct = Math.min(
              95,
              Math.round(60 + 35 * (elapsed / (elapsed + 15000)))
            );
            setParseProgress((prev) => Math.max(prev, pct));
            setParseStatus(`Status: ${s}`);
          },
        });
        setParseProgress(100);
        setParseResultState(result);
        const dropped = result.noise_stats.dropped_slides.length;
        toast.success(
          `Parsed. Kept ${result.noise_stats.kept_slides}/${result.noise_stats.original_slides} pages${
            dropped > 0
              ? ` (dropped: ${result.noise_stats.dropped_slides.join(", ")})`
              : ""
          }.`
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Parse failed";
        toast.error(msg);
      } finally {
        setBusy(null);
        setParseStatus("");
        setParseProgress(0);
      }
    },
    [compressEnabled]
  );

  const runAnalysis = useCallback(
    async (md: string) => {
      setBusy("analyze");
      try {
        const [chunksRes, valRes] = await Promise.all([
          getChunks(md),
          validateMd(md, form.entity_name),
        ]);
        setChunks(chunksRes);
        setValidation(valRes);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Analysis failed";
        toast.error(msg);
      } finally {
        setBusy(null);
      }
    },
    [form.entity_name]
  );

  const runStandardize = useCallback(async () => {
    if (!parseResultState) return;
    if (
      !form.department ||
      !form.topic ||
      !form.course_id ||
      !form.course_name ||
      !form.entity_name
    ) {
      toast.error("Please fill the frontmatter form before standardizing.");
      return;
    }
    setBusy("standardize");
    setStandardized("");
    setChunks(null);
    setValidation(null);
    setRetrieval(null);
    setSuggestedQuestions([]);
    setStandardizeProgress(0);
    // Standardized output is typically 0.6-1.0× the input length. Use input
    // length as the target so the bar fills monotonically as text streams in,
    // capped at 95% until the stream actually finishes.
    const targetChars = Math.max(
      1000,
      parseResultState.cleaned_markdown.length
    );
    try {
      const full = await standardizeStream(
        {
          raw_markdown: parseResultState.cleaned_markdown,
          department: form.department,
          topic: form.topic,
          course_id: form.course_id,
          course_name: form.course_name,
          entity_name: form.entity_name,
          doc_type: form.topic,
        },
        (_delta, accumulated) => {
          setStandardized(accumulated);
          const pct = Math.min(
            95,
            Math.round((accumulated.length / targetChars) * 95)
          );
          setStandardizeProgress((prev) => Math.max(prev, pct));
        }
      );
      setStandardized(full);
      setStandardizeProgress(100);
      toast.success("Standardized markdown ready.");
      await runAnalysis(full);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Standardize failed";
      toast.error(msg);
    } finally {
      setBusy(null);
      setStandardizeProgress(0);
    }
  }, [parseResultState, form, runAnalysis]);

  const onAutoFix = useCallback(
    async (fixes: AutoFixAction[]) => {
      if (!standardized || fixes.length === 0) return;

      // Apply local frontmatter fix first (deterministic, no LLM round-trip)
      const hasFrontmatterFix = fixes.some((f) => f.type === "fix_frontmatter");
      const llmFixes = fixes.filter((f) => f.type !== "fix_frontmatter");

      let workingMd = standardized;
      if (hasFrontmatterFix) {
        if (
          !form.department ||
          !form.topic ||
          !form.course_id ||
          !form.course_name
        ) {
          toast.error("Fill the frontmatter form (Setup tab) before auto-fixing.");
          return;
        }
        workingMd = applyFrontmatterFix(workingMd, form);
        setStandardized(workingMd);
      }

      if (llmFixes.length === 0) {
        toast.success("Frontmatter rebuilt. Re-running analysis…");
        await runAnalysis(workingMd);
        return;
      }

      setBusy("fixing");
      try {
        toast.info(
          `Applying ${llmFixes.length} auto-fix${llmFixes.length > 1 ? "es" : ""}…`
        );
        const fixed = await autoFixStream(
          {
            markdown: workingMd,
            fixes: llmFixes,
            entity_name: form.entity_name,
          },
          (_delta, accumulated) => {
            setStandardized(accumulated);
          }
        );
        setStandardized(fixed);
        toast.success("Auto-fix applied. Re-running analysis…");
        await runAnalysis(fixed);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Auto-fix failed";
        toast.error(msg);
        setBusy(null);
      }
    },
    [standardized, form, runAnalysis]
  );

  const onQuery = useCallback(
    async (query: string, topK: number) => {
      if (!standardized) return;
      try {
        const r = await retrieve(standardized, query, topK);
        setRetrieval(r);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Retrieve failed";
        toast.error(msg);
      }
    },
    [standardized]
  );

  const onRefreshQuestions = useCallback(async () => {
    if (!standardized) return;
    setQuestionsLoading(true);
    try {
      const r = await suggestQuestions(standardized, form.entity_name, form.topic);
      setSuggestedQuestions(r.questions);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Question suggestion failed";
      toast.error(msg);
    } finally {
      setQuestionsLoading(false);
    }
  }, [standardized, form.entity_name, form.topic]);

  const onMarkdownEdit = useCallback(
    (v: string | undefined) => {
      if (v === undefined) return;
      // Bail on programmatic value updates (e.g., during streaming) to avoid loops
      if (v === standardizedRef.current) return;
      setStandardized(v);
      if (editDebounce.current) clearTimeout(editDebounce.current);
      editDebounce.current = setTimeout(() => {
        if (standardizedRef.current) runAnalysis(standardizedRef.current);
      }, 800);
    },
    [runAnalysis]
  );

  const downloadMd = useCallback(() => {
    if (!standardized) return;
    const blob = new Blob([standardized], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.course_name || "knowledge"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [standardized, form.course_name]);

  // Editor is read-only while LLM streams are mutating it
  const editable = busy !== "standardize" && busy !== "fixing" && busy !== "parsing";

  return (
    <main className="min-h-screen p-3 md:p-4 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 bg-bg md:max-h-screen">
      <section className="md:col-span-8 flex flex-col gap-4 h-[70vh] md:h-auto md:max-h-[calc(100vh-2rem)] order-2 md:order-1">
        <StandardizedView
          ref={viewRef}
          standardized={standardized}
          parsing={busy === "parsing"}
          parseStatus={parseStatus}
          parseProgress={parseProgress}
          hasParsed={!!parseResultState}
          onDownload={downloadMd}
          onChange={editable ? onMarkdownEdit : undefined}
          previewFile={previewFile}
        />
      </section>

      <aside className="md:col-span-4 flex flex-col md:max-h-[calc(100vh-2rem)] min-h-0 order-1 md:order-2">
        <RightPanel
          compressEnabled={compressEnabled}
          setCompressEnabled={setCompressEnabled}
          onUpload={onUpload}
          uploadBusy={busy === "parsing"}
          parseStatus={parseStatus}
          form={form}
          setForm={setForm}
          validation={validation}
          chunks={chunks}
          retrieval={retrieval}
          suggestedQuestions={suggestedQuestions}
          questionsLoading={questionsLoading}
          onRefreshQuestions={onRefreshQuestions}
          onAutoFix={onAutoFix}
          onJumpToIssue={onJumpToIssue}
          onJumpToChunk={onJumpToChunk}
          onJumpToResult={onJumpToResult}
          onQuery={onQuery}
          hasParsed={!!parseResultState}
          hasStandardized={!!standardized}
          busy={busy}
          standardizeProgress={standardizeProgress}
          onStandardize={runStandardize}
        />
      </aside>
    </main>
  );
}
