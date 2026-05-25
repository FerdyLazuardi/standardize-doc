"use client";

import { useState } from "react";
import { Sparkles, Layers } from "lucide-react";
import { ParserOptions } from "./ParserOptions";
import { PptUploader } from "./PptUploader";
import { FrontmatterForm, type FormState } from "./FrontmatterForm";
import { ValidationPanel } from "./ValidationPanel";
import { ChunkPanel } from "./ChunkPanel";
import { RetrievalPanel } from "./RetrievalPanel";
import type {
  AutoFixAction,
  ChunkPreview,
  ChunksResult,
  RetrieveResult,
  ValidateResult,
  ValidationIssue,
} from "@/lib/api";

type Tab = "setup" | "analysis" | "testing";

type RetrieveItem = RetrieveResult["results"][number];

export type RightPanelProps = {
  compressEnabled: boolean;
  setCompressEnabled: (b: boolean) => void;
  onUpload: (file: File) => void;
  uploadBusy: boolean;
  parseStatus: string;
  form: FormState;
  setForm: (f: FormState) => void;
  validation: ValidateResult | null;
  chunks: ChunksResult | null;
  retrieval: RetrieveResult | null;
  suggestedQuestions: string[];
  questionsLoading: boolean;
  onRefreshQuestions: () => void;
  onAutoFix: (fixes: AutoFixAction[]) => void;
  onJumpToIssue: (issue: ValidationIssue) => void;
  onJumpToChunk: (chunk: ChunkPreview) => void;
  onJumpToResult: (result: RetrieveItem) => void;
  onQuery: (query: string, topK: number) => void;
  hasParsed: boolean;
  hasStandardized: boolean;
  busy: null | "parsing" | "standardize" | "analyze" | "fixing";
  onStandardize: () => void;
};

export function RightPanel(props: RightPanelProps) {
  const [tab, setTab] = useState<Tab>("setup");

  const ctaDisabled = !!props.busy || !props.hasParsed;
  const retrievalDisabled = !props.hasStandardized;
  const ctaHighlighted = props.hasParsed && !props.hasStandardized && !props.busy;

  return (
    <div className="bg-bg rounded-lg border border-border flex flex-col min-h-0 overflow-hidden">
      <div className="px-3 pt-3 border-b border-border bg-surface">
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text leading-tight">
              Standardize Knowledge Studio
            </h1>
            <p className="text-[10px] text-textSecondary leading-tight">
              PPT / PDF → RAG-optimized Markdown for A-Pedi
            </p>
          </div>
        </div>

        <div className="flex gap-1">
          <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
            Setup
          </TabButton>
          <TabButton
            active={tab === "analysis"}
            onClick={() => setTab("analysis")}
          >
            Analysis
          </TabButton>
          <TabButton
            active={tab === "testing"}
            onClick={() => setTab("testing")}
          >
            Testing
          </TabButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-slim p-3 flex flex-col gap-3">
        {tab === "setup" && (
          <>
            <PptUploader
              onUpload={props.onUpload}
              busy={props.uploadBusy}
              status={props.parseStatus}
            />
            <ParserOptions
              compressEnabled={props.compressEnabled}
              setCompressEnabled={props.setCompressEnabled}
            />
            <FrontmatterForm form={props.form} setForm={props.setForm} />
            <button
              className={`btn-primary w-full ${ctaHighlighted ? "btn-cta-pulse" : ""}`}
              disabled={ctaDisabled}
              onClick={props.onStandardize}
            >
              <Sparkles className="w-4 h-4" />
              {props.busy === "standardize" ? "Standardizing…" : "Standardize Markdown"}
            </button>
          </>
        )}
        {tab === "analysis" && (
          <>
            <ValidationPanel
              result={props.validation}
              onAutoFix={props.onAutoFix}
              fixing={props.busy === "fixing"}
              onJump={props.onJumpToIssue}
            />
            <ChunkPanel result={props.chunks} onJump={props.onJumpToChunk} />
          </>
        )}
        {tab === "testing" && (
          <RetrievalPanel
            result={props.retrieval}
            disabled={retrievalDisabled}
            onQuery={props.onQuery}
            questions={props.suggestedQuestions}
            questionsLoading={props.questionsLoading}
            onRefreshQuestions={props.onRefreshQuestions}
            onJumpToResult={props.onJumpToResult}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[12px] font-medium px-3 py-1.5 rounded-t-md border-b-2 transition ${
        active
          ? "border-accent text-accent bg-bg"
          : "border-transparent text-textSecondary hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
