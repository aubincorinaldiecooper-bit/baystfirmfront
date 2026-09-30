/** @vitest-environment jsdom */
/**
 * The /analyses/[id] page lifecycle with the real reducer and the real SSE
 * handle (on a controllable EventSource), fed with the backend's recorded
 * events: attach and replay after a reload, live progress and streamed text,
 * the structured result on completion, network drops and reconnects, cancel,
 * structured failures, finished analyses opened from history, and not found.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalysisView from "@/components/finance/AnalysisView";
import type { AnalysisEvent, AnalysisEventOf, AnalysisResult } from "@/lib/api/types";
import { MILESTONE_EVENTS } from "@/lib/analysis/reducer";
import { cancelledRun, capabilitiesFixture, clone, completedRun, failedRun, jsonResponse, notFound } from "./fixtures/backend";
import { completedResult } from "./fixtures/events";
import { LIVE_EVENTS, LIVE_ID, URLS, seqOf } from "./fixtures/live";
import { WATCHLIST_KEY } from "@/lib/market/watchlist";
import { NO_PRICE_HISTORY, NO_QUARTERLY_FIGURES } from "@/lib/market/model";
import { FakeEventSource, openWithFakeEventSource, stubBackend, type RouteHandler } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}));

afterEach(cleanup);
beforeEach(() => {
  FakeEventSource.reset();
  nav.push.mockReset();
  window.localStorage.clear();
});

const running = (result: AnalysisResult, status: AnalysisResult["status"] = "researching"): AnalysisResult => ({
  ...clone(result),
  status,
  partial: status !== "queued",
  completed_at: null,
  horizon_assessments: {},
  streamed_text: "",
  error: null,
});

/** GET /analyses/{id} answers from a queue of snapshots (the last one repeats). */
function setup(id: string, snapshots: (AnalysisResult | RouteHandler)[], extra: Record<string, RouteHandler> = {}) {
  const queue = [...snapshots];
  const backend = stubBackend({
    "GET /capabilities": () => jsonResponse(200, capabilitiesFixture),
    "GET /analyses": () => jsonResponse(200, { analyses: [], next_cursor: null }),
    [`GET /analyses/${id}`]: (call) => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return typeof next === "function" ? next(call) : jsonResponse(200, next);
    },
    ...extra,
  });
  nav.pathname = `/analyses/${id}`;
  const view = renderWorkspace(<AnalysisView analysisId={id} />, { client: backend.client, openStream: openWithFakeEventSource });
  return { backend, view };
}

async function emit(es: FakeEventSource, events: AnalysisEvent[]) {
  await act(async () => {
    es.emitAll(events);
  });
}

const milestoneCount = (events: AnalysisEvent[]) => events.filter((e) => (MILESTONE_EVENTS as readonly string[]).includes(e.event)).length;
const traceSteps = () => document.querySelectorAll('[aria-label="Done"], [aria-label="In progress"], [aria-label="Stopped"]');

describe("attaching to a running analysis", () => {
  const { events, result } = completedRun;
  const id = result.analysis_id;
  const tokenAt = events.findIndex((e) => e.event === "spark.token") + 10;

  it("replays from the start, streams the text live and settles on the structured result", async () => {
    const { backend } = setup(id, [running(result), result]);
    await screen.findByRole("heading", { name: "Assess Apple." });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    expect(es.url).toBe(`/api/bay/analyses/${id}/events`); /* no ?after=: the backend replays everything */

    await act(async () => es.open());
    await emit(es, events.slice(0, tokenAt));
    expect(screen.getByRole("button", { name: "Cancel analysis" })).toBeTruthy();
    const live = screen.getByRole("region", { name: "Assessment as it is written" });
    expect(live.textContent).toContain("## Summary");
    expect(live.querySelector("[aria-busy=true]")).toBeTruthy();
    expect(traceSteps()).toHaveLength(milestoneCount(events.slice(0, tokenAt)));
    expect(screen.getAllByLabelText("In progress")).toHaveLength(1);

    await emit(es, events.slice(tokenAt));
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(es.closed).toBe(true);
    expect(backend.callsTo("GET", `/analyses/${id}`)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Cancel analysis" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Assessment as it is written" })).toBeNull();
    expect(screen.getByText("Analysis complete")).toBeTruthy();
    /* the finished run refreshes the history list */
    await waitFor(() => expect(backend.callsTo("GET", "/analyses").length).toBeGreaterThanOrEqual(2));
  });

  it("rebuilds the same trace after a reload mid-run, without duplicate steps", async () => {
    const first = setup(id, [running(result, "synthesizing")]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), events.slice(0, tokenAt));
    const before = traceSteps().length;
    first.view.unmount(); /* the browser reloads */
    expect(FakeEventSource.latest().closed).toBe(true);

    setup(id, [running(result, "synthesizing"), result]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const es = FakeEventSource.latest();
    expect(es.url).toBe(`/api/bay/analyses/${id}/events`);
    /* the replay repeats what the first page saw, then continues live */
    await emit(es, events.slice(0, tokenAt));
    expect(traceSteps()).toHaveLength(before);
    await emit(es, events.slice(tokenAt - 5));
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(traceSteps()).toHaveLength(milestoneCount(events));
  });
});

describe("requirement labels (backend PR #4, optional)", () => {
  const { events, result } = completedRun;
  const id = result.analysis_id;

  it("shows the labels from research.started once, live and after completion, never the intent", async () => {
    const withLabels = events.map((e) =>
      e.event === "research.started"
        ? ({ ...e, question_intent: "valuation_history_internal", requirements: ["Valuation history", "Price performance"], interpretation_source: "laya" } as AnalysisEvent)
        : e,
    );
    setup(id, [running(result), result]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, withLabels.slice(0, 5));
    const live = screen.getByLabelText("What this question needs");
    expect(within(live).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Valuation history", "Price performance"]);
    await emit(es, withLabels.slice(5));
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(screen.getAllByLabelText("What this question needs")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("valuation_history_internal");
  });
});

describe("network drops", () => {
  const { events, result } = completedRun;
  const id = result.analysis_id;
  const half = Math.floor(events.length / 2);

  it("shows the reconnect, then continues when the browser's retry delivers the tail", async () => {
    setup(id, [running(result), result]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, events.slice(0, half));
    await act(async () => es.fail(0));
    expect(screen.getByText(/Reconnecting to the live updates/)).toBeTruthy();
    await act(async () => es.open());
    expect(screen.queryByText(/Reconnecting to the live updates/)).toBeNull();
    await emit(es, events.slice(half));
    await screen.findByRole("region", { name: /^Assessment$/ });
  });

  it("falls back to the durable state when the stream gives up, and reconnects from the last seq", async () => {
    const { backend } = setup(id, [running(result), running(result, "synthesizing"), result]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, events.slice(0, half));
    const lastSeq = events[half - 1].seq;
    await act(async () => {
      for (let i = 0; i < 6; i += 1) es.fail(0);
    });
    await screen.findByText("Live updates stopped.");
    expect(es.closed).toBe(true);
    await waitFor(() => expect(backend.callsTo("GET", `/analyses/${id}`)).toHaveLength(2));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    });
    const resumed = FakeEventSource.latest();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(resumed.url).toBe(`/api/bay/analyses/${id}/events?after=${lastSeq}`);
    await act(async () => resumed.open());
    expect(screen.queryByText("Live updates stopped.")).toBeNull();
    await emit(resumed, events.slice(half));
    await screen.findByRole("region", { name: /^Assessment$/ });
  });

  it("reconnects on its own when the browser comes back online", async () => {
    setup(id, [running(result), running(result, "synthesizing")]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, events.slice(0, half));
    await act(async () => es.fail(2)); /* the browser closed the stream */
    await screen.findByText("Live updates stopped.");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest().url).toContain(`?after=${events[half - 1].seq}`);
  });

  it("settles from the durable result when the run finished while the stream was down", async () => {
    setup(id, [running(result), result]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, events.slice(0, half));
    await act(async () => es.fail(2));
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(screen.queryByText("Live updates stopped.")).toBeNull();
  });
});

describe("cancel", () => {
  const { events, result, cancel_response } = cancelledRun;
  const id = result.analysis_id;
  const beforeCancel = events.slice(0, -1);

  it("calls the backend cancel endpoint and shows the cancelled state with what was preserved", async () => {
    const { backend } = setup(id, [running(result), result], {
      [`POST /analyses/${id}/cancel`]: () => jsonResponse(200, cancel_response),
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, beforeCancel);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
    });
    expect(backend.callsTo("POST", `/analyses/${id}/cancel`)).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Cancel analysis" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Cancelling…");

    await emit(es, events.slice(-1));
    const notice = screen.getByText("The analysis was cancelled.").closest("[role=status]")!;
    expect(notice.textContent).toContain("Analysis cancelled");
    expect(notice.textContent).toContain("It is incomplete.");
    expect(notice.textContent).toContain("CANCELLED");
    await screen.findByRole("region", { name: /^Partial synthesis/ });
    expect(screen.getAllByLabelText("Stopped")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel analysis" })).toBeNull();
    /* CANCELLED is not retryable */
    expect(screen.queryByRole("button", { name: "Run it again" })).toBeNull();
  });

  it("reports a cancel request that did not go through", async () => {
    setup(id, [running(result)], {
      [`POST /analyses/${id}/cancel`]: () =>
        jsonResponse(502, { error: { code: "INTERNAL_ERROR", message: "The BayAnalytics API could not be reached.", retryable: true, details: { reason: "upstream_unreachable" } } }),
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), beforeCancel.slice(0, 10));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The BayAnalytics API could not be reached.");
    expect((screen.getByRole("button", { name: "Cancel analysis" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("structured failure", () => {
  const { events, result, request } = failedRun;
  const id = result.analysis_id;

  it("shows the code, the message and a retry that runs the question again", async () => {
    const { backend } = setup(id, [running(result), result], {
      "POST /analyses": () => jsonResponse(202, { ...completedRun.created }),
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), events);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Analysis failed");
    expect(alert.textContent).toContain("The decision model failed.");
    expect(alert.textContent).toContain("LAYA_INFERENCE_FAILED");
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Run it again" }));
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/analyses/${completedRun.created.analysis_id}`));
    const instrument = events.find((e) => e.event === "instrument.resolved") as AnalysisEventOf<"instrument.resolved">;
    expect(backend.callsTo("POST", "/analyses")[0].body).toEqual({
      query: request.query,
      profile: "fast",
      horizon: "multi_horizon",
      instrument: { symbol: instrument.symbol, exchange: instrument.exchange ?? null },
    });
    /* research that happened before the failure is still shown */
    await screen.findByRole("region", { name: /^Sources/ });
  });

  it("does not promise preserved content when the run failed before recording any", async () => {
    const early = [events[0], { ...events[events.length - 1], seq: 2 }] as AnalysisEvent[];
    setup(id, [running(result, "resolving_instrument")]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), early);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The decision model failed.");
    expect(alert.textContent).not.toContain("shown below");
  });

  it("offers the backend's candidates when the stream reports an ambiguous instrument", async () => {
    const ambiguousFailure = clone(events);
    const last = ambiguousFailure[ambiguousFailure.length - 1] as AnalysisEvent & { error: Record<string, unknown> };
    last.error = {
      code: "AMBIGUOUS_INSTRUMENT",
      message: "Which company did you mean?",
      retryable: false,
      details: { reason: "multiple_companies", candidates: [{ symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc.", cik: "0000320193", score: 0 }] },
    };
    const { backend } = setup(id, [running(result)], { "POST /analyses": () => jsonResponse(202, completedRun.created) });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), ambiguousFailure);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Analyse Apple Inc. (AAPL, NASDAQ)" }));
    });
    await waitFor(() => expect(backend.callsTo("POST", "/analyses")).toHaveLength(1));
    expect(backend.callsTo("POST", "/analyses")[0].body).toMatchObject({ instrument: { symbol: "AAPL", exchange: "NASDAQ" } });
  });
});

describe("opening an analysis", () => {
  it("renders a finished analysis from its result without opening a stream", async () => {
    const { result } = completedRun;
    const { backend } = setup(result.analysis_id, [result]);
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(backend.callsTo("GET", `/analyses/${result.analysis_id}`)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel analysis" })).toBeNull();
  });

  it("says so when the backend has no such analysis", async () => {
    setup("an_0000000000000000", [() => jsonResponse(notFound.status, notFound.body)]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This analysis doesn't exist on the backend.");
    expect(alert.textContent).toContain(notFound.body.error.message);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("offers a retry when the backend cannot be reached", async () => {
    const { result } = completedRun;
    let down = true;
    setup(result.analysis_id, [
      () =>
        down
          ? jsonResponse(502, { error: { code: "INTERNAL_ERROR", message: "The BayAnalytics API could not be reached.", retryable: true, details: { reason: "upstream_unreachable" } } })
          : jsonResponse(200, result),
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The analysis backend can't be reached.");
    down = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    });
    await screen.findByRole("region", { name: /^Assessment$/ });
  });
});

describe("the analysis workspace", () => {
  const liveResult = running(completedResult({ analysis_id: LIVE_ID, query: "Assess Example Holdings." }));
  const upTo = (predicate: (e: AnalysisEvent) => boolean) => LIVE_EVENTS.filter((e) => e.seq <= seqOf(predicate));
  const dockToggle = () => screen.getByRole("button", { name: /(Collapse|Expand) live research/ });

  it("follows a running analysis in the live research dock, from recorded events only", async () => {
    setup(LIVE_ID, [liveResult]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.latest();
    await emit(es, upTo((e) => e.event === "research.fetching" && e.url === URLS.kept));

    const dock = screen.getByRole("region", { name: "Live research" });
    expect(dockToggle().getAttribute("aria-expanded")).toBe("true");
    expect(within(dock).getByText("Live")).toBeTruthy();
    expect(within(dock).getByText("Reading news.example.com")).toBeTruthy();
    const view = screen.getByRole("region", { name: "Live view" });
    expect(view.textContent).toContain("Reading news.example.com…");
    const feed = within(dock).getByRole("list", { name: "Research activity" });
    expect(within(feed).getByRole("button", { name: /Searched the web/ }).textContent).toContain("12 results");

    /* pin the search: the live view shows its hits until "Back to live" */
    /* the stream handle drops what was already delivered, so replaying from the start is safe */
    await emit(es, upTo((e) => e.event === "research.source_found" && e.url === URLS.kept));
    fireEvent.click(within(feed).getByRole("button", { name: /Searched the web/ }));
    expect(within(feed).getByRole("button", { name: /Searched the web/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("region", { name: "Live view" }).textContent).toContain("12 results · top 5 shown");
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    expect(screen.getByRole("region", { name: "Live view" }).textContent).toContain("Captured for the analysis");

    await emit(es, LIVE_EVENTS);
    expect(within(dock).getAllByText("Research finished")).toHaveLength(2); /* the header and the feed's last row */
    expect(within(dock).getByText(/^Finished in /)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Live view" }).textContent).toMatch(/Research finished in [\d.]+ s/);
    const filters = within(dock).getByRole("group", { name: "Filter research activity" });
    expect(within(filters).getByRole("button", { name: "Kept, 2" })).toBeTruthy();
    fireEvent.click(within(filters).getByRole("button", { name: "Skipped, 4" }));
    const skipped = within(within(dock).getByRole("list", { name: "Research activity" })).getAllByRole("button");
    expect(skipped.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Paywalled"),
      expect.stringContaining("Published after the as-of date"),
      expect.stringContaining("Duplicate"),
      expect.stringContaining("Budget reached"),
    ]);

    fireEvent.click(dockToggle());
    expect(dockToggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Live view" })).toBeNull();
  });

  it("opens a finished analysis with the dock collapsed, and a citation chip shows its source there", async () => {
    const { result } = completedRun;
    setup(result.analysis_id, [result]);
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(dockToggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Live view" })).toBeNull();

    const cited = result.sources.find((s) => s.source_id === "src_587c133c2376b2e8")!;
    const summary = screen.getByRole("region", { name: /^Assessment$/ });
    fireEvent.click(within(summary).getByRole("button", { name: `Show source: ${cited.publisher}` }));

    expect(dockToggle().getAttribute("aria-expanded")).toBe("true");
    const view = screen.getByRole("region", { name: "Live view" });
    expect(within(view).getByRole("link", { name: cited.title }).getAttribute("href")).toBe(cited.url);
    expect(within(view).getByRole("button", { name: "Back to summary" })).toBeTruthy();
    const row = within(screen.getByRole("list", { name: "Research activity" })).getByRole("button", { current: true });
    expect(row.textContent).toContain(cited.title);
  });

  it("shows honest empty states in both views when the backend sends no market data", async () => {
    setup(completedRun.result.analysis_id, [completedRun.result]);
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(screen.getByText(NO_QUARTERLY_FIGURES)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trading view" }));
    expect(screen.getByText(NO_PRICE_HISTORY)).toBeTruthy();
  });

  it("switches the side panel with the main window, and the rail opens and closes it", async () => {
    setup(completedRun.result.analysis_id, [completedRun.result]);
    await screen.findByRole("region", { name: /^Assessment$/ });
    expect(screen.getByRole("tab", { name: "Analysis" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Trading view" }));
    expect(screen.getByRole("tab", { name: "Symbol" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("list", { name: "In this analysis" }).textContent).toContain("AAPL");
    const keyStats = screen.getByText("Key stats").parentElement!;
    const marketCap = completedRun.result.calculations.find((c) => c.name === "market_cap")!;
    expect(keyStats.textContent).toContain(`Market cap${marketCap.display}`);
    expect(keyStats.textContent).not.toContain("EV/EBITDA"); /* unavailable: skipped */

    const rail = screen.getByRole("navigation", { name: "Panels" });
    const symbolRail = within(rail).getByRole("button", { name: "Symbol and watchlist" });
    expect(symbolRail.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(symbolRail);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(symbolRail.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(rail).getByRole("button", { name: "Analysis" }));
    expect(screen.getByRole("tab", { name: "Analysis" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Company performance" }));
    fireEvent.click(screen.getByRole("tab", { name: "Symbol" }));
    expect(screen.getByRole("tab", { name: "Symbol" }).getAttribute("aria-selected")).toBe("true");
  });

  it("saves the watched symbol in this browser only, with no invented price", async () => {
    const { result } = completedRun;
    const { backend } = setup(result.analysis_id, [result]);
    await screen.findByRole("region", { name: /^Assessment$/ });
    const watch = screen.getAllByRole("button", { name: "Watch AAPL" })[0];
    const calls = backend.calls.length;
    fireEvent.click(watch);
    expect(screen.getAllByRole("button", { name: "Watch AAPL" })[0].getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(WATCHLIST_KEY)!)).toEqual([
      { symbol: "AAPL", name: "Apple Inc.", last_close: null, change_pct: null, as_of: null },
    ]);
    expect(backend.calls.length).toBe(calls); /* nothing is sent anywhere */
    fireEvent.click(screen.getByRole("tab", { name: "Symbol" }));
    expect(within(screen.getByRole("list", { name: "Your watchlist" })).getByText("AAPL")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove AAPL from watchlist" }));
    expect(JSON.parse(window.localStorage.getItem(WATCHLIST_KEY)!)).toEqual([]);
  });

  it("asks for a ticker when the stream reports that the question has none", async () => {
    const { events, result } = failedRun;
    const failure = { ...events[events.length - 1] } as AnalysisEvent & { error: Record<string, unknown> };
    failure.error = { code: "AMBIGUOUS_INSTRUMENT", message: "The question does not name a ticker.", retryable: false, details: { reason: "ticker_required" } };
    setup(result.analysis_id, [running(result, "resolving_instrument")]);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await emit(FakeEventSource.latest(), [events[0], { ...failure, seq: 2 } as AnalysisEvent]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Include the company's ticker, e.g. $AAPL.");
    expect(alert.textContent).toContain("The question does not name a ticker.");
    expect(within(alert).queryByRole("button", { name: /^Analyse / })).toBeNull();
  });
});
