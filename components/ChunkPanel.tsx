"use client";

import type { ChunksResult, ChunkPreview } from "@/lib/api";
import { AlertTriangle } from "lucide-react";

export function ChunkPanel({
  result,
  onJump,
}: {
  result: ChunksResult | null;
  onJump?: (chunk: ChunkPreview) => void;
}) {
  if (!result) {
    return (
      <Section title="Chunks">
        <div className="text-xs text-muted">Standardize markdown to see chunks.</div>
      </Section>
    );
  }
  const { chunks, summary } = result;
  return (
    <Section title="Chunks">
      <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
        <Stat label="total" value={summary.total} />
        <Stat label="avg tokens" value={summary.avg_tokens ?? 0} />
        <Stat
          label="resplit"
          value={summary.oversized_resplit}
          bad={summary.oversized_resplit > 0}
        />
      </div>
      <div className="max-h-72 overflow-y-auto scrollbar-slim space-y-1">
        {chunks.map((c) => {
          const oversize = c.token_count > 512;
          const undersize = c.token_count < 70;
          const tone = oversize || undersize;
          const clickable = !!onJump;
          const Tag = clickable ? "button" : "div";
          return (
            <Tag
              key={c.chunk_index}
              onClick={clickable ? () => onJump?.(c) : undefined}
              className={`w-full text-left text-xs px-2.5 py-2 rounded-md border ${
                tone
                  ? "border-warn/40 bg-warnSoft"
                  : "border-border bg-surface"
              } ${clickable ? "hover:ring-2 hover:ring-accent/30 cursor-pointer transition" : ""}`}
              title={clickable ? "Click to jump to this chunk in the editor" : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-text truncate">
                  #{c.chunk_index} · {c.header || "(no header)"}
                </span>
                <span
                  className={`text-[10px] font-mono ${
                    tone ? "text-warn" : "text-textSecondary"
                  }`}
                >
                  {c.token_count}t
                </span>
              </div>
              {c.oversized_resplit && (
                <div className="text-[10px] text-warn mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  originated from a {">"} 600-token H1 (will be re-split by A-Pedi)
                </div>
              )}
            </Tag>
          );
        })}
      </div>
    </Section>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div
      className={`rounded-md px-2 py-1.5 border ${
        bad
          ? "bg-warnSoft border-warn/30 text-warn"
          : "bg-surfaceAlt border-border text-text"
      }`}
    >
      <div className="text-[9px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
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
