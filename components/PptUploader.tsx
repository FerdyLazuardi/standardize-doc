"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { toast } from "sonner";

export function PptUploader({
  onUpload,
  busy,
  status,
}: {
  onUpload: (file: File) => void;
  busy: boolean;
  status?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const name = file.name.toLowerCase();
      const isLegacyPpt = name.endsWith(".ppt") && !name.endsWith(".pptx");
      if (isLegacyPpt) {
        toast.error(
          "Legacy .ppt is not supported. Open the deck in PowerPoint and save it as .pptx or .pdf."
        );
        return;
      }
      if (
        !name.endsWith(".pdf") &&
        !name.endsWith(".pptx") &&
        !name.endsWith(".xlsx")
      ) {
        toast.error("Only .pdf, .pptx, and .xlsx files are accepted.");
        return;
      }
      setFilename(file.name);
      onUpload(file);
    },
    [onUpload]
  );

  return (
    <div
      className={`bg-bg rounded-lg p-4 border-2 border-dashed transition cursor-pointer ${
        drag ? "border-accent bg-accentSoft" : "border-border hover:border-borderStrong"
      } ${busy ? "opacity-60 pointer-events-none" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,.xlsx"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex items-center gap-2 text-sm font-medium text-text">
        {filename ? (
          <FileText className="w-4 h-4 text-accent" />
        ) : (
          <Upload className="w-4 h-4 text-muted" />
        )}
        <span className="truncate">
          {busy ? "Parsing…" : filename ?? "Drop a .pdf, .pptx, or .xlsx here"}
        </span>
      </div>
      <div className="text-xs text-muted mt-1.5">
        {busy
          ? status || "Working with LlamaParse…"
          : "Or click to browse. .pdf / .pptx → deck. .xlsx → script (per-row chunking). Preview is PDF only."}
      </div>
    </div>
  );
}
