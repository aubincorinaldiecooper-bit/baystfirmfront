import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  BayApiClient,
  ambiguityCandidates,
  errorFromResponse,
  isAmbiguousInstrument,
  isApiError,
  parseRetryAfter,
} from "@/lib/api/client";
import type { Capabilities, CreateAnalysisResponse } from "@/lib/api/types";
import { ANALYSIS_ID, completedResult } from "./fixtures/events";

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function clientWith(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  });
  return { client: new BayApiClient({ fetch: fetchImpl }), calls, fetchImpl };
}

const envelope = (code: string, message: string, retryable: boolean, details?: unknown) => ({
  error: { code, message, retryable, ...(details !== undefined ? { details } : {}) },
});

describe("BayApiClient requests", () => {
  it("POSTs /analyses as JSON through the proxy base and returns the typed 202 body", async () => {
    const created: CreateAnalysisResponse = { analysis_id: ANALYSIS_ID, status: "queued", profile: "fast", resolved_horizon: "multi_horizon" };
    const { client, calls } = clientWith(() => json(202, created));
    const response = await client.createAnalysis({ query: "Assess Example Holdings.", profile: "fast", horizon: "auto" });
    expect(response).toEqual(created);
    expect(calls[0].url).toBe("/api/bay/analyses");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ query: "Assess Example Holdings.", profile: "fast", horizon: "auto" });
  });

  it("builds the history query string and encodes ids", async () => {
    const { client, calls } = clientWith((call) =>
      call.url.includes("/events") ? new Response("", { status: 404 }) : json(200, { analyses: [], next_cursor: null }),
    );
    await client.listAnalyses({ limit: 10, cursor: "abc+/=" });
    expect(calls[0].url).toBe("/api/bay/analyses?limit=10&cursor=abc%2B%2F%3D");
    await client.listAnalyses();
    expect(calls[1].url).toBe("/api/bay/analyses");
    await client.listAnalyses({ cursor: null });
    expect(calls[2].url).toBe("/api/bay/analyses");
    expect(client.eventsUrl("an x", 4)).toBe("/api/bay/analyses/an%20x/events?after=4");
    expect(client.eventsUrl("an_1")).toBe("/api/bay/analyses/an_1/events");
  });

  it("GET /analyses/{id}, POST cancel, GET capabilities and health", async () => {
    const capabilities: Capabilities = {
      profiles: { fast: { available: true, context_ceiling: 32768, reason: null, code: null }, deep: { available: false, context_ceiling: 131072, reason: "not enough free memory", code: "MEMORY_PRESSURE" } },
      voice: false,
      deployment: "local",
      research: true,
      execution: { spark_mode: "managed", whisper_mode: "disabled", deployment: "local", search_configured: false },
    };
    const { client, calls } = clientWith((call) => {
      if (call.url.endsWith("/cancel")) return json(200, { analysis_id: ANALYSIS_ID, status: "researching", cancel_requested: true });
      if (call.url.endsWith("/capabilities")) return json(200, capabilities);
      if (call.url.endsWith("/health")) return json(200, { status: "ok", version: "0.1.0", components: [], active_analyses: 0, execution: capabilities.execution });
      return json(200, completedResult());
    });
    expect((await client.getAnalysis(ANALYSIS_ID)).status).toBe("completed");
    expect(calls[0].url).toBe(`/api/bay/analyses/${ANALYSIS_ID}`);
    expect((await client.cancelAnalysis(ANALYSIS_ID)).cancel_requested).toBe(true);
    expect(calls[1].init.method).toBe("POST");
    expect((await client.getCapabilities()).profiles.deep.code).toBe("MEMORY_PRESSURE");
    expect((await client.getHealth()).status).toBe("ok");
  });

  it("sends audio as the multipart field `audio` and never sets its own content-type", async () => {
    const { client, calls } = clientWith(() => json(200, { text: "assess example holdings", duration_ms: 1200, transcription_ms: 300 }));
    const result = await client.transcribeAudio(new Blob(["abc"], { type: "audio/webm" }), { filename: "clip.webm" });
    expect(result.text).toBe("assess example holdings");
    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get("audio") as File;
    expect(file.name).toBe("clip.webm");
    expect(new Headers(calls[0].init.headers).has("content-type")).toBe(false);
  });

  it("passes an AbortSignal through and rethrows the abort untouched", async () => {
    const controller = new AbortController();
    const { client } = clientWith((call) => {
      const error = new Error("aborted");
      error.name = "AbortError";
      expect(call.init.signal).toBe(controller.signal);
      throw error;
    });
    controller.abort();
    await expect(client.getHealth({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("error normalisation", () => {
  it("422 AMBIGUOUS_INSTRUMENT carries the candidates", async () => {
    const candidates = [
      { symbol: "EXHL", exchange: "NASDAQ", name: "Example Holdings Inc.", cik: "0000000000", score: 0.9 },
      { symbol: "EXHA", exchange: null, name: "Example Holdings A", cik: null, score: 0.4 },
    ];
    const { client } = clientWith(() =>
      json(422, envelope("AMBIGUOUS_INSTRUMENT", "Which company did you mean?", false, { reason: "multiple_matches", candidates })),
    );
    const error = await client.createAnalysis({ query: "Assess Example." }).catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(isAmbiguousInstrument(error)).toBe(true);
    if (!isAmbiguousInstrument(error)) throw new Error("unreachable");
    expect(error.httpStatus).toBe(422);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Which company did you mean?");
    expect(ambiguityCandidates(error)).toEqual(candidates);
    expect(error.details.reason).toBe("multiple_matches");
  });

  it("an AMBIGUOUS_INSTRUMENT without candidates is not treated as a picker", async () => {
    const { client } = clientWith(() => json(422, envelope("AMBIGUOUS_INSTRUMENT", "Unknown symbol.", false, { reason: "unknown_symbol" })));
    const error = await client.createAnalysis({ query: "x" }).catch((e: unknown) => e);
    expect(isApiError(error) && error.code === "AMBIGUOUS_INSTRUMENT").toBe(true);
    expect(isAmbiguousInstrument(error)).toBe(false);
  });

  it("429 TOO_MANY_ANALYSES exposes Retry-After", async () => {
    const { client } = clientWith(() => json(429, envelope("TOO_MANY_ANALYSES", "Too many analyses are running.", true, { active: 4, limit: 4 }), { "retry-after": "5" }));
    const error = (await client.createAnalysis({ query: "x" }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("TOO_MANY_ANALYSES");
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.details).toEqual({ active: 4, limit: 4 });
  });

  it("401 UNAUTHORIZED from the envelope, and from a bare non-JSON 401", async () => {
    const enveloped = clientWith(() => json(401, envelope("UNAUTHORIZED", "A valid API key is required.", false)));
    const a = (await enveloped.client.getHealth().catch((e: unknown) => e)) as ApiError;
    expect(a.code).toBe("UNAUTHORIZED");
    expect(a.httpStatus).toBe(401);

    const bare = clientWith(() => new Response("Unauthorized", { status: 401 }));
    const b = (await bare.client.getHealth().catch((e: unknown) => e)) as ApiError;
    expect(b.code).toBe("UNAUTHORIZED");
    expect(b.retryable).toBe(false);
    expect(b.details).toEqual({ body: "Unauthorized" });
  });

  it("503 DEEP_PROFILE_UNAVAILABLE is retryable and keeps the backend reason", async () => {
    const { client } = clientWith(() => json(503, envelope("DEEP_PROFILE_UNAVAILABLE", "Deep analysis isn't available on this machine right now. Try Fast.", true, { reason: "insufficient memory" })));
    const error = (await client.createAnalysis({ query: "x", profile: "deep" }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("DEEP_PROFILE_UNAVAILABLE");
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.details?.reason).toBe("insufficient memory");
    expect(error.toPayload()).toEqual({ code: "DEEP_PROFILE_UNAVAILABLE", message: error.message, retryable: true, details: { reason: "insufficient memory" } });
  });

  it("422 INVALID_REQUEST validation details pass through", async () => {
    const { client } = clientWith(() => json(422, envelope("INVALID_REQUEST", "The request was invalid.", false, { errors: [{ loc: ["body", "query"], msg: "blank" }] })));
    const error = (await client.createAnalysis({ query: " " }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.details?.errors).toHaveLength(1);
  });

  it("an unknown code in the envelope falls back by status; 5xx is retryable", async () => {
    const { client } = clientWith(() => json(502, envelope("SOMETHING_NEW", "Upstream hiccup.", true)));
    const error = (await client.getHealth().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("Upstream hiccup.");
  });

  it("a network failure becomes NETWORK_ERROR with httpStatus 0", async () => {
    const { client } = clientWith(() => {
      throw new TypeError("fetch failed");
    });
    const error = (await client.getHealth().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.httpStatus).toBe(0);
    expect(error.retryable).toBe(true);
    expect(error.toPayload().code).toBe("INTERNAL_ERROR");
  });

  it("a 2xx body that is not JSON becomes BAD_RESPONSE", async () => {
    const { client } = clientWith(() => new Response("<html>", { status: 200 }));
    const error = (await client.getHealth().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("BAD_RESPONSE");
    expect(error.httpStatus).toBe(200);
  });

  it("errorFromResponse handles a 404 envelope and empty bodies", async () => {
    const notFound = await errorFromResponse(json(404, envelope("NOT_FOUND", "No analysis exists with that id.", false)));
    expect(notFound.code).toBe("NOT_FOUND");
    const empty = await errorFromResponse(new Response(null, { status: 500 }));
    expect(empty.code).toBe("INTERNAL_ERROR");
    expect(empty.retryable).toBe(true);
    expect(empty.details).toBeNull();
  });

  it("parseRetryAfter accepts seconds and HTTP dates", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("garbage")).toBeNull();
    const now = Date.parse("2026-09-27T10:00:00Z");
    expect(parseRetryAfter("Sun, 27 Sep 2026 10:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Sun, 27 Sep 2026 09:00:00 GMT", now)).toBe(0);
  });
});
