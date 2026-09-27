"use client";

/* Product-level requirement labels (backend PR #4, optional): what the
 * question needs, e.g. "Valuation history". Plain chips, nothing more. The
 * labels arrive already filtered by `requirementLabels`. */

export default function RequirementChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="What this question needs">
      <span className="mr-1 text-[12px] text-ink-3">Looking at</span>
      <ul className="contents">
        {labels.map((label) => (
          <li
            key={label}
            className="inline-flex h-6 items-center rounded-full bg-inset px-2.5 text-[12px] font-medium text-ink-2 shadow-hairline"
          >
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
