/**
 * Inline citations in Spark's text.
 *
 * Spark cites evidence as `[src_<id>]`. When the id is a source this analysis
 * actually recorded, the marker becomes a citation segment (rendered as a
 * link chip); an unknown id stays as the literal text, so nothing is
 * invented. Text is otherwise passed through exactly as received.
 */

export type TextSegment = { text: string } | { cite: string };

const CITATION = /\[(src_[A-Za-z0-9]+)\]/g;

export function citationSegments(text: string, knownSourceIds: ReadonlySet<string>): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const id = match[1];
    if (!knownSourceIds.has(id)) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ cite: id });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** Source ids cited in a text, in first-appearance order, limited to known sources. */
export function citedSourceIds(text: string, knownSourceIds: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(CITATION)) {
    const id = match[1];
    if (knownSourceIds.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
