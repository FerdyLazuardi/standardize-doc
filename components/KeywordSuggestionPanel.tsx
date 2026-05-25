"use client";

import type { Suggestion } from "@/lib/api";

const CATEGORY_LABEL: Record<Suggestion["category"], string> = {
  entity_alias: "alias",
  role_tag: "role",
  question_hook: "hook",
  metric_label: "metric",
};

export function KeywordSuggestionPanel({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  if (suggestions.length === 0) {
    return (
      <Section title="Retrieval hints">
        <div className="text-xs text-muted">
          No hints yet. Standardize markdown to surface FAQ-style retrieval terms.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Retrieval hints">
      <div className="text-[10px] text-muted mb-2">
        Suggested FAQ-style terms users might search for. Use these as retrieval hints — they&apos;re not markdown edits.
      </div>
      <div className="max-h-72 overflow-y-auto scrollbar-slim space-y-1">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className="text-[11px] px-2.5 py-2 rounded-md bg-surface border border-border"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-accent">
                #{s.chunk_index} · {CATEGORY_LABEL[s.category]}
              </span>
              <span
                className={`text-[9px] uppercase tracking-wider ${
                  s.severity === "warn" ? "text-warn" : "text-muted"
                }`}
              >
                {s.severity}
              </span>
            </div>
            <div className="mt-1 text-text">{s.message}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {s.suggested_terms.map((term) => (
                <span
                  key={term}
                  className="text-[10px] bg-accentSoft text-accent border border-accent/20 rounded-md px-2 py-0.5"
                >
                  {term}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
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
