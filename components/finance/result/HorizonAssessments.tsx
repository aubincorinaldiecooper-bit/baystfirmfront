"use client";

/* Per-horizon assessments: Laya's stance and the confidence in that decision
 * (never an outcome probability), with Spark's explanation for the horizon. */

import { SINGLE_HORIZONS, type HorizonAssessment } from "@/lib/api/types";
import { stanceLabel, stanceTone, verbatim } from "@/lib/analysis/labels";
import { horizonLabel } from "@/lib/analysis/progress";
import { Badge, Section } from "../ui";
import { EvidenceItems } from "./EvidenceList";
import { CitedText, type SourceIndex } from "./sources";

function ordered(assessments: Record<string, HorizonAssessment>): HorizonAssessment[] {
  const known = SINGLE_HORIZONS.filter((h) => assessments[h]).map((h) => assessments[h]);
  const rest = Object.keys(assessments)
    .filter((key) => !(SINGLE_HORIZONS as readonly string[]).includes(key))
    .map((key) => assessments[key]);
  return [...known, ...rest];
}

export default function HorizonAssessments({
  assessments,
  sources,
}: {
  assessments: Record<string, HorizonAssessment>;
  sources: SourceIndex;
}) {
  const items = ordered(assessments);
  if (items.length === 0) return null;
  return (
    <Section id="horizons" title="By horizon" count={items.length}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <article
            key={item.horizon}
            aria-label={horizonLabel(item.horizon)}
            className="flex min-w-0 flex-col gap-2 rounded-[12px] bg-surface p-3.5 shadow-card"
          >
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-[13.5px] font-semibold text-ink">{horizonLabel(item.horizon)}</h3>
              <Badge tone={stanceTone(item.stance)} dot>
                {stanceLabel(item.stance)}
              </Badge>
              {item.low_confidence && <Badge tone="orange">Low confidence</Badge>}
            </header>
            <p
              className="text-[12px] text-ink-3"
              title="Confidence in the structured stance decision, not a probability of the outcome."
            >
              Decision confidence <span className="font-mono text-ink-2">{verbatim(item.confidence)}</span>
            </p>
            {item.summary ? (
              <p className="text-[13px] leading-[1.6] text-ink">
                <CitedText text={item.summary} sources={sources} />
              </p>
            ) : null}
            {!item.synthesized && (
              <p className="text-[12.5px] text-orange">No synthesis was produced for this horizon.</p>
            )}
            {item.key_evidence.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">Key evidence</p>
                <EvidenceItems items={item.key_evidence} sources={sources} />
              </div>
            )}
          </article>
        ))}
      </div>
    </Section>
  );
}
