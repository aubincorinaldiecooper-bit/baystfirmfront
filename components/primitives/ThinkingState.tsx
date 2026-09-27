"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed; adds a "stopped" step status for work that ended without finishing. */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * THINKING — expandable execution trace, two variants
 *
 *   Steps   step list: spinner on active steps, muted checks
 *           on finished ones, a muted dash on stopped ones
 *   Search  a query plus the sources read, as links
 *
 * It renders exactly the steps it is given, with the status
 * each step is given. There are no timers, sequences or
 * staged reveals: the caller's recorded state is the clock.
 * While `active`, the trace is open; once it settles it
 * collapses unless the person toggled it. This is a progress
 * surface for recorded system state, never a reasoning viewer.
 * ───────────────────────────────────────────────────────── */

/** "stopped": the work ended without finishing (cancelled or failed); shown without a check. */
export type ThinkingStepStatus = "active" | "done" | "stopped";

export type ThinkingStep = {
  id: string;
  label: string;
  /** muted trailing text, e.g. a count or a domain */
  detail?: string;
  status: ThinkingStepStatus;
  /** render `detail` in the mono face */
  mono?: boolean;
  /** Search rows link to the source */
  href?: string;
};

export type ThinkingVariant = "Steps" | "Search";

function Dot() {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </span>
  );
}

export default function ThinkingState({
  label,
  active,
  steps,
  variant = "Steps",
  query,
  moreCount = 0,
  icon,
  defaultExpanded,
}: {
  /** header text, e.g. "Searching recent filings" or "Researched 6 sources" */
  label: string;
  /** whether the traced work is still running */
  active: boolean;
  steps: ThinkingStep[];
  variant?: ThinkingVariant;
  /** Search variant: the query shown above the sources */
  query?: string;
  /** Search variant: how many further items exist beyond `steps` */
  moreCount?: number;
  /** override the header glyph (defaults to the sparkle) */
  icon?: ReactNode;
  /** initial open state; defaults to open while active */
  defaultExpanded?: boolean;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(defaultExpanded ?? null);
  const expanded = manualExpanded ?? active;
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [steps, expanded, variant, query, moreCount]);

  const hasTrace = steps.length > 0 || Boolean(query) || moreCount > 0;

  return (
    <div className="flex w-full max-w-95 flex-col">
      <button
        type="button"
        aria-expanded={hasTrace ? expanded : undefined}
        disabled={!hasTrace}
        onClick={() => setManualExpanded((current) => !(current ?? active))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1
          transition-colors duration-100 enabled:hover:bg-hover-2"
      >
        {icon ? (
          <span className="flex shrink-0 transition-colors duration-200" style={{ color: active ? "var(--ink-2)" : "var(--ink-3)" }}>
            {icon}
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? "var(--ink-2)" : "var(--ink-3)"} aria-hidden>
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        <span role="status" aria-live="polite" className="contents">
          {active ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {label}
            </span>
          ) : (
            <span className="text-[13px] font-medium whitespace-nowrap text-ink-2" style={{ animation: "fade-in 350ms ease-out both" }}>
              {label}
            </span>
          )}
        </span>
        {hasTrace && (
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform duration-300"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {hasTrace && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-400"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
            transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          <div className="overflow-hidden">
            <div className="relative mt-1 ml-[5px] pl-4">
              <span
                aria-hidden
                className="absolute left-[3px] w-px bg-line"
                style={{ top: -8, height: lineHeight ? lineHeight - 2 : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
              />
              <div ref={traceRef} className="flex flex-col gap-1 py-1">
                {query && (
                  <div className="flex h-6 items-center gap-2 px-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                    <span className="text-[12.5px] text-ink-2">{query}</span>
                  </div>
                )}
                {steps.map((step) => {
                  const content = (
                    <>
                      {variant === "Search" && <Dot />}
                      {variant === "Steps" &&
                        (step.status === "stopped" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" className="shrink-0" aria-label="Stopped">
                            <path d="M6 12h12" />
                          </svg>
                        ) : step.status === "done" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-label="Done">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : (
                          <span
                            role="img"
                            aria-label="In progress"
                            className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
                            style={{ animation: "spin 700ms linear infinite" }}
                          />
                        ))}
                      <span className={`min-w-0 truncate text-[12.5px] font-medium text-ink ${variant === "Search" ? "animated-underline" : ""}`}>
                        {step.label}
                      </span>
                      {step.detail && (
                        <span className={`shrink-0 text-[11.5px] text-ink-3 ${step.mono ? "font-mono" : ""}`}>{step.detail}</span>
                      )}
                    </>
                  );
                  const rowClass = "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left";
                  const animation = { animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" };

                  if (variant === "Search" && step.href) {
                    return (
                      <a
                        key={step.id}
                        href={step.href}
                        target="_blank"
                        rel="noreferrer"
                        className={`${rowClass} transition-colors duration-150 hover:bg-hover`}
                        style={animation}
                      >
                        {content}
                      </a>
                    );
                  }
                  return (
                    <div key={step.id} className={rowClass} style={animation}>
                      {content}
                    </div>
                  );
                })}
                {moreCount > 0 && <span className="px-1.5 text-[12px] text-ink-3 tabular-nums">+{moreCount} more</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
