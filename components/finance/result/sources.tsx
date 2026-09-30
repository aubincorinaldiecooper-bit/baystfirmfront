"use client";

/* Source references: citation chips and text with Spark's `[src_…]` markers
 * turned into those chips. On the analysis page a chip shows its source in
 * the live research view (the page provides `SourcePickContext`); elsewhere
 * it jumps to the source in the evidence list. */

import { createContext, useContext } from "react";
import type { SourcePublicView } from "@/lib/api/types";
import { citationSegments } from "@/lib/analysis/citations";

/** Show a source in the live research view; null where there is no such view. */
export const SourcePickContext = createContext<((sourceId: string) => void) | null>(null);

export function useSourcePick(): ((sourceId: string) => void) | null {
  return useContext(SourcePickContext);
}

export type SourceIndex = ReadonlyMap<string, Pick<SourcePublicView, "source_id" | "title" | "publisher" | "url">>;

export function sourceIndex(sources: readonly Pick<SourcePublicView, "source_id" | "title" | "publisher" | "url">[]): SourceIndex {
  return new Map(sources.map((s) => [s.source_id, s]));
}

export function sourceAnchor(sourceId: string): string {
  return `source-${sourceId}`;
}

const CHIP_CLASS =
  "inline-flex h-5 max-w-[14rem] translate-y-[-1px] items-center rounded-[5px] bg-inset px-1.5 align-middle text-[11px] font-medium text-ink-2 shadow-hairline transition-colors duration-150 hover:bg-hover hover:text-ink";

export function SourceChip({ id, sources }: { id: string; sources: SourceIndex }) {
  const pick = useSourcePick();
  const source = sources.get(id);
  if (!source) return <span className="font-mono text-[11px] text-ink-3">{id}</span>;
  const label = source.publisher ?? source.title;
  if (pick) {
    return (
      <button type="button" onClick={() => pick(id)} title={source.title} aria-label={`Show source: ${label}`} className={CHIP_CLASS}>
        <span className="truncate">{label}</span>
      </button>
    );
  }
  return (
    <a href={`#${sourceAnchor(id)}`} title={source.title} className={CHIP_CLASS}>
      <span className="truncate">{label}</span>
    </a>
  );
}

export function SourceRefs({ ids, sources }: { ids: readonly string[]; sources: SourceIndex }) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <SourceChip key={id} id={id} sources={sources} />
      ))}
    </span>
  );
}

/** Backend text with its citation markers rendered as chips; everything else verbatim. */
export function CitedText({ text, sources }: { text: string; sources: SourceIndex }) {
  const known = new Set(sources.keys());
  return (
    <>
      {citationSegments(text, known).map((segment, index) =>
        "cite" in segment ? (
          <span key={index} className="mx-0.5">
            <SourceChip id={segment.cite} sources={sources} />
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
