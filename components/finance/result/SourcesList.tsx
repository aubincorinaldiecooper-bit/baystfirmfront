"use client";

/* The evidence behind the assessment: every recorded source with its
 * provenance (publisher, type, primary or not), dates, fiscal period,
 * freshness (stale is flagged), redistribution terms and, when the terms
 * allow it, the short excerpt the backend kept. */

import { ExternalLink } from "lucide-react";
import type { SourceRecord } from "@/lib/api/types";
import { freshnessLabel, freshnessTone, isoDate, redistributionLabel, sourceTypeLabel } from "@/lib/analysis/labels";
import { Badge, Section } from "../ui";
import { sourceAnchor } from "./sources";

function SourceCard({ source }: { source: SourceRecord }) {
  const published = isoDate(source.published_at);
  const retrieved = isoDate(source.retrieved_at);
  return (
    <li id={sourceAnchor(source.source_id)} className="scroll-mt-16 rounded-[10px] bg-surface px-3.5 py-3 shadow-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mr-auto inline-flex min-w-0 max-w-full items-center gap-1.5 text-[13.5px] font-medium text-ink hover:underline"
        >
          <span className="min-w-0 break-words">{source.title}</span>
          <ExternalLink size={12} aria-hidden className="shrink-0 text-ink-3" />
        </a>
        <div className="flex flex-wrap items-center gap-1.5">
          {source.is_primary && <Badge tone="accent">Primary</Badge>}
          <Badge tone={freshnessTone(source.freshness)} dot>
            {freshnessLabel(source.freshness)}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-2">
        {[source.publisher, sourceTypeLabel(source.source_type), source.fiscal_period].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-0.5 text-[12px] text-ink-3">
        {published ? `Published ${published}` : "Publication date not reported"}
        {retrieved ? ` · Retrieved ${retrieved}` : ""}
      </p>
      {source.redistribution === "allowed" && source.excerpt ? (
        <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-[12.5px] leading-[1.55] text-ink-2">
          {source.excerpt}
        </blockquote>
      ) : null}
      <p className="mt-2 text-[11.5px] text-ink-3">
        {redistributionLabel(source.redistribution)}
        {source.redistribution !== "allowed" && source.excerpt ? " · excerpt not shown" : ""}
        {source.terms_note ? ` · ${source.terms_note}` : ""}
      </p>
      {source.rejected_reason && (
        <p className="mt-1 text-[12px] text-orange">Not used: {source.rejected_reason}</p>
      )}
    </li>
  );
}

export default function SourcesList({ sources }: { sources: SourceRecord[] }) {
  if (sources.length === 0) return null;
  const stale = sources.filter((s) => s.freshness === "stale").length;
  return (
    <Section
      id="sources"
      title="Sources"
      count={sources.length}
      aside={stale > 0 ? <Badge tone="orange">{stale} stale</Badge> : undefined}
    >
      <ul className="flex flex-col gap-2">
        {sources.map((source) => (
          <SourceCard key={source.source_id} source={source} />
        ))}
      </ul>
    </Section>
  );
}
