/**
 * Canvas text helpers. Pure: they take a `measure` callback rather than a
 * canvas context, so wrapping is unit-testable in node (the whole reason the
 * sim is DOM-free applies just as well to layout math).
 */
export type Measure = (text: string) => number;

/**
 * Greedy word wrap. Words longer than `maxWidth` (a URL, a huge number) are
 * left on their own line rather than broken mid-word — overflowing one long
 * token looks less broken than hyphenating everything.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

/**
 * Largest font size ≤ `preferred` that fits `text` in `maxWidth`, floored at
 * `min`. `measureAt` reports the width of the text at a given size — used for
 * single-line labels (a title, a stat) that must not wrap.
 */
export function fitFontSize(
  preferred: number,
  min: number,
  maxWidth: number,
  measureAt: (size: number) => number,
): number {
  const width = measureAt(preferred);
  if (width <= maxWidth || width <= 0) return preferred;
  return Math.max(min, Math.floor(preferred * (maxWidth / width)));
}
