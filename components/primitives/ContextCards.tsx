"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed. */

/* ─────────────────────────────────────────────────────────
 * CONTEXT CARDS
 * Retrieved items enter once, then remain available. Every
 * card is given by the caller; an empty list renders nothing.
 * Cards appear the moment they arrive: no staggered or
 * delayed reveal.
 * ───────────────────────────────────────────────────────── */

export type ContextChunk = {
  /** stable key, e.g. a source id */
  id: string;
  title: string;
  /** short secondary line in the card bar, e.g. a date or fiscal period */
  meta?: string;
  /** short excerpt; never a full document */
  body?: string;
  /** label on the source chip */
  source: string;
  href?: string;
  /** tiny badge on the source chip, e.g. a source-type abbreviation */
  badge?: string;
  /** Tailwind background class for the badge, e.g. "bg-accent" */
  tone?: string;
};

export default function ContextCards({
  header,
  chunks,
  count,
  className,
}: {
  header: string;
  chunks: ContextChunk[];
  /** count shown next to the header; defaults to the number of chunks */
  count?: string;
  className?: string;
}) {
  if (chunks.length === 0) return null;

  return (
    <div className={`flex w-full max-w-95 flex-col gap-2${className ? ` ${className}` : ""}`}>
      <div
        className="flex items-center gap-2 px-0.5"
        style={{ animation: "fade-in 400ms ease-out both" }}
      >
        <span className="text-[13px] font-semibold text-ink">{header}</span>
        <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline tabular-nums">
          {count ?? String(chunks.length)}
        </span>
      </div>

      {chunks.map((chunk) => {
        const chip = (
          <>
            {chunk.badge && (
              <span className={`flex h-3.5 min-w-3.5 items-center justify-center rounded-[4px] px-0.5 ${chunk.tone ?? "bg-ink-3"} text-[7px] font-bold text-white`}>
                {chunk.badge}
              </span>
            )}
            <span className="truncate">{chunk.source}</span>
            {chunk.href && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7M7 7h10v10" /></svg>
            )}
          </>
        );
        const chipClass =
          "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn transition-colors duration-150 hover:bg-hover";
        return (
          <div
            key={chunk.id}
            className="overflow-hidden rounded-card bg-surface shadow-card"
            style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
          >
            <div className="primitive-card-bar flex items-center gap-2.5 border-b border-line">
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                <span className="truncate">{chunk.title}</span>
              </span>
              {chunk.meta && <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{chunk.meta}</span>}
            </div>
            {chunk.body && <p className="px-3 pt-2 pb-1 text-[12.5px] leading-relaxed text-ink-2">{chunk.body}</p>}
            <div className="px-3 pt-1 pb-3">
              {chunk.href ? (
                <a href={chunk.href} target="_blank" rel="noreferrer" className={chipClass}>
                  {chip}
                </a>
              ) : (
                <span className={chipClass}>{chip}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
