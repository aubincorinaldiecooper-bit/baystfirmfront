"use client";

/* Small controls shared by the analysis workspace: a segmented group of
 * pressed/unpressed buttons, pills, a spinner, and a hook that measures an
 * element so charts can size themselves from the space they are given. */

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface Size {
  width: number;
  height: number;
}

/** A callback ref and the element's current content-box size (0×0 until measured). */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, Size] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useIsoLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  const ref = useCallback((next: T | null) => setNode(next), []);
  return [ref, size];
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
}

/** A row of toggle buttons where exactly one is pressed (`role="group"`, `aria-pressed`). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  disabled = false,
  className,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex shrink-0 gap-0.5 rounded-[9px] bg-hover-2 p-0.5", className)}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            aria-label={option.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "h-[26px] px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
              pressed ? "bg-surface text-ink shadow-btn" : "text-ink-2 enabled:hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type PillTone = "accent" | "gain" | "warn" | "neutral" | "loss";

const PILL_TONES: Record<PillTone, string> = {
  accent: "bg-accent-tint text-accent-text",
  gain: "bg-green-tint text-gain",
  warn: "bg-orange-tint text-warn",
  loss: "bg-red-tint text-loss",
  neutral: "bg-hover text-ink-2",
};

export function Pill({ tone = "neutral", pulse = false, className, children }: { tone?: PillTone; pulse?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", PILL_TONES[tone], className)}>
      {pulse && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A small tag, square-ish (reason and state labels in lists). */
export function Tag({ tone = "neutral", className, children }: { tone?: PillTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-[6px] px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap", PILL_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={cn("shrink-0 animate-spin text-accent", className)}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

/** Pulsing placeholder lines while something is actually in flight. */
export function SkeletonLines({ widths }: { widths: readonly string[] }) {
  return (
    <div aria-hidden className="flex flex-col gap-3 pt-1">
      {widths.map((width, index) => (
        <div key={index} className="h-[11px] animate-pulse rounded-[6px] bg-hover-2" style={{ width }} />
      ))}
    </div>
  );
}

export type SourceTone = "filing" | "data" | "company" | "news";

const MONO_TONES: Record<SourceTone, string> = {
  filing: "bg-accent-tint text-accent-text",
  data: "bg-green-tint text-gain",
  company: "bg-orange-tint text-warn",
  news: "bg-hover-2 text-ink-2",
};

export function sourceTone(sourceType: string): SourceTone {
  switch (sourceType) {
    case "regulatory_filing":
    case "financial_statement":
      return "filing";
    case "market_data":
    case "exchange_data":
      return "data";
    case "investor_relations":
    case "earnings_release":
    case "earnings_transcript":
      return "company";
    default:
      return "news";
  }
}

export function Monogram({ letter, tone = "news", size = "md", round = false }: { letter: string; tone?: SourceTone; size?: "xs" | "sm" | "md" | "lg"; round?: boolean }) {
  const sizes = { xs: "size-[15px] rounded-[4px] text-[9.5px]", sm: "size-[22px] rounded-[6px] text-[11px]", md: "size-7 rounded-[8px] text-[12px]", lg: "size-8 text-[14px]" };
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center font-semibold", sizes[size], round && "rounded-full", MONO_TONES[tone])}>
      {letter}
    </span>
  );
}

export const SERIES_COLOR: Record<string, string> = {
  company: "var(--series-company)",
  broad_market: "var(--series-market)",
  sector: "var(--series-sector)",
};

/** Text color class for a signed figure (never a series color). */
export function signClass(value: number | null | undefined): string {
  if (typeof value !== "number" || value === 0) return "text-ink-2";
  return value > 0 ? "text-gain" : "text-loss";
}
