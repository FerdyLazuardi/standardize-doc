// Constants shared between server-side (lib/llamaparse.ts) and browser-side
// (lib/llamaparse-client.ts) LlamaParse callers.

export const LLAMAPARSE_BASE_URL = "https://api.cloud.llamaindex.ai";

export const DEFAULT_PARSING_INSTRUCTION = `\
This document is either a PowerPoint slide deck or a PDF (often a deck exported / compressed to PDF). Extract content with these rules:
- Each slide title or major page heading becomes a Markdown H1 (#).
- Bullet points stay as Markdown bullets.
- Tables stay as Markdown tables.
- Images: insert a brief description in italics inline where the image appears.
- Flowcharts/diagrams: convert to a numbered list of steps if possible.
- Preserve the original reading order (top-to-bottom, left-to-right).
- Strip slide numbers, page indicators, and footer watermarks.`;
