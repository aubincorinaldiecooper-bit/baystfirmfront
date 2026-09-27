"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed. */

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS
 * Recorded tool activity as compact rows with inline chips,
 * optionally followed by change chips (label + added/removed
 * counts) that preview their lines on hover. Every row is
 * given by the caller and shown immediately: there is no
 * timed reveal. Rows with detail lines expand to show them.
 * An empty run renders nothing.
 * ───────────────────────────────────────────────────────── */

const Icons = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  calc: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 6h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18.5h.01M12 18.5h.01M15 18.5h.01" /></g>,
} satisfies Record<string, ReactNode>;

export type ToolIconName = keyof typeof Icons;

export type ToolDetailLine = { text: string; tone?: "add" | "del" };

export type ToolStep = {
  id: string;
  /** a built-in glyph name, or any icon node */
  icon: ToolIconName | ReactNode;
  label: string;
  chip: string;
  mono?: boolean;
  detailMono?: boolean;
  detail?: ToolDetailLine[];
};

export type ToolDiff = { file: string; add: number; del: number };

export type ToolDiffLine = { text: string; tone: "add" | "del" | "ctx" };

function isIconName(icon: ToolStep["icon"]): icon is ToolIconName {
  return typeof icon === "string" && icon in Icons;
}

export default function ToolChips({
  header,
  steps,
  diffs = [],
  diffLines = {},
  more,
  defaultOpen = true,
  className,
  onOpenChange,
  onToggleRow,
}: {
  /** run summary, e.g. "4 calculations" */
  header: string;
  steps: ToolStep[];
  diffs?: ToolDiff[];
  diffLines?: Record<string, ToolDiffLine[]>;
  /** trailing text after the change chips, e.g. "+2 more" */
  more?: string;
  defaultOpen?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  onToggleRow?: (id: string, open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  /* Rendered in a body portal so animated/translated reply wrappers cannot
   * redefine the fixed-position coordinate system. */
  const [preview, setPreview] = useState<{
    file: string;
    x: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  if (steps.length === 0 && diffs.length === 0) return null;

  const openPreview = (file: string) => (event: React.SyntheticEvent) => {
    const rect = (event.currentTarget as Element).closest("[data-diffchip]")!.getBoundingClientRect();
    const previewHeight = 38 + (diffLines[file]?.length ?? 0) * 19;
    const fitsBelow = rect.bottom + 6 + previewHeight <= window.innerHeight - 12;
    setPreview({
      file,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      ...(fitsBelow
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    });
  };
  const closePreview = (file: string) => () =>
    setPreview((current) => (current?.file === file ? null : current));

  const toggleRow = (id: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onToggleRow?.(id, next.has(id));
      return next;
    });

  const previewDiff = preview ? diffs.find((diff) => diff.file === preview.file) : undefined;

  return (
    <div className={`w-full max-w-80 pb-1${className ? ` ${className}` : ""}`}>
      {/* collapsed run header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() =>
          setOpen((current) => {
            onOpenChange?.(!current);
            return !current;
          })
        }
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">{header}</span>
      </button>

      {/* tool call rows */}
      <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the
            row hover pills room inside this overflow-hidden clip box */}
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {steps.map((row) => {
              const detail = row.detail ?? [];
              const expandable = detail.length > 0;
              const rowOpen = expandable && openRows.has(row.id);
              const glyph = isIconName(row.icon) ? (
                <svg
                  width="13" height="13" viewBox="0 0 24 24" fill={row.icon === "think" ? "currentColor" : "none"} stroke="currentColor"
                  className={`transition-opacity duration-100 ${expandable ? "group-hover/row:opacity-0" : ""} ${rowOpen ? "opacity-0" : ""}`}
                  aria-hidden
                >
                  {Icons[row.icon]}
                </svg>
              ) : (
                <span className={`flex transition-opacity duration-100 ${expandable ? "group-hover/row:opacity-0" : ""} ${rowOpen ? "opacity-0" : ""}`}>{row.icon}</span>
              );
              const inner = (
                <>
                  <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                    {glyph}
                    {expandable && (
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                        className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                        style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    )}
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                  <span
                    className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5
                      text-[11.5px] text-ink-2 shadow-hairline tabular-nums ${row.mono ? "font-mono" : ""}`}
                  >
                    {row.chip}
                  </span>
                </>
              );
              const rowClass =
                "group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left";
              return (
                <div key={row.id} style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  {expandable ? (
                    <button
                      type="button"
                      aria-expanded={rowOpen}
                      onClick={() => toggleRow(row.id)}
                      className={`${rowClass} transition-colors duration-100 hover:bg-hover-2`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={rowClass}>{inner}</div>
                  )}

                  {/* expanded detail */}
                  {expandable && (
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-300"
                      style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                          {detail.map((line, index) => (
                            <span
                              key={index}
                              className={`truncate text-[11.5px] leading-[1.6] ${row.detailMono ? "font-mono" : ""} ${
                                line.tone === "add" ? "text-green" : line.tone === "del" ? "text-red" : "text-ink-2"
                              }`}
                            >
                              {line.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* change chips */}
          {diffs.length > 0 && (
            <div className={`flex max-w-full flex-wrap gap-1.5 ${steps.length > 0 ? "mt-2.5 border-t border-line pt-2.5" : "mt-1.5"}`}>
              {diffs.map((d) => (
                <span
                  key={d.file}
                  data-diffchip
                  className="relative"
                  onMouseEnter={openPreview(d.file)}
                  onMouseLeave={closePreview(d.file)}
                >
                  <button
                    type="button"
                    aria-expanded={preview?.file === d.file}
                    aria-label={`Show changes for ${d.file}`}
                    onFocus={openPreview(d.file)}
                    onBlur={closePreview(d.file)}
                    className="inline-flex h-7 max-w-full items-center gap-2 rounded-chip
                      bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn
                      transition-colors duration-100 hover:bg-hover"
                    style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
                  >
                    <span className="min-w-0 truncate">{d.file}</span>
                    <span className="shrink-0 text-green tabular-nums">+{d.add}</span>
                    {d.del > 0 && <span className="shrink-0 text-red tabular-nums">−{d.del}</span>}
                  </button>
                </span>
              ))}
              {more && (
                <span className="inline-flex h-7 items-center rounded-chip px-1.5 font-mono text-[11.5px] text-ink-3">{more}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 w-72 overflow-hidden rounded-[10px] bg-surface shadow-overlay"
          style={{
            left: preview.x,
            top: preview.top,
            bottom: preview.bottom,
            animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
            transformOrigin: preview.top === undefined ? "bottom left" : "top left",
          }}
        >
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5 font-mono text-[11px]">
            <span className="min-w-0 truncate text-ink-2">{preview.file}</span>
            {previewDiff && (
              <span className="shrink-0 tabular-nums">
                <span className="text-green">+{previewDiff.add}</span>
                {previewDiff.del > 0 && <span className="text-red"> −{previewDiff.del}</span>}
              </span>
            )}
          </div>
          <div className="py-1 font-mono text-[11px] leading-[1.8]">
            {(diffLines[preview.file] ?? []).map((line, index) => (
              <div
                key={index}
                className={`flex gap-2 px-2.5 whitespace-pre ${
                  line.tone === "add"
                    ? "bg-green-tint text-green"
                    : line.tone === "del"
                      ? "bg-red-tint text-red"
                      : "text-ink-2"
                }`}
              >
                <span className="w-3 shrink-0 select-none">{line.tone === "add" ? "+" : line.tone === "del" ? "−" : " "}</span>
                <span className="min-w-0 truncate">{line.text}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
