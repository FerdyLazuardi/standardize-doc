// Browser-only compression utilities. NEVER import from server code.
// All work happens in the user's tab — Vercel functions are never involved.

export type CompressOptions = {
  quality?: number;
  maxDimension?: number;
  onProgress?: (current: number, total: number, label: string) => void;
};

export type CompressResult = {
  blob: Blob;
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  unitsProcessed: number;
  notes: string[];
};

export class LegacyPptError extends Error {
  constructor() {
    super("Legacy .ppt binary format not supported. Save as .pptx in PowerPoint first.");
    this.name = "LegacyPptError";
  }
}

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

let pdfWorkerConfigured = false;

async function configurePdfWorker(): Promise<void> {
  if (pdfWorkerConfigured) return;
  const pdfjs = await import("pdfjs-dist");
  // Webpack/Next.js resolves `new URL(...module, import.meta.url)` at build time
  // and emits the worker as a hashed static asset.
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfWorkerConfigured = true;
}

function pickCanvas(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  toBlob: (type: string, quality: number) => Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get OffscreenCanvas 2D context");
    return {
      canvas,
      ctx,
      toBlob: (type, quality) => canvas.convertToBlob({ type, quality }),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get HTMLCanvas 2D context");
  return {
    canvas,
    ctx,
    toBlob: (type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          type,
          quality
        );
      }),
  };
}

export async function compressPdf(
  file: File,
  opts: CompressOptions = {}
): Promise<CompressResult> {
  const quality = opts.quality ?? 0.7;
  const maxDimension = opts.maxDimension ?? 1600;
  const originalBytes = file.size;

  await configurePdfWorker();
  const pdfjs = await import("pdfjs-dist");
  const { PDFDocument } = await import("pdf-lib");

  const ab = await file.arrayBuffer();
  const srcDoc = await pdfjs.getDocument({ data: new Uint8Array(ab) }).promise;
  const total = srcDoc.numPages;
  const outDoc = await PDFDocument.create();

  for (let i = 1; i <= total; i++) {
    opts.onProgress?.(i, total, `Compressing PDF (page ${i}/${total})`);
    const page = await srcDoc.getPage(i);
    const viewport0 = page.getViewport({ scale: 1 });
    // Source page natural pixel size at 1.5x rendering for some sharpness
    const naturalLong = Math.max(viewport0.width, viewport0.height) * 1.5;
    const targetLong = Math.min(naturalLong, maxDimension);
    const scale = targetLong / Math.max(viewport0.width, viewport0.height);
    const viewport = page.getViewport({ scale });

    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const { canvas, ctx, toBlob } = pickCanvas(width, height);

    // pdfjs render expects a CanvasRenderingContext2D-compatible interface
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const jpegBlob = await toBlob("image/jpeg", quality);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const jpeg = await outDoc.embedJpg(jpegBytes);

    // Match the source page's PDF point dimensions so geometry stays correct
    const newPage = outDoc.addPage([viewport0.width, viewport0.height]);
    newPage.drawImage(jpeg, {
      x: 0,
      y: 0,
      width: viewport0.width,
      height: viewport0.height,
    });

    page.cleanup();
  }

  const outBytes = await outDoc.save({ useObjectStreams: true });
  const blob = new Blob([outBytes as BlobPart], { type: "application/pdf" });

  return {
    blob,
    originalBytes,
    compressedBytes: blob.size,
    ratio: originalBytes ? blob.size / originalBytes : 1,
    unitsProcessed: total,
    notes: [],
  };
}

const RECOMPRESSABLE_RE = /^ppt\/(media|embeddings)\/[^/]+\.(png|jpe?g|bmp|tiff?)$/i;

export async function compressPptx(
  file: File,
  opts: CompressOptions = {}
): Promise<CompressResult> {
  const quality = opts.quality ?? 0.7;
  const maxDimension = opts.maxDimension ?? 1600;
  const originalBytes = file.size;
  const notes: string[] = [];

  if (file.name.toLowerCase().endsWith(".ppt")) {
    throw new LegacyPptError();
  }

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);

  const targets: string[] = [];
  zip.forEach((path) => {
    if (RECOMPRESSABLE_RE.test(path)) targets.push(path);
  });

  if (targets.length === 0) {
    notes.push("No re-encodable images found — file passed through unchanged.");
    return {
      blob: file,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      unitsProcessed: 0,
      notes,
    };
  }

  let replacedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const path = targets[i];
    opts.onProgress?.(i + 1, targets.length, `Recompressing image ${i + 1}/${targets.length}`);

    const entry = zip.file(path);
    if (!entry) continue;
    const origBlob = await entry.async("blob");
    const origSize = origBlob.size;

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(origBlob);
    } catch {
      // Could not decode (corrupt or unsupported variant) — keep original
      continue;
    }

    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > maxDimension ? maxDimension / longEdge : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const { ctx, toBlob } = pickCanvas(w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const out = await toBlob("image/jpeg", quality);
    if (out.size >= origSize) {
      // No win — keep original
      continue;
    }

    // Stuff JPEG bytes into the original filename to keep PPTX rels intact
    const buf = new Uint8Array(await out.arrayBuffer());
    zip.file(path, buf as unknown as Uint8Array, { binary: true });
    replacedCount++;
  }

  if (replacedCount === 0) {
    notes.push("No images benefited from recompression — file passed through unchanged.");
    return {
      blob: file,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 1,
      unitsProcessed: targets.length,
      notes,
    };
  }

  const outBlob = (await zip.generateAsync(
    {
      type: "blob",
      mimeType: PPTX_MIME,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    } as Parameters<typeof zip.generateAsync>[0]
  )) as Blob;

  return {
    blob: outBlob,
    originalBytes,
    compressedBytes: outBlob.size,
    ratio: originalBytes ? outBlob.size / originalBytes : 1,
    unitsProcessed: replacedCount,
    notes,
  };
}
