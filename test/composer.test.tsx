/** @vitest-environment jsdom */
/**
 * The question composer against backend-shaped responses: the ambiguity
 * picker (422 AMBIGUOUS_INSTRUMENT with the backend's candidates), the Fast |
 * Deep control driven by /capabilities, the horizon, and request errors.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DID_YOU_MEAN } from "@/components/finance/CandidatePicker";
import NewAnalysis from "@/components/finance/NewAnalysis";
import type { Capabilities } from "@/lib/api/types";
import { ambiguous, capabilitiesFixture, clone, completedRun, deepUnavailable, jsonResponse } from "./fixtures/backend";
import { stubBackend, type RouteHandler } from "./helpers/fake-backend";
import { renderWorkspace } from "./helpers/workspace";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);
beforeEach(() => {
  nav.push.mockReset();
  nav.pathname = "/";
});

const emptyHistory: RouteHandler = () => jsonResponse(200, { analyses: [], next_cursor: null });

function setup(options: { capabilities?: Capabilities | RouteHandler; create?: RouteHandler[] } = {}) {
  const creates = [...(options.create ?? [])];
  const capabilities = options.capabilities ?? deepUnavailable.capabilities;
  const backend = stubBackend({
    "GET /capabilities": typeof capabilities === "function" ? capabilities : () => jsonResponse(200, capabilities),
    "GET /analyses": emptyHistory,
    "POST /analyses": (call) => {
      const next = creates.shift();
      if (!next) throw new Error("unexpected POST /analyses");
      return next(call);
    },
  });
  renderWorkspace(<NewAnalysis />, { client: backend.client });
  return backend;
}

async function ask(question: string) {
  const input = screen.getByRole("textbox", { name: "Question" });
  await waitFor(() => expect(screen.getByRole("button", { name: /Analysis profile: Fast/ })).toBeTruthy());
  fireEvent.change(input, { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

const created = () => jsonResponse(202, completedRun.created);

describe("ambiguous instrument", () => {
  it("offers the backend's candidates and resubmits the same question with the chosen instrument", async () => {
    const backend = setup({ create: [() => jsonResponse(422, ambiguous.body), created] });
    await ask("Compare Apple and Microsoft.");

    /* named candidates: "Did you mean…" once, not the backend's same question again */
    const picker = await screen.findByRole("group", { name: DID_YOU_MEAN });
    expect(picker.textContent).not.toContain("Which company did you mean?");
    const options = within(picker).getAllByRole("button", { name: /^Analyse / });
    expect(options.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Analyse Apple Inc. (AAPL, NASDAQ)",
      "Analyse MICROSOFT CORP (MSFT, NASDAQ)",
    ]);
    expect(options[0].textContent).toContain("Apple Inc. \u00b7 AAPL");
    expect(picker.textContent).not.toContain("score");
    /* the question stays in the composer */
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("Compare Apple and Microsoft.");

    await act(async () => {
      fireEvent.click(options[1]);
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/analyses/${completedRun.created.analysis_id}`));
    const posts = backend.callsTo("POST", "/analyses");
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toEqual({ query: "Compare Apple and Microsoft.", profile: "fast", horizon: "auto" });
    expect(posts[1].body).toEqual({
      query: "Compare Apple and Microsoft.",
      profile: "fast",
      horizon: "auto",
      instrument: { symbol: "MSFT", exchange: "NASDAQ" },
    });
    /* the new analysis is picked up by the history list */
    await waitFor(() => expect(backend.callsTo("GET", "/analyses").length).toBeGreaterThanOrEqual(2));
  });

  it("explains when the backend has no candidates", async () => {
    const body = clone(ambiguous.body);
    body.error.message = "No public company could be identified in the request.";
    body.error.details = { reason: "no_match", candidates: [] };
    setup({ create: [() => jsonResponse(422, body)] });
    await ask("How is the market doing?");
    const picker = await screen.findByRole("group", { name: "No public company could be identified in the request." });
    expect(within(picker).queryAllByRole("button", { name: /^Analyse / })).toHaveLength(0);
    expect(picker.textContent).toContain("Include the company's ticker, e.g. $AAPL");
  });

  it("offers symbol-only candidates by their symbol, never an invented name", async () => {
    const body = {
      error: {
        code: "AMBIGUOUS_INSTRUMENT",
        message: "The question mentions several tickers.",
        retryable: false,
        details: { reason: "multiple_tickers", candidates: [{ symbol: "EXHL" }, { symbol: "EXMP", name: "", exchange: null, cik: null }] },
      },
    };
    const backend = setup({ create: [() => jsonResponse(422, body), created] });
    await ask("Compare $EXHL and $EXMP.");
    const picker = await screen.findByRole("group", { name: "The question mentions several tickers." });
    const options = within(picker).getAllByRole("button", { name: /^Analyse / });
    expect(options.map((b) => b.getAttribute("aria-label"))).toEqual(["Analyse EXHL", "Analyse EXMP"]);
    expect(picker.textContent).toContain("Choose the ticker to analyse.");
    expect(picker.textContent).not.toMatch(/Inc\.|Corp|undefined|null/);
    await act(async () => {
      fireEvent.click(options[0]);
    });
    await waitFor(() => expect(backend.callsTo("POST", "/analyses")).toHaveLength(2));
    expect(backend.callsTo("POST", "/analyses")[1].body).toMatchObject({ instrument: { symbol: "EXHL" } });
    expect(backend.callsTo("POST", "/analyses")[1].body).not.toHaveProperty("instrument.exchange");
  });

  it("asks for a ticker when the question has none, once", async () => {
    const body = {
      error: {
        code: "AMBIGUOUS_INSTRUMENT",
        message: "Include the company's stock ticker in your question, for example $AAPL.",
        retryable: false,
        details: { reason: "ticker_required", candidates: [] },
      },
    };
    setup({ create: [() => jsonResponse(422, body)] });
    await ask("How is the company doing?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Include the company's ticker, e.g. $AAPL.");
    /* the backend's message asks for the same thing: shown once, not as title and detail */
    expect(alert.textContent?.match(/Include the company's/g)).toHaveLength(1);
    expect(alert.textContent).not.toContain("ticker_required");
    expect(screen.queryByRole("group", { name: DID_YOU_MEAN })).toBeNull();
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
    /* the question goes back into the composer to add the ticker */
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("How is the company doing?");
  });

  it("can be dismissed", async () => {
    setup({ create: [() => jsonResponse(422, ambiguous.body)] });
    await ask("Compare Apple and Microsoft.");
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("group", { name: DID_YOU_MEAN })).toBeNull();
  });
});

describe("profiles from /capabilities", () => {
  it("keeps backend status off the start page", () => {
    setup();
    expect(screen.queryByRole("heading", { name: "Backend" })).toBeNull();
  });

  it("disables Deep with the backend's reason and keeps Fast selected", async () => {
    setup();
    const picker = await screen.findByRole("button", { name: "Analysis profile: Fast" });
    fireEvent.click(picker);
    const menu = screen.getByRole("menu", { name: "Analysis profile" });
    const deep = within(menu).getByRole("menuitemradio", { name: /Deep/ });
    expect(deep.getAttribute("aria-disabled")).toBe("true");
    expect(deep.textContent).toContain(deepUnavailable.capabilities.profiles.deep.reason);
    fireEvent.click(deep);
    expect(screen.getByRole("button", { name: "Analysis profile: Fast" })).toBeTruthy();
  });

  it("selects Deep when only Deep is available", async () => {
    const caps = clone(capabilitiesFixture);
    caps.profiles.fast = { available: false, context_ceiling: 32768, reason: "llama-server is not running", code: "FAST_PROFILE_UNAVAILABLE" };
    setup({ capabilities: caps, create: [created] });
    await screen.findByRole("button", { name: "Analysis profile: Deep" });
  });

  it("blocks sending and lists the reasons when no profile is available", async () => {
    const caps = clone(capabilitiesFixture);
    caps.profiles.fast = { available: false, context_ceiling: 32768, reason: "llama-server is not running", code: "FAST_PROFILE_UNAVAILABLE" };
    caps.profiles.deep = { available: false, context_ceiling: 131072, reason: "not enough free memory", code: "MEMORY_PRESSURE" };
    setup({ capabilities: caps });
    const notice = await screen.findByText("No analysis profile is available on this backend right now.");
    expect(notice.closest("[role=status]")?.textContent).toContain("llama-server is not running");
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Assess Apple." } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks sending and says why when web search isn't configured", async () => {
    setup({ capabilities: { ...clone(capabilitiesFixture), web_search: false } });
    const notice = await screen.findByText("Web search isn't configured on the server, so analyses can't run.");
    expect(notice.closest("[role=status]")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Assess $EXHL." } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks sending while the capabilities cannot be read", async () => {
    setup({
      capabilities: () =>
        jsonResponse(502, { error: { code: "INTERNAL_ERROR", message: "The BayAnalytics API could not be reached.", retryable: true, details: { reason: "upstream_unreachable" } } }),
    });
    await screen.findAllByText("The analysis backend can't be reached.");
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Assess Apple." } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("horizon", () => {
  it("sends the chosen horizon", async () => {
    const backend = setup({ create: [created] });
    await screen.findByRole("button", { name: "Analysis profile: Fast" });
    fireEvent.change(screen.getByRole("combobox", { name: "Horizon" }), { target: { value: "near_term" } });
    await ask("How does it look over the next earnings?");
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(backend.callsTo("POST", "/analyses")[0].body).toEqual({
      query: "How does it look over the next earnings?",
      profile: "fast",
      horizon: "near_term",
    });
  });
});

describe("request errors", () => {
  it("shows a profile error as the backend reports it", async () => {
    setup({ create: [() => jsonResponse(deepUnavailable.create_status, deepUnavailable.create_body)] });
    await ask("Assess Apple.");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(deepUnavailable.create_body.error.message);
    expect(alert.textContent).toContain("DEEP_PROFILE_UNAVAILABLE · HTTP 503");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("shows Retry-After on 429 and retries the same request", async () => {
    const busy = () =>
      jsonResponse(
        429,
        { error: { code: "TOO_MANY_ANALYSES", message: "Too many analyses are running on this backend. Try again shortly.", retryable: true, details: { active: 4, limit: 4 } } },
        { "retry-after": "5" },
      );
    const backend = setup({ create: [busy, created] });
    await ask("Assess Apple.");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The backend is busy with other analyses.");
    expect(alert.textContent).toContain("wait 5 s");
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/analyses/${completedRun.created.analysis_id}`));
    const posts = backend.callsTo("POST", "/analyses");
    expect(posts[1].body).toEqual(posts[0].body);
  });

  it("lists validation messages", async () => {
    setup({
      create: [
        () =>
          jsonResponse(422, {
            error: { code: "INVALID_REQUEST", message: "The request was invalid.", retryable: false, details: { errors: [{ loc: ["body", "query"], msg: "Value error, query must not be blank" }] } },
          }),
      ],
    });
    await ask("x");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Value error, query must not be blank");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
