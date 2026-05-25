// Strip noise (cover/back slides, footers, watermarks) from raw markdown.
// Direct port of backend/app/postprocess/noise_filter.py.

export type NoiseFilterConfig = {
  patterns: string[];
  dropFirstIfTitleOnly: boolean;
  dropLastSlidePhrases: string[];
};

export const DEFAULT_NOISE_PATTERNS: string[] = [
  // Footer / watermark
  String.raw`^Amartha\s+Confidential.*$`,
  String.raw`^©\s*\d{4}\s+(PT\s+)?Amartha.*$`,
  String.raw`^\d+\s*/\s*\d+$`,
  String.raw`^Page\s+\d+(\s+of\s+\d+)?$`,
  // Cover / back-cover signals
  String.raw`^Thank\s*you[!\.]?$`,
  String.raw`^Terima\s+Kasih[!\.]?$`,
  String.raw`^Q\s*&\s*A$`,
  String.raw`^Q\s*and\s*A$`,
  String.raw`^Backup\s+Slides?$`,
  // Date stamps
  String.raw`^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}$`,
];

export const DEFAULT_DROP_LAST_PHRASES = ["thank you", "terima kasih", "q&a", "q and a"];

export function defaultConfig(): NoiseFilterConfig {
  return {
    patterns: [...DEFAULT_NOISE_PATTERNS],
    dropFirstIfTitleOnly: true,
    dropLastSlidePhrases: [...DEFAULT_DROP_LAST_PHRASES],
  };
}

function splitSlides(markdown: string): string[] {
  if (!markdown.trim()) return [];
  // Split on H1 boundaries (each H1 starts a new slide)
  const parts = markdown.split(/(?=^#\s+)/m).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [markdown.trim()];
}

function isTitleOnlySlide(slide: string): boolean {
  const lines = slide
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return true;
  if (!lines[0].startsWith("#")) return false;
  const body = lines.slice(1);
  if (!body.length) return true;
  if (body.length === 1 && body[0].length < 80) return true;
  return false;
}

function slideMatchesDropPhrase(slide: string, phrases: string[]): boolean {
  const head = slide.toLowerCase().split(/\s+/).slice(0, 8).join(" ");
  return phrases.some((p) => head.includes(p));
}

export type NoiseFilterStats = {
  original_slides: number;
  kept_slides: number;
  dropped_slides: string[];
  noise_lines_stripped: number;
};

export function filterNoise(
  markdown: string,
  config: NoiseFilterConfig = defaultConfig()
): { cleaned: string; stats: NoiseFilterStats } {
  const lineRe = new RegExp(config.patterns.map((p) => `(?:${p})`).join("|"));

  let slides = splitSlides(markdown);
  const originalCount = slides.length;
  const dropped: string[] = [];

  if (slides.length && config.dropFirstIfTitleOnly && isTitleOnlySlide(slides[0])) {
    dropped.push("first (title-only)");
    slides = slides.slice(1);
  }
  if (
    slides.length &&
    config.dropLastSlidePhrases.length &&
    slideMatchesDropPhrase(slides[slides.length - 1], config.dropLastSlidePhrases)
  ) {
    dropped.push("last (thank-you / Q&A / closing)");
    slides = slides.slice(0, -1);
  }

  let linesStripped = 0;
  const cleanedSlides: string[] = [];
  for (const slide of slides) {
    const kept: string[] = [];
    for (const line of slide.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && lineRe.test(trimmed) && lineRe.exec(trimmed)?.[0] === trimmed) {
        linesStripped += 1;
        continue;
      }
      kept.push(line);
    }
    const slideClean = kept.join("\n").trim();
    if (slideClean) cleanedSlides.push(slideClean);
  }

  let cleaned = cleanedSlides.join("\n\n").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return {
    cleaned,
    stats: {
      original_slides: originalCount,
      kept_slides: cleanedSlides.length,
      dropped_slides: dropped,
      noise_lines_stripped: linesStripped,
    },
  };
}
