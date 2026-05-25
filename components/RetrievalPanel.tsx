"use client";

import { useState } from "react";
import type { RetrieveResult } from "@/lib/api";
import { Search, Sparkles, RefreshCw } from "lucide-react";

type RetrieveItem = RetrieveResult["results"][number];

export function RetrievalPanel({
  result,
  disabled,
  onQuery,
  questions,
  questionsLoading,
  onRefreshQuestions,
  onJumpToResult,
}: {
  result: RetrieveResult | null;
  disabled: boolean;
  onQuery: (q: string, topK: number) => void;
  questions: string[];
  questionsLoading: boolean;
  onRefreshQuestions: () => void;
  onJumpToResult?: (result: RetrieveItem) => void;
}) {
  const [q, setQ] = useState("");
  const [topK, setTopK] = useState(3);

  const runQuery = (query: string) => {
    setQ(query);
    if (query.trim()) onQuery(query.trim(), topK);
  };

  return (
    <Section title="Retrieval test (BM25, local)">
      <div className="text-[10px] text-muted mb-2">
        Simulates how a query would rank against your chunks. No LLM, no Qdrant.
      </div>

      {!disabled && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-accent" />
              Suggested questions
            </span>
            <button
              onClick={onRefreshQuestions}
              disabled={questionsLoading}
              className={`text-[10px] font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-md transition disabled:opacity-50 ${
                questions.length === 0
                  ? "bg-accent text-white hover:bg-accentHover shadow-sm"
                  : "bg-accentSoft text-accent border border-accent/30 hover:bg-accent hover:text-white hover:border-accent"
              }`}
              title="Generate FAQ-style retrieval test queries from your markdown"
            >
              {questionsLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : questions.length === 0 ? (
                <Sparkles className="w-3 h-3" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {questionsLoading
                ? "Generating…"
                : questions.length === 0
                  ? "Generate"
                  : "Regenerate"}
            </button>
          </div>
          {questions.length === 0 && !questionsLoading ? (
            <div className="text-[11px] text-textSecondary leading-relaxed bg-accentSoft/50 border border-accent/15 rounded-md px-2.5 py-1.5">
              Click <span className="font-semibold text-accent">Generate</span> to surface FAQ-style queries based on your markdown.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {questions.map((qq) => (
                <button
                  key={qq}
                  onClick={() => runQuery(qq)}
                  className="text-[11px] bg-accentSoft text-accent border border-accent/20 hover:bg-accent hover:text-white hover:border-accent rounded-md px-2 py-0.5 transition text-left"
                >
                  {qq}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1.5 mb-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g., apa itu prinsip client protection"
          disabled={disabled}
          className="flex-1 px-2.5 py-1.5 bg-bg rounded-md border border-border text-xs text-text placeholder:text-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) onQuery(q.trim(), topK);
          }}
        />
        <select
          value={topK}
          onChange={(e) => setTopK(parseInt(e.target.value))}
          disabled={disabled}
          className="bg-bg rounded-md border border-border text-xs text-text px-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        >
          {[1, 3, 5, 10].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          className="text-xs bg-accent hover:bg-accentHover text-white font-medium px-3 py-1.5 rounded-md disabled:opacity-50 disabled:hover:bg-accent transition flex items-center gap-1"
          disabled={disabled || !q.trim()}
          onClick={() => onQuery(q.trim(), topK)}
        >
          <Search className="w-3 h-3" />
          Search
        </button>
      </div>
      {result && (
        <div className="max-h-56 overflow-y-auto scrollbar-slim space-y-1">
          {result.results.length === 0 ? (
            <div className="text-xs text-muted">No matches.</div>
          ) : (
            result.results.map((r) => {
              const clickable = !!onJumpToResult;
              const Tag = clickable ? "button" : "div";
              return (
                <Tag
                  key={r.chunk_index}
                  onClick={clickable ? () => onJumpToResult?.(r) : undefined}
                  className={`w-full text-left text-[11px] px-2.5 py-2 rounded-md bg-surface border border-border ${
                    clickable
                      ? "hover:ring-2 hover:ring-accent/30 cursor-pointer transition"
                      : ""
                  }`}
                  title={
                    clickable
                      ? "Click to jump to this chunk in the editor"
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="font-mono text-[10px] text-accent truncate">
                      #{r.chunk_index} · {r.header || "(no header)"}
                    </span>
                    <span className="text-[10px] text-textSecondary font-mono">
                      {r.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="text-textSecondary">{r.snippet}</div>
                </Tag>
              );
            })
          )}
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg rounded-lg border border-border p-3">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
