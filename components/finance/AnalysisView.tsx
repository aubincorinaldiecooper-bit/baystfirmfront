"use client";

/* One analysis at /analyses/{id}: the question and what the backend resolved,
 * live progress from the event stream, Spark's text as it streams, then the
 * structured result. Cancel, structured errors, partial results, reload and
 * reconnect all go through useAnalysisRun; see there for the lifecycle. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleStop, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import { isTerminalStatus } from "@/lib/api/types";
import { isoDate, statusLabel, statusTone } from "@/lib/analysis/labels";
import { requirementLabels } from "@/lib/analysis/requirements";
import { horizonLabel, profileLabel } from "@/lib/analysis/progress";
import { isTerminalUiStatus, type AnalysisViewState } from "@/lib/analysis/reducer";
import { useAnalysisRun, type AnalysisRun } from "@/lib/analysis/useAnalysisRun";
import { instrumentRefFor, useSubmitAnalysis } from "@/lib/analysis/useSubmitAnalysis";
import CandidatePicker from "./CandidatePicker";
import { AnalysisErrorPanel, RequestErrorPanel } from "./ErrorPanels";
import PageHeader from "./PageHeader";
import { LiveSources, ProgressTrace } from "./ProgressPanel";
import RequirementChips from "./result/RequirementChips";
import ResultView, { StreamedText } from "./result/ResultView";
import { sourceIndex } from "./result/sources";
import { Badge, Notice } from "./ui";
import { useWorkspace } from "./workspace";

function Summary({ state }: { state: AnalysisViewState }) {
  const instrument = state.instrument;
  const meta = [profileLabel(state.profile), horizonLabel(state.resolvedHorizon), state.asOf ? `as of ${isoDate(state.asOf)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {instrument && (
          <span className="text-[13px] font-medium text-ink-2">
            {instrument.name}
            <span className="ml-1.5 font-mono text-[12px] text-ink-3">
              {[instrument.symbol, instrument.exchange].filter(Boolean).join(" · ")}
            </span>
          </span>
        )}
        <Badge tone={statusTone(state.status)} dot>
          {statusLabel(state.status)}
        </Badge>
        {state.cancelRequested && !isTerminalUiStatus(state.status) && <Badge tone="orange">Cancelling</Badge>}
      </div>
      <h1 className="mt-2 text-[20px] font-semibold leading-snug tracking-tight text-ink">{state.query}</h1>
      {meta && <p className="mt-1 text-[12.5px] text-ink-3">{meta}</p>}
    </div>
  );
}

function ConnectionNotice({ run }: { run: AnalysisRun }) {
  if (isTerminalUiStatus(run.state.status)) return null;
  if (run.connection === "reconnecting") {
    return (
      <Notice kind="warn" role="status" title="Connection interrupted. Reconnecting to the live updates…">
        The backend replays everything after the last update received, so nothing is lost.
      </Notice>
    );
  }
  if (run.connection === "lost") {
    return (
      <Notice
        kind="warn"
        role="status"
        title={
          <span className="inline-flex items-center gap-2">
            <WifiOff size={14} aria-hidden /> Live updates stopped.
          </span>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={run.reconnect}>
            <RefreshCw size={12} aria-hidden />
            Reconnect
          </Button>
        }
      >
        The analysis may still be running on the backend. Reconnect to resume from the last update received.
      </Notice>
    );
  }
  return null;
}

export default function AnalysisView({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const { history } = useWorkspace();
  const run = useAnalysisRun(analysisId, {
    onSettled: (_id, live) => {
      if (live) history.refreshHead();
    },
  });
  const rerun = useSubmitAnalysis((response) => {
    history.refreshHead();
    router.push(`/analyses/${encodeURIComponent(response.analysis_id)}`);
  });
  const { state } = run;
  const terminal = isTerminalUiStatus(state.status);
  const running = !terminal && run.load === "ready";
  const settled = state.result && isTerminalStatus(state.result.status) ? state.result : null;
  const liveSources = sourceIndex(state.sources);
  /* PR #4 (optional): the result's labels when it has them, else those from research.started */
  const resultLabels = settled ? requirementLabels(settled.requirements) : [];
  const requirements = resultLabels.length > 0 ? resultLabels : state.research.requirements;
  const preserved =
    state.partial &&
    (state.sources.length > 0 ||
      state.calculations.items.length > 0 ||
      state.spark.text.length > 0 ||
      Boolean(settled && (settled.sources.length > 0 || settled.calculations.length > 0 || settled.streamed_text)));

  const cancelButton = running ? (
    <Button
      variant="secondary"
      size="sm"
      onClick={run.cancel}
      disabled={run.cancelling || state.cancelRequested}
      aria-label="Cancel analysis"
    >
      <CircleStop size={13} aria-hidden />
      {state.cancelRequested || run.cancelling ? "Cancelling…" : "Cancel"}
    </Button>
  ) : undefined;

  const resubmit = () => {
    if (!state.query || !state.profile) return;
    rerun.submit({ query: state.query, profile: state.profile, horizon: state.resolvedHorizon ?? "auto" });
  };

  return (
    <>
      <PageHeader title={state.query || "Analysis"} actions={cancelButton} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-4 pb-20 pt-6 sm:px-8 sm:pt-8">
          {run.load === "loading" && <LoadingState label="Loading the analysis" variant="Dots" showElapsed={false} />}

          {run.load === "not_found" && (
            <Notice kind="warn" role="alert" title="This analysis doesn't exist on the backend.">
              <p>{run.loadError?.message}</p>
              <p className="mt-2">
                <Link href="/" className="font-medium text-ink underline">
                  Start a new analysis
                </Link>
              </p>
            </Notice>
          )}

          {run.load === "error" && run.loadError && <RequestErrorPanel error={run.loadError} onRetry={run.retryLoad} />}

          {run.load === "ready" && (
            <div className="flex flex-col gap-5">
              <Summary state={state} />
              <ConnectionNotice run={run} />
              {run.cancelError && <RequestErrorPanel error={run.cancelError} onRetry={run.cancel} />}

              {(state.status === "failed" || state.status === "cancelled") && state.error && (
                <AnalysisErrorPanel
                  error={state.error}
                  status={state.status}
                  preserved={preserved}
                  onRetry={resubmit}
                  onChoose={(candidate) => {
                    if (!state.profile) return;
                    rerun.submit({
                      query: state.query,
                      profile: state.profile,
                      horizon: state.resolvedHorizon ?? "auto",
                      instrument: instrumentRefFor(candidate),
                    });
                  }}
                  busy={rerun.state.status === "submitting"}
                />
              )}
              {rerun.state.status === "error" && (
                <RequestErrorPanel
                  error={rerun.state.error}
                  onRetry={() => rerun.state.status === "error" && rerun.submit(rerun.state.request)}
                />
              )}
              {rerun.state.status === "ambiguous" && (
                <CandidatePicker
                  message={rerun.state.message}
                  candidates={rerun.state.candidates}
                  onChoose={rerun.choose}
                  onDismiss={rerun.dismiss}
                />
              )}

              {requirements.length > 0 && <RequirementChips labels={requirements} />}

              {(running || state.milestones.length > 0) && <ProgressTrace state={state} />}

              {!settled && state.spark.text && (
                <section aria-label="Assessment as it is written" className="rounded-[12px] bg-surface p-4 shadow-card">
                  <StreamedText
                    text={state.spark.text}
                    sources={liveSources}
                    streaming={!terminal && state.spark.phase === "streaming"}
                  />
                </section>
              )}

              {(running || state.milestones.length > 0) && <LiveSources state={state} />}

              {terminal && run.resultStatus === "loading" && (
                <LoadingState label="Loading the structured result" variant="Dots" showElapsed={false} />
              )}
              {run.resultStatus === "error" && run.resultError && (
                <RequestErrorPanel error={run.resultError} onRetry={run.reloadResult} />
              )}

              {settled && <ResultView result={settled} showRequirements={false} />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
