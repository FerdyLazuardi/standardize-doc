"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Eye, Columns2, Download, Loader2, ArrowRight } from "lucide-react";
import { countTokens } from "@/lib/tokens";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type ViewMode = "code" | "split" | "preview";

export type StandardizedViewHandle = {
  jumpToLine: (line: number) => void;
};

type EditorInstance = {
  revealLineInCenter: (line: number) => void;
  setPosition: (pos: { lineNumber: number; column: number }) => void;
  focus: () => void;
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
    hasParsed: boolean;
    onDownload?: () => void;
    onChange?: (value: string | undefined) => void;
  }
>(function StandardizedView(
  { standardized, parsing, parseStatus, hasParsed, onDownload, onChange },
  ref
) {
  const [mode, setMode] = useState<ViewMode>("code");
  const tokenCount = useMemo(() => countTokens(standardized), [standardized]);
  const editorRef = useRef<EditorInstance | null>(null);
  const decoRef = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    jumpToLine(line: number) {
      setMode((m) => (m === "preview" ? "split" : m));
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

  const showCode = mode === "code" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";
  const codeWidth = mode === "code" ? "100%" : mode === "split" ? "50%" : "0%";
  const previewWidth = mode === "preview" ? "100%" : mode === "split" ? "50%" : "0%";

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
            active={mode === "split"}
            onClick={() => setMode("split")}
            icon={<Columns2 className="w-3 h-3" />}
            label="Split"
          />
          <ToggleButton
            active={mode === "preview"}
            onClick={() => setMode("preview")}
            icon={<Eye className="w-3 h-3" />}
            label="Preview"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted font-mono">
            {standardized.length.toLocaleString()} chars · {tokenCount.toLocaleString()} tokens
          </span>
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
            opacity: showCode ? 1 : 0,
            borderRight: mode === "split" ? "1px solid #e4e4e7" : "none",
          }}
          aria-hidden={!showCode}
        >
          <CodePane
            standardized={standardized}
            parsing={parsing}
            parseStatus={parseStatus}
            hasParsed={hasParsed}
            onChange={onChange}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>

        <div
          className="min-h-0 overflow-hidden transition-all duration-300 ease-in-out bg-bg"
          style={{
            width: previewWidth,
            opacity: showPreview ? 1 : 0,
          }}
          aria-hidden={!showPreview}
        >
          <div className="h-full overflow-y-auto scrollbar-slim px-6 py-5">
            {standardized ? (
              <MarkdownPreview source={standardized} />
            ) : (
              <div className="text-sm text-muted">
                The rendered markdown preview will appear here once the document is standardized.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function CodePane({
  standardized,
  parsing,
  parseStatus,
  hasParsed,
  onChange,
  onMount,
}: {
  standardized: string;
  parsing: boolean;
  parseStatus: string;
  hasParsed: boolean;
  onChange?: (value: string | undefined) => void;
  onMount?: (editor: EditorInstance) => void;
}) {
  if (parsing) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 className="w-7 h-7 text-accent animate-spin" />
        <div className="text-sm font-medium text-text">Parsing your file…</div>
        <div className="text-xs text-muted font-mono">
          {parseStatus || "Working with LlamaParse"}
        </div>
      </div>
    );
  }

  if (standardized) {
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
        }}
      />
    );
  }

  if (hasParsed) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="max-w-md rounded-lg border border-accent/30 bg-accentSoft px-5 py-4">
          <div className="text-sm font-semibold text-accent flex items-center gap-2">
            Parse complete
            <ArrowRight className="w-4 h-4" />
          </div>
          <div className="text-xs text-text mt-1.5 leading-relaxed">
            Click <span className="font-semibold">Standardize Markdown</span> on the right panel to generate the RAG-optimized output.
          </div>
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

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 inline-flex items-center gap-1 transition ${
        active
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
