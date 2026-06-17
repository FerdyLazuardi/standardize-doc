"use client";
import { useCallback, useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { toast } from "sonner";

export type LoadedDoc = { name: string; markdown: string };

export function MdBulkUploader({
  onFiles,
  busy,
  count,
}: {
  onFiles: (docs: LoadedDoc[]) => void;
  busy?: boolean;
  count?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const isMd = (name: string) => {
    const n = name.toLowerCase();
    return n.endsWith(".md") || n.endsWith(".markdown");
  };

  const handleFiles = useCallback(
    async (fileList: FileList | null | undefined) => {
      const all = Array.from(fileList ?? []);
      if (all.length === 0) return;
      const accepted = all.filter((f) => isMd(f.name));
      if (accepted.length === 0) {
        toast.error("Only .md / .markdown files are accepted.");
        return;
      }
      const skipped = all.length - accepted.length;
      if (skipped > 0) {
        toast.error(`Skipped ${skipped} unsupported file(s).`);
      }
      try {
        const docs = await Promise.all(
          accepted.map(async (file) => ({ name: file.name, markdown: await file.text() }))
        );
        onFiles(docs);
        toast.success(`Loaded ${docs.length} markdown file(s).`);
      } catch {
        toast.error("Failed to read one or more files.");
      }
    },
    [onFiles]
  );

  return (
    <div
      className={`bg-bg rounded-lg p-4 border-2 border-dashed transition cursor-pointer ${drag ? "border-accent bg-accentSoft" : "border-border hover:border-borderStrong"} ${busy ? "opacity-60 pointer-events-none" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      <div className="flex items-center gap-2 text-sm font-medium text-text">
        {count && count > 0 ? <FileText className="w-4 h-4 text-accent" /> : <Upload className="w-4 h-4 text-muted" />}
        <span className="truncate">
          {busy
            ? "Reading…"
            : count && count > 0
            ? `${count} file(s) loaded — drop more to add`
            : "Drop standardized .md files here (multiple)"}
        </span>
      </div>
      <div className="text-xs text-muted mt-1.5">Or click to browse. Bulk-upload your standardized markdown to scan for duplicate context.</div>
    </div>
  );
}
