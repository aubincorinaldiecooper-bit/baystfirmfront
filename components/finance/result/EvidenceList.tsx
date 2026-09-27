"use client";

import type { EvidenceItem } from "@/lib/api/types";
import { stanceLabel, stanceTone } from "@/lib/analysis/labels";
import { Badge, Section } from "../ui";
import { CitedText, SourceRefs, type SourceIndex } from "./sources";

/* A list of backend evidence items: the claim, its period and the sources it
 * cites. Only the stance label is shown for items that carry one. */
export function EvidenceItems({ items, sources }: { items: EvidenceItem[]; sources: SourceIndex }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => {
        const inlineCites = /\[src_[A-Za-z0-9]+\]/.test(item.text);
        return (
          <li key={index} className="rounded-[10px] bg-surface px-3 py-2.5 text-[13px] leading-[1.55] text-ink shadow-card">
            <CitedText text={item.text} sources={sources} />
            {(item.period_label || item.stance || (!inlineCites && item.source_ids.length > 0)) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {item.stance && <Badge tone={stanceTone(item.stance)}>{stanceLabel(item.stance)}</Badge>}
                {item.period_label && <Badge>{item.period_label}</Badge>}
                {!inlineCites && <SourceRefs ids={item.source_ids} sources={sources} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function EvidenceSection({
  id,
  title,
  items,
  sources,
}: {
  id: string;
  title: string;
  items: EvidenceItem[];
  sources: SourceIndex;
}) {
  if (items.length === 0) return null;
  return (
    <Section id={id} title={title} count={items.length}>
      <EvidenceItems items={items} sources={sources} />
    </Section>
  );
}
