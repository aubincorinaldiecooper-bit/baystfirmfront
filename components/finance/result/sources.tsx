"use client";

/* Source references: citation chips that jump to the source in the evidence
 * list, and text with Spark's `[src_…]` markers turned into those chips. */

import type { SourcePublicView } from "@/lib/api/types";
import { citationSegments } from "@/lib/analysis/citations";

export type SourceIndex = ReadonlyMap<string, Pick<SourcePublicView, "source_id" | "title" | "publisher" | "url">>;

export function sourceIndex(sources: readonly Pick<SourcePublicView, "source_id" | "title" | "publisher" | "url">[]): SourceIndex {
  return new Map(sources.map((s) => [s.source_id, s]));
}

export function sourceAnchor(sourceId: string): string {
  return `source-${sourceId}`;
}

export function SourceChip({ id, sources }: { id: string; sources: SourceIndex }) {
  const source = sources.get(id);
  if (!source) return <span className="font-mono text-[11px] text-ink-3">{id}</span>;
  return (
    <a
      href={`#${sourceAnchor(id)}`}
      title={source.title}
      className="inline-flex h-5 max-w-[14rem] translate-y-[-1px] items-center rounded-[5px] bg-inset px-1.5 align-middle text-[11px] font-medium text-ink-2 shadow-hairline transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      <span className="truncate">{source.publisher ?? source.title}</span>
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
