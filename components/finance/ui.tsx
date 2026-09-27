"use client";

/* Small layout pieces shared by the analysis views. Content comes from props. */

import type { ReactNode } from "react";
import { AlertCircle, Info, TriangleAlert } from "lucide-react";
import { StatusPill } from "@/components/atoms/StatusPill";
import type { Tone } from "@/lib/analysis/labels";

export function Section({
  id,
  title,
  count,
  aside,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="mt-8 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {title}
          {count !== undefined && (
            <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <StatusPill tone={tone} dot={dot} className="h-5 px-2 text-[11.5px]">
      {children}
    </StatusPill>
  );
}

const NOTICE_STYLES: Record<"info" | "warn" | "error", { icon: ReactNode; className: string }> = {
  info: { icon: <Info size={15} aria-hidden />, className: "text-ink-2" },
  warn: { icon: <TriangleAlert size={15} aria-hidden />, className: "text-orange" },
  error: { icon: <AlertCircle size={15} aria-hidden />, className: "text-red" },
};

export function Notice({
  kind = "info",
  title,
  children,
  actions,
  role,
}: {
  kind?: "info" | "warn" | "error";
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status";
}) {
  const style = NOTICE_STYLES[kind];
  return (
    <div role={role} className="flex items-start gap-3 rounded-[10px] bg-surface px-4 py-3 shadow-card">
      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center ${style.className}`}>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">{title}</div>
        {children && <div className="mt-1 text-[12.5px] leading-[1.55] text-ink-2">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A labelled value in a definition list; renders nothing when the value is empty. */
export function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{label}</dt>
      <dd className={`min-w-0 break-words text-[13px] text-ink ${mono ? "font-mono text-[12px]" : ""}`}>{children}</dd>
    </div>
  );
}
