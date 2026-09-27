/**
 * Product-level requirement labels (backend PR #4, optional and unstable).
 *
 * `research.started` and the result may carry `requirements`: short labels
 * such as "Valuation history" or "Price performance" that say what the
 * question needs. The shape is not final, so this reads it defensively: plain
 * strings, or objects with a string `label`, and nothing else. Anything long,
 * multi-line or structured is dropped rather than shown, so an internal plan
 * or reasoning text can never reach the page through this field.
 */

const MAX_LABEL_LENGTH = 64;
const MAX_LABELS = 12;

function labelOf(item: unknown): string | null {
  const raw =
    typeof item === "string"
      ? item
      : typeof item === "object" && item !== null && typeof (item as { label?: unknown }).label === "string"
        ? (item as { label: string }).label
        : null;
  if (raw === null) return null;
  const label = raw.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH || /[\r\n]/.test(label)) return null;
  return label;
}

export function requirementLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const item of value) {
    const label = labelOf(item);
    if (label !== null && !labels.includes(label)) labels.push(label);
    if (labels.length === MAX_LABELS) break;
  }
  return labels;
}
