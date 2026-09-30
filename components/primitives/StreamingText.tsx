"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed; optional `onCite` turns inline citation chips into buttons. */

import { useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT
 * Renders the text it is given, exactly as given, with a
 * caret while `streaming` is true. It never replays text on a
 * timer: network-delivered text is the clock. Inline citation
 * chips, the actions row, the sources list and follow-up
 * prompts appear only when the caller supplies them, and only
 * once streaming has stopped (citations show inline at once).
 * ───────────────────────────────────────────────────────── */

/** a run of text, or an inline citation of a source by id */
export type StreamingSegment = { text: string } | { cite: string };

export type StreamingSource = {
  id: string;
  name: string;
  /** short secondary label, e.g. a domain or publisher */
  domain?: string;
  href: string;
};

export type StreamingAction = {
  key: string;
  /** accessible name, e.g. "Copy answer" */
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

function Monogram({ name, className }: { name: string; className: string }) {
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center bg-field font-sans font-semibold text-ink-2 ${className}`}>
      {name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

const CITE_CLASS = `ml-0 mr-1 inline-flex h-4.5 translate-y-[-1px] items-center gap-1 rounded-[5px]
  bg-inset pr-[3px] pl-[3px] align-middle font-mono text-[10.5px] text-ink-2 shadow-hairline
  transition-colors duration-150 hover:bg-hover hover:text-ink`;

function SourceChip({ source, onCite }: { source?: StreamingSource; onCite?: (id: string) => void }) {
  if (!source) return null;
  if (onCite) {
    return (
      <button
        type="button"
        onClick={() => onCite(source.id)}
        title={source.name}
        aria-label={`Show source: ${source.domain ?? source.name}`}
        className={CITE_CLASS}
        style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <Monogram name={source.name} className="size-3 rounded-[3px] text-[8px]" />
        <span>{source.domain ?? source.name}</span>
      </button>
    );
  }
  return (
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer"
      className="ml-0 mr-1 inline-flex h-4.5 translate-y-[-1px] items-center gap-1 rounded-[5px]
        bg-inset pr-[3px] pl-[3px] align-middle font-mono text-[10.5px] text-ink-2 shadow-hairline
        transition-colors duration-150 hover:bg-hover hover:text-ink"
      style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <Monogram name={source.name} className="size-3 rounded-[3px] text-[8px]" />
      <span>{source.domain ?? source.name}</span>
    </a>
  );
}

export type StreamingLabels = {
  /** label on the collapsed sources toggle; defaults to "N sources" */
  sources: string;
  /** heading above the follow-up prompts */
  followUps: string;
};

export default function StreamingText({
  content,
  streaming,
  sources = [],
  actions = [],
  followUps = [],
  labels,
  fill = false,
  onFollowUp,
  onCite,
}: {
  /** the text received so far; segments allow inline citations */
  content: string | StreamingSegment[];
  /** true while more text may arrive: shows the caret, hides the footer */
  streaming: boolean;
  /** cited sources for inline chips and the sources list */
  sources?: StreamingSource[];
  actions?: StreamingAction[];
  /** follow-up prompt suggestions shown once streaming stops */
  followUps?: string[];
  labels?: Partial<StreamingLabels>;
  /** fill the parent width instead of the gallery's fixed measure */
  fill?: boolean;
  /** fired when a follow-up prompt is chosen */
  onFollowUp?: (text: string, index: number) => void;
  /** when given, inline citation chips are buttons that call it with the source id */
  onCite?: (id: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const segments: StreamingSegment[] = typeof content === "string" ? [{ text: content }] : content;
  const sourcesLabel = labels?.sources ?? `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
  const followUpsLabel = labels?.followUps ?? "Follow-ups";
  const settled = !streaming;
  const showFooter = settled && (actions.length > 0 || sources.length > 0);

  return (
    <div className={fill ? "w-full" : "w-full max-w-95"}>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink" aria-busy={streaming}>
        {segments.map((segment, i) =>
          "cite" in segment ? (
            <SourceChip key={i} source={sources.find((s) => s.id === segment.cite)} onCite={onCite} />
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
        {streaming && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink"
            style={{ animation: "fade-in 150ms ease-out both" }}
          />
        )}
      </p>

      {showFooter && (
        <div className="mt-2 flex items-center gap-0.5" style={{ animation: "fade-in 300ms ease-out both" }}>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
              className="flex size-6 items-center justify-center rounded-[6px] text-ink-3
                transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
            >
              {action.icon}
            </button>
          ))}
          {sources.length > 0 && (
            <button
              type="button"
              aria-expanded={sourcesOpen}
              onClick={() => setSourcesOpen((current) => !current)}
              className="ml-1.5 flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left transition-colors duration-150 hover:bg-hover"
            >
              <span className="flex -space-x-1">
                {sources.slice(0, 5).map((source) => (
                  <Monogram
                    key={source.id}
                    name={source.name}
                    className="size-3.5 rounded-full text-[8px] shadow-[0_0_0_1.5px_var(--canvas)]"
                  />
                ))}
              </span>
              <span className="text-[12px] text-ink-2">{sourcesLabel}</span>
            </button>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300"
          style={{
            gridTemplateRows: settled && sourcesOpen ? "1fr" : "0fr",
            opacity: settled && sourcesOpen ? 1 : 0,
            transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          <div className="overflow-hidden">
            <div className="mt-1.5 flex flex-col rounded-[10px] bg-inset p-1 shadow-hairline">
              {sources.map((source) => (
                <a
                  key={source.id}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={settled && sourcesOpen ? undefined : -1}
                  className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink"
                >
                  <Monogram name={source.name} className="size-4 rounded-[4px] text-[9px]" />
                  <span className="animated-underline">{source.name}</span>
                  {source.domain && <span className="ml-auto font-mono text-[10.5px] text-ink-3">{source.domain}</span>}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {settled && followUps.length > 0 && (
        <div className="mt-2.5" style={{ animation: "fade-in 300ms ease-out both" }}>
          <p className="text-[12px] font-medium text-ink-2">{followUpsLabel}</p>
          <div className="mt-0.5 flex flex-col">
            {followUps.map((text, i) => (
              <button
                key={text}
                type="button"
                onClick={() => onFollowUp?.(text, i)}
                className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-line
                  px-1.5 py-1.5 text-left text-[12.5px] text-ink transition-colors
                  duration-100 hover:bg-hover-2"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
