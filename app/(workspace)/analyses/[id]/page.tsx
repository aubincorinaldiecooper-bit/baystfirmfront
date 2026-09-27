import type { Metadata } from "next";
import AnalysisView from "@/components/finance/AnalysisView";

/* One analysis per URL, so a reload or a history link reattaches to it: the
 * view reads the job, replays its events if it is still running, and renders
 * the structured result when it is done. */

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Analysis · BayAnalytics" };

export default async function AnalysisPage({ params }: PageProps) {
  const { id } = await params;
  return <AnalysisView key={id} analysisId={id} />;
}
