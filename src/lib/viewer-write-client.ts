/** Headers for browser → API writes when VIEWER_WRITE_TOKEN is baked at build (see next.config). */
export function viewerWriteHeaders(): Record<string, string> {
  const t = process.env.NEXT_PUBLIC_VIEWER_WRITE_TOKEN?.trim();
  if (!t) return {};
  return { "x-viewer-write-token": t };
}
