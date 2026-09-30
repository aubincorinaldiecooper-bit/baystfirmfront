/**
 * Inline citations in Spark's text.
 *
 * Spark cites evidence as `[src_<id>]`, or several at once as
 * `[src_a, src_b]` (the backend asks for that form). Each id this analysis
 * actually recorded becomes its own citation segment (rendered as a chip); an
 * unknown id stays as literal text, so nothing is invented. Text is otherwise
 * passed through exactly as received.
 */

export type TextSegment = { text: string } | { cite: string };

const SOURCE_ID = "src_[A-Za-z0-9]+";
/** One bracketed block of one or more comma-separated source ids. */
const CITATION = new RegExp(`\\[\\s*(${SOURCE_ID}(?:\\s*,\\s*${SOURCE_ID})*)\\s*\\]`, "g");

function idsOf(block: string): string[] {
  return block.split(",").map((id) => id.trim()).filter(Boolean);
}

export function citationSegments(text: string, knownSourceIds: ReadonlySet<string>): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous && "text" in previous) segments[segments.length - 1] = { text: previous.text + value };
    else segments.push({ text: value });
  };
  for (const match of text.matchAll(CITATION)) {
    const ids = idsOf(match[1]);
    if (!ids.some((id) => knownSourceIds.has(id))) continue; /* nothing recorded: keep the marker verbatim */
    const start = match.index ?? 0;
    pushText(text.slice(last, start));
    for (const id of ids) {
      if (knownSourceIds.has(id)) segments.push({ cite: id });
      else pushText(`[${id}]`); /* an unknown id in a mixed block stays literal */
    }
    last = start + match[0].length;
  }
  pushText(text.slice(last));
  return segments;
}

/** Source ids cited in a text, in first-appearance order, limited to known sources. */
export function citedSourceIds(text: string, knownSourceIds: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(CITATION)) {
    for (const id of idsOf(match[1])) {
      if (knownSourceIds.has(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
