"use client";

/* The settled analysis: the backend's structured result, section by section,
 * exactly as it provides it. Spark's text is the explanation (the summary,
 * the section narratives and the per-horizon text); every figure is a
 * recorded calculation's display string. Sections with nothing in them are
 * not rendered. A cancelled or failed run shows what it preserved. */

import { useEffect } from "react";
import NewsSection from "@/components/markets/NewsSection";
import StreamingText from "@/components/primitives/StreamingText";
import type { AnalysisResult } from "@/lib/api/types";
import { citationSegments } from "@/lib/analysis/citations";
import { requirementLabels } from "@/lib/analysis/requirements";
import { useRecentSearches } from "@/lib/search/recents";
import { Notice, Section } from "../ui";
import CalculationsTable from "./CalculationsTable";
import EvidenceSection from "./EvidenceList";
import { Conflicts, FreshnessSummary, TextList } from "./EvidenceQuality";
import HorizonAssessments from "./HorizonAssessments";
import Reconciliation from "./Reconciliation";
import RequirementChips from "./RequirementChips";
import SourcesList from "./SourcesList";
import StructuredSection from "./StructuredSection";
import ThesisDiff from "./ThesisDiff";
import { CitedText, sourceIndex, useSourcePick, type SourceIndex } from "./sources";

const STRUCTURED_SECTIONS = [
  ["fundamentals", "Fundamentals"],
  ["valuation", "Valuation"],
  ["benchmark_context", "Benchmark context"],
  ["historical_context", "Historical context"],
  ["market_context", "Market context"],
] as const;

function StockFilings({ symbol }: { symbol: string }) {
  const ticker = symbol.trim().toUpperCase();
  const { record } = useRecentSearches();

  useEffect(() => {
    if (/^[A-Z0-9.-]{1,10}$/.test(ticker)) record({ kind: "stock", id: `stock:${ticker}`, label: ticker });
  }, [record, ticker]);

  if (!ticker) return null;
  return (
    <NewsSection
      title="SEC filings · SEC EDGAR via Baystfirm"
      feed="filings"
      tickers={[ticker]}
      limit={10}
      emptyMessage={`No SEC filings returned for ${ticker}.`}
      description="A separate list of SEC EDGAR filing links; not company-research evidence."
    />
  );
}

export function StreamedText({ text, sources, streaming }: { text: string; sources: SourceIndex; streaming: boolean }) {
  const pick = useSourcePick();
  const known = new Set(sources.keys());
  const segments = citationSegments(text, known);
  const cited = segments.flatMap((s) => ("cite" in s ? [s.cite] : []));
  const streamingSources = [...new Set(cited)].flatMap((id) => {
    const source = sources.get(id);
    return source ? [{ id, name: source.title, domain: source.publisher ?? undefined, href: source.url }] : [];
  });
  return <StreamingText fill content={segments} streaming={streaming} sources={streamingSources} onCite={pick ?? undefined} />;
}

export default function ResultView({
  result,
  showRequirements = true,
}: {
  result: AnalysisResult;
  /** The analysis page shows the labels once, above the trace. */
  showRequirements?: boolean;
}) {
  const sources = sourceIndex(result.sources);
  const { assessment } = result;
  const completed = result.status === "completed";
  const requirements = showRequirements ? requirementLabels(result.requirements) : [];

  return (
    <div className="@container">
      {completed && result.partial && (
        <Notice kind="warn" role="status" title="This assessment is incomplete.">
          The synthesis was cut off or a horizon section is missing. What was produced is shown as recorded.
        </Notice>
      )}

      {requirements.length > 0 && (
        <div className="mt-4">
          <RequirementChips labels={requirements} />
        </div>
      )}

      {assessment.summary && (
        <Section id="summary" title="Assessment">
          <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-ink">
            <CitedText text={assessment.summary} sources={sources} />
          </p>
        </Section>
      )}

      {!completed && result.streamed_text && (
        <Section id="partial-synthesis" title="Partial synthesis (cut off)">
          <div className="rounded-[10px] bg-surface p-3.5 shadow-card">
            <StreamedText text={result.streamed_text} sources={sources} streaming={false} />
          </div>
        </Section>
      )}

      <HorizonAssessments assessments={result.horizon_assessments} sources={sources} />
      <ThesisDiff diff={result.thesis_diff} />
      <Reconciliation calculations={result.calculations} />
      <EvidenceSection id="what-changed" title="What changed" items={assessment.what_changed} sources={sources} />
      <EvidenceSection id="bull" title="Bull evidence" items={assessment.bull_evidence} sources={sources} />
      <EvidenceSection id="bear" title="Bear evidence" items={assessment.bear_evidence} sources={sources} />
      <EvidenceSection id="risks" title="Risks" items={assessment.risks} sources={sources} />
      {STRUCTURED_SECTIONS.map(([key, title]) => (
        <StructuredSection key={key} id={key.replace(/_/g, "-")} title={title} data={assessment[key]} sources={sources} />
      ))}
      <Conflicts conflicts={assessment.conflicts} sources={sources} />
      <TextList id="uncertainties" title="Uncertainties" items={assessment.uncertainties} />
      <CalculationsTable calculations={result.calculations} sources={sources} />
      <FreshnessSummary summary={result.freshness_summary} research={completed ? result.telemetry.research : null} />
      <SourcesList sources={result.sources} />
      {result.instrument && <StockFilings symbol={result.instrument.symbol} />}
      <TextList id="follow-ups" title="Follow-up questions" items={assessment.follow_up_questions} />

      {completed && result.streamed_text && (
        <details className="mt-8 rounded-[10px] bg-surface p-3.5 shadow-card">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Synthesis text as streamed</summary>
          <div className="mt-3">
            <StreamedText text={result.streamed_text} sources={sources} streaming={false} />
          </div>
        </details>
      )}
    </div>
  );
}
