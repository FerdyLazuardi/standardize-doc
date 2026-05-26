"use client";

import type { ValidateResult, ValidationIssue, AutoFixAction } from "@/lib/api";
import { CheckCircle2, Wand2 } from "lucide-react";

const SEVERITY_STYLE: Record<string, string> = {
  error: "border-l-error bg-errorSoft text-text",
  warn: "border-l-warn bg-warnSoft text-text",
  info: "border-l-borderStrong bg-surface text-text",
};

const SEVERITY_LABEL: Record<string, string> = {
  error: "text-error",
  warn: "text-warn",
  info: "text-textSecondary",
};

const FIXABLE_CHECKS = new Set([
  "frontmatter",
  "token_min",
  "token_max",
  "entity",
  "bridge_sentence",
]);

function issueToFix(it: ValidationIssue): AutoFixAction | null {
  const numMatch = it.message.match(/(\d+)\s+tokens?/);
  const currentTokens = numMatch ? parseInt(numMatch[1], 10) : 0;
  if (it.check === "frontmatter") {
    return {
      type: "fix_frontmatter",
      location: it.location,
      current_tokens: 0,
      message: it.message,
    };
  }
  if (it.check === "token_min") {
    return {
      type: "merge_short",
      location: it.location,
      current_tokens: currentTokens,
      message: it.message,
    };
  }
  if (it.check === "token_max") {
    return {
      type: "shrink",
      location: it.location,
      current_tokens: currentTokens,
      message: it.message,
    };
  }
  if (it.check === "entity" || it.check === "bridge_sentence") {
    return {
      type: "rewrite",
      location: it.location,
      current_tokens: currentTokens,
      message: it.message,
    };
  }
  return null;
}

export function ValidationPanel({
  result,
  onAutoFix,
  fixing,
  onJump,
}: {
  result: ValidateResult | null;
  onAutoFix?: (fixes: AutoFixAction[]) => void;
  fixing?: boolean;
  onJump?: (issue: ValidationIssue) => void;
}) {
  if (!result) {
    return (
      <Section title="Validation">
        <div className="text-xs text-muted">
          8-point self-check appears here after standardization.
        </div>
      </Section>
    );
  }

  const { issues, summary } = result;
  const total = summary.error + summary.warn + summary.info;

  const seenFrontmatter = { v: false };
  const fixes = issues
    .filter((it) => FIXABLE_CHECKS.has(it.check))
    .map(issueToFix)
    .filter((f): f is AutoFixAction => {
      if (!f) return false;
      if (f.type === "fix_frontmatter") {
        if (seenFrontmatter.v) return false;
        seenFrontmatter.v = true;
      }
      return true;
    });

  return (
    <Section title="Validation">
      <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
        <Pill count={summary.error} label="errors" tone="error" />
        <Pill count={summary.warn} label="warns" tone="warn" />
        <Pill count={summary.info} label="info" tone="info" />
      </div>
      {fixes.length > 0 && onAutoFix && (
        <button
          className="w-full mb-2 text-[12px] font-medium text-white bg-warn hover:opacity-90 disabled:opacity-50 rounded-md px-3 py-1.5 flex items-center justify-center gap-1.5 transition"
          onClick={() => onAutoFix(fixes)}
          disabled={fixing}
        >
          <Wand2 className="w-3.5 h-3.5" />
          {fixing ? "Fixing…" : `Auto-fix ${fixes.length} issue${fixes.length > 1 ? "s" : ""}`}
        </button>
      )}
      {total === 0 ? (
        <div className="text-xs text-success flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />
          All 8 checks passed.
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto scrollbar-slim space-y-1">
          {issues.map((it, i) => {
            const fixable = FIXABLE_CHECKS.has(it.check);
            const clickable = !!onJump;
            const Tag = clickable ? "button" : "div";
            return (
              <Tag
                key={i}
                onClick={clickable ? () => onJump?.(it) : undefined}
                className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border-l-2 ${
                  SEVERITY_STYLE[it.severity]
                } ${
                  clickable ? "hover:ring-2 hover:ring-accent/30 cursor-pointer transition" : ""
                }`}
                title={clickable ? "Click to jump to this location in the editor" : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`font-mono text-[10px] uppercase tracking-wider ${
                      SEVERITY_LABEL[it.severity]
                    }`}
                  >
                    {it.severity} · {it.location}
                  </div>
                  {fixable && (
                    <span className="text-[9px] uppercase font-mono text-accent bg-accentSoft border border-accent/20 rounded px-1.5 py-0.5">
                      auto-fixable
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-text">{it.message}</div>
              </Tag>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Pill({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "error" | "warn" | "info";
}) {
  const cls =
    tone === "error"
      ? "bg-errorSoft text-error border-error/20"
      : tone === "warn"
        ? "bg-warnSoft text-warn border-warn/20"
        : "bg-surfaceAlt text-textSecondary border-border";
  return (
    <div className={`rounded-md px-2 py-1.5 text-center border ${cls}`}>
      <div className="text-base font-semibold leading-none">{count}</div>
      <div className="text-[9px] uppercase mt-1 tracking-wider">{label}</div>
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
