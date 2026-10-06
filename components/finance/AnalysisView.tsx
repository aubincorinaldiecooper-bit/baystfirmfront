"use client";

/* One analysis at /analyses/{id}, as a workspace: the main window (company
 * performance or trading view, with the live research dock at its bottom),
 * a collapsible right panel (the analysis itself, or the symbol and the
 * watchlist) and a slim rail that opens it. Cancel, structured errors,
 * partial results, reload and reconnect all go through useAnalysisRun; see
 * there for the lifecycle. Everything shown comes from recorded events or
 * the durable result. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import { isTerminalStatus } from "@/lib/api/types";
import { liveSources, researchFeed, sourceKey, type FeedFilter } from "@/lib/analysis/activity";
import { isoDate, statusLabel, statusTone } from "@/lib/analysis/labels";
import { requirementLabels } from "@/lib/analysis/requirements";
import { horizonLabel, profileLabel } from "@/lib/analysis/progress";
import { isTerminalUiStatus } from "@/lib/analysis/reducer";
import { useAnalysisRun, type AnalysisRun } from "@/lib/analysis/useAnalysisRun";
import { instrumentRefFor, useSubmitAnalysis } from "@/lib/analysis/useSubmitAnalysis";
import { marketData, symbolIdentity } from "@/lib/market/model";
import { lastClose, type RangeKey } from "@/lib/market/series";
import { useWatchlist } from "@/lib/market/watchlist";
import MainWindow, { type MainMode } from "./analysis/MainWindow";
import ResearchDock from "./analysis/ResearchDock";
import { isWideLayout, PanelRail, SidePanel, type PanelTab } from "./analysis/SidePanel";
import SymbolPanel from "./analysis/SymbolPanel";
import CandidatePicker from "./CandidatePicker";
import { AnalysisErrorPanel, RequestErrorPanel } from "./ErrorPanels";
import PageHeader from "./PageHeader";
import ViewModeToggle from "./ViewModeToggle";
import { ProgressTrace } from "./ProgressPanel";
import RequirementChips from "./result/RequirementChips";
import ResultView, { StreamedText } from "./result/ResultView";
import { SourcePickContext, sourceIndex } from "./result/sources";
import { Badge, Notice } from "./ui";
import { useWorkspace } from "./workspace";
import { useViewMode } from "@/lib/markets/useViewMode";

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
  const [viewMode, setViewMode] = useViewMode();
  const simple = viewMode === "simple" && settled?.status === "completed";
  const streamedSources = sourceIndex(state.sources);
  /* PR #4 (optional): the result's labels when it has them, else those from research.started */
  const resultLabels = settled ? requirementLabels(settled.requirements) : [];
  const requirements = resultLabels.length > 0 ? resultLabels : state.research.requirements;
  const preserved =
    state.partial &&
    (state.sources.length > 0 ||
      state.calculations.items.length > 0 ||
      state.spark.text.length > 0 ||
      Boolean(settled && (settled.sources.length > 0 || settled.calculations.length > 0 || settled.streamed_text)));

  /* workspace layout */
  const [mode, setMode] = useState<MainMode>("performance");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [table, setTable] = useState(false);
  /* null: follow the layout (beside the main window when wide, closed when it would be an overlay) */
  const [panelPref, setPanelPref] = useState<boolean | null>(null);
  const [wide, setWide] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("analysis");
  const [dockPref, setDockPref] = useState<boolean | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const watchlist = useWatchlist();

  useEffect(() => {
    setWide(isWideLayout());
  }, []);
  const panelOpen = panelPref ?? wide;

  const sources = useMemo(() => liveSources(state), [state]);
  const items = useMemo(() => researchFeed(state, sources), [state, sources]);
  const market = useMemo(() => marketData(state), [state]);
  const identity = symbolIdentity(state);
  /* open while the run is followed live, collapsed for an analysis that had already finished */
  const openedFinished = terminal && run.connection === "idle";
  const dockOpen = dockPref ?? !openedFinished;

  const pickSource = useCallback((sourceId: string) => {
    setPinned(sourceKey(sourceId));
    setDockPref(true);
    setFilter("all");
  }, []);

  const close = lastClose(market.bars);
  const watched = identity ? watchlist.isWatched(identity.symbol) : false;
  const onWatch = identity
    ? () =>
        watchlist.toggle({
          symbol: identity.symbol,
          name: identity.name,
          last_close: close?.close ?? null,
          change_pct: close?.pct ?? null,
          as_of: close?.date ?? null,
        })
    : null;

  const selectMode = (next: MainMode) => {
    setMode(next);
    setPanelTab(next === "trading" ? "symbol" : "analysis");
    if (isWideLayout()) setPanelPref(true);
  };

  const selectPanel = (tab: PanelTab) => {
    if (panelOpen && panelTab === tab) {
      setPanelPref(false);
      return;
    }
    setPanelTab(tab);
    setPanelPref(true);
  };

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
    rerun.submit({
      query: state.query,
      profile: state.profile,
      horizon: state.resolvedHorizon ?? "auto",
      /* the company this run resolved (possibly picked from candidates): a rerun must not ask again */
      ...(state.instrument ? { instrument: { symbol: state.instrument.symbol, exchange: state.instrument.exchange ?? null } } : {}),
    });
  };

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink" style={{ whiteSpace: "nowrap" }}>
        {state.query || "Analysis"}
      </h1>
      {run.load === "ready" && (
        <Badge tone={statusTone(state.status)} dot>
          {statusLabel(state.status)}
        </Badge>
      )}
      {state.cancelRequested && !terminal && <Badge tone="orange">Cancelling</Badge>}
    </span>
  );

  if (run.load !== "ready") {
    return (
      <>
        <PageHeader title={title} />
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
          </div>
        </div>
      </>
    );
  }

  const meta = [
    identity ? [identity.name !== identity.symbol ? identity.name : null, identity.symbol, identity.exchange].filter(Boolean).join(" · ") : null,
    profileLabel(state.profile),
    horizonLabel(state.resolvedHorizon),
    state.asOf ? `as of ${isoDate(state.asOf)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const notices = (
    <>
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
        <RequestErrorPanel error={rerun.state.error} onRetry={() => rerun.state.status === "error" && rerun.submit(rerun.state.request)} />
      )}
      {rerun.state.status === "ambiguous" && (
        <CandidatePicker message={rerun.state.message} candidates={rerun.state.candidates} onChoose={rerun.choose} onDismiss={rerun.dismiss} />
      )}
    </>
  );
  const hasNotices =
    (!terminal && (run.connection === "reconnecting" || run.connection === "lost")) ||
    Boolean(run.cancelError) ||
    ((state.status === "failed" || state.status === "cancelled") && Boolean(state.error)) ||
    rerun.state.status === "error" ||
    rerun.state.status === "ambiguous";

  const analysisTab = (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-4">
      {settled?.status === "completed" && (
        <div className="flex justify-end min-[1100px]:hidden">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      )}
      {state.query && (
        <p className="max-w-[320px] self-end rounded-[14px] bg-hover-2 px-3.5 py-2 text-[13.5px] leading-normal text-ink">{state.query}</p>
      )}
      {meta && <p className="text-[12px] text-ink-2">{meta}</p>}
      {!simple && requirements.length > 0 && <RequirementChips labels={requirements} />}
      {(running || state.milestones.length > 0) && <ProgressTrace state={state} />}
      {!settled && state.spark.text && (
        <section aria-label="Assessment as it is written" className="rounded-[12px] bg-surface p-4 shadow-card">
          <StreamedText text={state.spark.text} sources={streamedSources} streaming={!terminal && state.spark.phase === "streaming"} />
        </section>
      )}
      {running && !state.spark.text && (
        <p className="rounded-[10px] border border-dashed border-line-strong p-3 text-[12.5px] leading-normal text-ink-2">
          The assessment appears here as it is written. Follow the research as it happens in Live research, below the chart.
        </p>
      )}
      {terminal && run.resultStatus === "loading" && <LoadingState label="Loading the structured result" variant="Dots" showElapsed={false} />}
      {run.resultStatus === "error" && run.resultError && <RequestErrorPanel error={run.resultError} onRetry={run.reloadResult} />}
      {settled && <ResultView result={settled} showRequirements={false} simple={simple} />}
    </div>
  );

  return (
    <SourcePickContext.Provider value={pickSource}>
      <PageHeader
        title={title}
        actions={
          <>
            {cancelButton}
            {settled?.status === "completed" && (
              <div className="hidden min-[1100px]:flex">
                <ViewModeToggle value={viewMode} onChange={setViewMode} />
              </div>
            )}
          </>
        }
      />
      {hasNotices && <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3">{notices}</div>}
      <div className="relative flex min-h-0 flex-1">
        <MainWindow
          state={state}
          identity={identity}
          market={market}
          sources={sources}
          mode={mode}
          onMode={selectMode}
          range={range}
          onRange={setRange}
          table={table}
          onTable={() => setTable((t) => !t)}
          watched={watched}
          onWatch={onWatch}
          onPickSource={pickSource}
          dock={
            <ResearchDock
              state={state}
              items={items}
              sources={sources}
              open={dockOpen}
              onToggle={() => setDockPref(!dockOpen)}
              pinned={pinned}
              onPin={setPinned}
              onUnpin={() => setPinned(null)}
              filter={filter}
              onFilter={setFilter}
            />
          }
        />
        {panelOpen && (
          <SidePanel tab={panelTab} onTab={setPanelTab} onClose={() => setPanelPref(false)} autoHidden={panelPref === null}>
            {panelTab === "analysis" ? (
              analysisTab
            ) : (
              <SymbolPanel
                state={state}
                identity={identity}
                market={market}
                sources={sources}
                watchlist={watchlist.entries}
                watched={watched}
                onWatch={onWatch}
                onRemove={watchlist.toggle}
                onPickSource={pickSource}
              />
            )}
          </SidePanel>
        )}
        <PanelRail open={panelOpen} tab={panelTab} onSelect={selectPanel} />
      </div>
    </SourcePickContext.Provider>
  );
}
