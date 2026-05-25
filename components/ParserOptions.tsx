"use client";

export function ParserOptions({
  compressEnabled,
  setCompressEnabled,
}: {
  compressEnabled: boolean;
  setCompressEnabled: (b: boolean) => void;
}) {
  return (
    <label className="bg-bg rounded-lg p-3 border border-border flex items-center gap-2 cursor-pointer hover:border-borderStrong transition">
      <input
        type="checkbox"
        checked={compressEnabled}
        onChange={(e) => setCompressEnabled(e.target.checked)}
        className="w-4 h-4 accent-accent cursor-pointer"
      />
      <span className="text-[13px] font-medium text-text select-none">
        Compress before upload
      </span>
    </label>
  );
}
