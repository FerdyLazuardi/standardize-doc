"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Columns2, Download, Loader2, FileText, Eye, EyeOff, Sparkles, Replace } from "lucide-react";
import { countTokens } from "@/lib/tokens";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type ViewMode = "code" | "compare" | "deck";

export type PreviewFile = {
  blob: Blob;
  type: "pdf" | "pptx";
  name: string;
};

export type StandardizedViewHandle = {
  jumpToLine: (line: number) => void;
};

type EditorInstance = {
  revealLineInCenter: (line: number) => void;
  setPosition: (pos: { lineNumber: number; column: number }) => void;
  focus: () => void;
  getAction: (id: string) => { run: () => void } | null;
  deltaDecorations: (
    old: string[],
    next: {
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      options: { isWholeLine?: boolean; className?: string };
    }[]
  ) => string[];
};

export const StandardizedView = forwardRef<
  StandardizedViewHandle,
  {
    standardized: string;
    parsing: boolean;
    parseStatus: string;
    parseProgress?: number;
    hasParsed: boolean;
    parsedMarkdown?: string;
    onDownload?: () => void;
    onChange?: (value: string | undefined) => void;
    previewFile?: PreviewFile | null;
  }
>(function StandardizedView(
  { standardized, parsing, parseStatus, parseProgress, hasParsed, parsedMarkdown, onDownload, onChange, previewFile },
  ref
) {
  const [mode, setMode] = useState<ViewMode>("code");
  const [renderPreview, setRenderPreview] = useState(false);
  const tokenCount = useMemo(() => countTokens(standardized), [standardized]);
  const editorRef = useRef<EditorInstance | null>(null);
  const decoRef = useRef<string[]>([]);

  // Object URL for the deck preview. Recreated when previewFile changes;
  // revoked on unmount or replacement to avoid leaks.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  useImperativeHandle(ref, () => ({
    jumpToLine(line: number) {
      // Make sure the editor is visible before jumping. If we're on the deck
      // tab or rendered-preview is on, switch back so the user can see the
      // jump destination.
      setMode((m) => (m === "deck" ? "compare" : m));
      setRenderPreview(false);
      const tryJump = (attempt = 0) => {
        const ed = editorRef.current;
        if (!ed) {
          if (attempt < 8) setTimeout(() => tryJump(attempt + 1), 60);
          return;
        }
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: 1 });
        ed.focus();
        decoRef.current = ed.deltaDecorations(decoRef.current, [
          {
            range: {
              startLineNumber: line,
              startColumn: 1,
              endLineNumber: line,
              endColumn: 1,
            },
            options: { isWholeLine: true, className: "monaco-jump-flash" },
          },
        ]);
        setTimeout(() => {
          if (editorRef.current) {
            decoRef.current = editorRef.current.deltaDecorations(decoRef.current, []);
          }
        }, 1400);
      };
      tryJump();
    },
  }));

  const hasDeck = !!previewFile;
  const showCodePane = mode === "code" || mode === "compare";
  const showDeckPane = mode === "compare" || mode === "deck";
  const codeWidth = mode === "code" ? "100%" : mode === "compare" ? "50%" : "0%";
  const deckWidth = mode === "deck" ? "100%" : mode === "compare" ? "50%" : "0%";

  return (
    <div className="bg-bg rounded-lg border border-border flex flex-col min-h-0 overflow-hidden flex-1">
      <div className="px-3 md:px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          Standardized
        </span>

        <div className="inline-flex rounded-md border border-border bg-bg overflow-hidden">
          <ToggleButton
            active={mode === "code"}
            onClick={() => setMode("code")}
            icon={<Code2 className="w-3 h-3" />}
            label="Code"
          />
          <ToggleButton
            active={mode === "compare"}
            onClick={() => setMode("compare")}
            icon={<Columns2 className="w-3 h-3" />}
            label="Compare"
            disabled={!hasDeck}
            disabledTitle="Upload a PDF / PPTX deck first to compare"
          />
          <ToggleButton
            active={mode === "deck"}
            onClick={() => setMode("deck")}
            icon={<FileText className="w-3 h-3" />}
            label="Deck"
            disabled={!hasDeck}
            disabledTitle="Upload a PDF / PPTX deck first"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted font-mono">
            {standardized.length.toLocaleString()} chars · {tokenCount.toLocaleString()} tokens
          </span>
          {standardized && mode !== "deck" && !renderPreview && (
            <button
              onClick={() => {
                const ed = editorRef.current;
                if (!ed) return;
                ed.focus();
                ed.getAction("editor.action.startFindReplaceAction")?.run();
              }}
              className="text-[11px] font-medium px-2.5 py-1 inline-flex items-center gap-1 rounded-md border border-border bg-bg text-textSecondary hover:bg-surface hover:text-text transition"
              title="Find & Replace (Ctrl+H). Leave Replace empty to delete matches."
            >
              <Replace className="w-3.5 h-3.5" />
              Find & Replace
            </button>
          )}
          {standardized && mode !== "deck" && (
            <button
              onClick={() => setRenderPreview((v) => !v)}
              className={`text-[11px] font-medium px-2.5 py-1 inline-flex items-center gap-1 rounded-md border transition ${renderPreview
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-bg text-textSecondary hover:bg-surface hover:text-text"
                }`}
              title={renderPreview ? "Switch to editable code" : "Switch to rendered preview"}
            >
              {renderPreview ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {renderPreview ? "Edit" : "Render"}
            </button>
          )}
          {standardized && onDownload && (
            <button
              onClick={onDownload}
              className="text-[11px] font-medium px-2.5 py-1 inline-flex items-center gap-1 rounded-md border border-border bg-bg text-textSecondary hover:bg-surface hover:text-text transition"
              title="Download .md"
            >
              <Download className="w-3.5 h-3.5" />
              .md
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div
          className="min-h-0 overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            width: codeWidth,
            opacity: showCodePane ? 1 : 0,
            borderRight: mode === "compare" ? "1px solid #e4e4e7" : "none",
          }}
          aria-hidden={!showCodePane}
        >
          <CodePane
            standardized={standardized}
            parsing={parsing}
            parseStatus={parseStatus}
            parseProgress={parseProgress ?? 0}
            hasParsed={hasParsed}
            parsedMarkdown={parsedMarkdown ?? ""}
            onChange={onChange}
            renderPreview={renderPreview}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>

        <div
          className="min-h-0 overflow-hidden transition-all duration-300 ease-in-out bg-bg"
          style={{
            width: deckWidth,
            opacity: showDeckPane ? 1 : 0,
          }}
          aria-hidden={!showDeckPane}
        >
          <DeckPane previewFile={previewFile ?? null} previewUrl={previewUrl} />
        </div>
      </div>
    </div>
  );
});

function CodePane({
  standardized,
  parsing,
  parseStatus,
  parseProgress,
  hasParsed,
  parsedMarkdown,
  onChange,
  renderPreview,
  onMount,
}: {
  standardized: string;
  parsing: boolean;
  parseStatus: string;
  parseProgress: number;
  hasParsed: boolean;
  parsedMarkdown: string;
  onChange?: (value: string | undefined) => void;
  renderPreview: boolean;
  onMount?: (editor: EditorInstance) => void;
}) {
  if (parsing) {
    const pct = Math.max(0, Math.min(100, Math.round(parseProgress)));
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Loader2 className="w-7 h-7 text-accent animate-spin" />
        <div className="text-sm font-medium text-text">
          Parsing your file… <span className="font-mono text-accent">{pct}%</span>
        </div>
        <div className="w-full max-w-xs flex flex-col gap-1.5">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[11px] font-mono text-muted truncate text-left">
            {parseStatus || "Working with LlamaParse"}
          </div>
        </div>
      </div>
    );
  }

  if (standardized) {
    if (renderPreview) {
      return (
        <div className="h-full overflow-y-auto scrollbar-slim px-6 py-5">
          <MarkdownPreview source={standardized} />
        </div>
      );
    }
    return (
      <Editor
        height="100%"
        defaultLanguage="markdown"
        theme="vs"
        value={standardized}
        onChange={onChange}
        onMount={(editor) => {
          if (onMount) onMount(editor as unknown as EditorInstance);
        }}
        options={{
          readOnly: !onChange,
          minimap: { enabled: false },
          wordWrap: "on",
          fontSize: 13,
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          scrollBeyondLastLine: false,
          renderLineHighlight: "none",
          padding: { top: 12, bottom: 12 },
          // Render the find widget (Ctrl+F) as a fixed overlay on the body
          // instead of inside the editor's overflow-hidden container, so it
          // doesn't get clipped or pushed off-screen near the top edge.
          fixedOverflowWidgets: true,
        }}
      />
    );
  }

  if (hasParsed) {
    // Show the raw LlamaParse markdown so the user can verify what came out
    // of the parser before they decide to standardize. The editor is locked
    // — they're meant to review, not edit, this stage.
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="px-4 py-2.5 border-b border-amber-300/60 bg-amber-50 flex items-center gap-2 text-[12px] text-amber-900">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="font-medium">Parse complete — preview only.</span>
          <span className="text-amber-800/80">
            Click <span className="font-semibold">Standardize Markdown</span> on
            the right to generate the editable, RAG-optimized version.
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            defaultLanguage="markdown"
            theme="vs"
            value={parsedMarkdown}
            options={{
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: false },
              wordWrap: "on",
              fontSize: 13,
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              scrollBeyondLastLine: false,
              renderLineHighlight: "none",
              padding: { top: 12, bottom: 12 },
              fixedOverflowWidgets: true,
              contextmenu: false,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-sm text-muted">
      Upload a .pptx or .pdf to begin. The standardized markdown will appear here once you click Standardize.
    </div>
  );
}

function DeckPane({
  previewFile,
  previewUrl,
}: {
  previewFile: PreviewFile | null;
  previewUrl: string | null;
}) {
  if (!previewFile || !previewUrl) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center">
        <div className="max-w-sm text-xs text-muted">
          Upload a deck on the right panel to preview it here.
        </div>
      </div>
    );
  }

  if (previewFile.type === "pptx") {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 gap-3 text-center">
        <FileText className="w-9 h-9 text-muted" />
        <div className="text-sm font-medium text-text">
          PPTX preview not available in browser
        </div>
        <div className="text-xs text-muted leading-relaxed max-w-xs">
          Browsers can&rsquo;t render .pptx natively. Save the deck as PDF in PowerPoint, or download it below to open in your viewer.
        </div>
        <a
          href={previewUrl}
          download={previewFile.name}
          className="text-[11px] font-medium px-3 py-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-bg text-textSecondary hover:bg-surface hover:text-text transition"
        >
          <Download className="w-3.5 h-3.5" />
          Download {previewFile.name}
        </a>
      </div>
    );
  }

  return (
    <iframe
      src={`${previewUrl}#zoom=50`}
      title={previewFile.name}
      className="w-full h-full border-0"
    />
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  disabledTitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className={`text-[11px] font-medium px-2.5 py-1 inline-flex items-center gap-1 transition ${disabled
          ? "bg-bg text-muted/60 cursor-not-allowed"
          : active
            ? "bg-accent text-white"
            : "bg-bg text-textSecondary hover:bg-surface"
        }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="md-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
