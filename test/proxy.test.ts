import { describe, expect, it, vi } from "vitest";
import { GET as catchAllGet, POST as catchAllPost, dynamic as catchAllDynamic, runtime as catchAllRuntime } from "@/app/api/bay/[...path]/route";
import { GET as eventsGet, dynamic as eventsDynamic, runtime as eventsRuntime } from "@/app/api/bay/analyses/[id]/events/route";
import { AUDIO_BODY_LIMIT, JSON_BODY_LIMIT, proxyEventStream, proxyRequest } from "@/lib/server/proxy";
import { DEFAULT_BAY_API_URL, readBayServerConfig } from "@/lib/server/env";
import type { NextRequest } from "next/server";
import { HAPPY_PATH, toSse } from "./fixtures/events";

const CONFIG = { apiUrl: "http://backend.test/api/v1", apiKey: "super-secret-key" };
const NO_KEY = { apiUrl: "http://backend.test/api/v1", apiKey: null };

type Upstream = { url: string; init: RequestInit };

function upstream(respond: (call: Upstream) => Response | Promise<Response>) {
  const calls: Upstream[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost:3000/api/bay/${path}`, init);

async function envelopeOf(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; retryable: boolean; details: unknown } };
}

describe("readBayServerConfig", () => {
  it("defaults to the loopback backend with no key", () => {
    expect(readBayServerConfig({})).toEqual({ apiUrl: DEFAULT_BAY_API_URL, apiKey: null });
  });
  it("trims, strips trailing slashes and treats a blank key as absent", () => {
    expect(readBayServerConfig({ BAY_API_URL: " https://api.example.test/api/v1/ ", BAY_API_KEY: "  " })).toEqual({
      apiUrl: "https://api.example.test/api/v1",
      apiKey: null,
    });
    expect(readBayServerConfig({ BAY_API_KEY: "k" }).apiKey).toBe("k");
  });
  it("rejects a malformed or non-http URL", () => {
    expect(() => readBayServerConfig({ BAY_API_URL: "nope" })).toThrow(/valid absolute URL/);
    expect(() => readBayServerConfig({ BAY_API_URL: "ftp://x" })).toThrow(/http or https/);
  });
});

describe("proxyRequest", () => {
  it("injects the server-side key and relays status, JSON body and content-type untouched", async () => {
    const body = { profiles: {}, voice: false, deployment: "local", research: true };
    const { fetchImpl, calls } = upstream(() => json(200, body, { "x-upstream-only": "1" }));
    const response = await proxyRequest(req("capabilities", { headers: { cookie: "session=abc", authorization: "Bearer browser-token" } }), ["capabilities"], {
      fetch: fetchImpl,
      config: CONFIG,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://backend.test/api/v1/capabilities");
    const sent = new Headers(calls[0].init.headers);
    expect(sent.get("authorization")).toBe("Bearer super-secret-key");
    expect(sent.has("cookie")).toBe(false);
    expect(calls[0].init.method).toBe("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.has("x-upstream-only")).toBe(false);
    expect(await response.text()).toBe(JSON.stringify(body));
  });

  it("sends no Authorization header when no key is configured", async () => {
    const { fetchImpl, calls } = upstream(() => json(200, {}));
    await proxyRequest(req("health"), ["health"], { fetch: fetchImpl, config: NO_KEY });
    expect(new Headers(calls[0].init.headers).has("authorization")).toBe(false);
  });

  it("reads BAY_API_URL / BAY_API_KEY from the server environment", async () => {
    vi.stubEnv("BAY_API_URL", "http://env.test/api/v1/");
    vi.stubEnv("BAY_API_KEY", "from-env");
    const { fetchImpl, calls } = upstream(() => json(200, {}));
    await proxyRequest(req("health"), ["health"], { fetch: fetchImpl });
    expect(calls[0].url).toBe("http://env.test/api/v1/health");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer from-env");
  });

  it("refuses paths outside the contract without contacting the backend", async () => {
    const { fetchImpl, calls } = upstream(() => json(200, {}));
    for (const path of [["admin"], ["analyses", "an_1", "events"], ["..", "secrets"], ["health", "extra"]]) {
      const response = await proxyRequest(req(path.join("/")), path, { fetch: fetchImpl, config: CONFIG });
      expect(response.status).toBe(404);
      expect((await envelopeOf(response)).error.code).toBe("NOT_FOUND");
    }
    const wrongMethod = await proxyRequest(req("capabilities", { method: "POST", body: "{}" }), ["capabilities"], { fetch: fetchImpl, config: CONFIG });
    expect(wrongMethod.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("forwards a JSON POST body with its content-type and the query string of a GET", async () => {
    const { fetchImpl, calls } = upstream((call) => (call.init.method === "POST" ? json(202, { analysis_id: "an_1" }) : json(200, { analyses: [], next_cursor: null })));
    const payload = JSON.stringify({ query: "Assess Example Holdings.", profile: "fast", horizon: "auto" });
    const created = await proxyRequest(req("analyses", { method: "POST", body: payload, headers: { "content-type": "application/json" } }), ["analyses"], {
      fetch: fetchImpl,
      config: CONFIG,
    });
    expect(created.status).toBe(202);
    expect(new TextDecoder().decode(calls[0].init.body as ArrayBuffer)).toBe(payload);
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");

    await proxyRequest(req("analyses?limit=10&cursor=abc"), ["analyses"], { fetch: fetchImpl, config: CONFIG });
    expect(calls[1].url).toBe("http://backend.test/api/v1/analyses?limit=10&cursor=abc");
    expect(calls[1].init.body).toBeUndefined();
  });

  it("enforces the backend body limits before forwarding", async () => {
    const { fetchImpl, calls } = upstream(() => json(202, {}));
    const declared = await proxyRequest(
      req("analyses", { method: "POST", body: "{}", headers: { "content-length": String(JSON_BODY_LIMIT + 1) } }),
      ["analyses"],
      { fetch: fetchImpl, config: CONFIG },
    );
    expect(declared.status).toBe(413);
    expect((await envelopeOf(declared)).error).toMatchObject({ code: "INVALID_REQUEST", details: { limit: JSON_BODY_LIMIT } });

    const oversized = new Uint8Array(JSON_BODY_LIMIT + 1);
    const actual = await proxyRequest(req("analyses", { method: "POST", body: oversized }), ["analyses"], { fetch: fetchImpl, config: CONFIG });
    expect(actual.status).toBe(413);

    const cancel = await proxyRequest(req("analyses/an_1/cancel", { method: "POST" }), ["analyses", "an_1", "cancel"], { fetch: fetchImpl, config: CONFIG });
    expect(cancel.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(AUDIO_BODY_LIMIT).toBe(25 * 1024 * 1024);
  });

  it("relays multipart audio bytes and content-type for transcriptions", async () => {
    const { fetchImpl, calls } = upstream(() => json(200, { text: "hi", duration_ms: 1, transcription_ms: 1 }));
    const form = new FormData();
    form.append("audio", new Blob(["abc"], { type: "audio/webm" }), "clip.webm");
    const browserRequest = new Request("http://localhost:3000/api/bay/transcriptions", { method: "POST", body: form });
    const response = await proxyRequest(browserRequest, ["transcriptions"], { fetch: fetchImpl, config: CONFIG });
    expect(response.status).toBe(200);
    expect(new Headers(calls[0].init.headers).get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(new TextDecoder().decode(calls[0].init.body as ArrayBuffer)).toContain('name="audio"; filename="clip.webm"');
  });

  it("passes upstream errors through, including Retry-After on 429", async () => {
    const { fetchImpl } = upstream(() => json(429, { error: { code: "TOO_MANY_ANALYSES", message: "Too many.", retryable: true } }, { "retry-after": "5" }));
    const response = await proxyRequest(req("analyses", { method: "POST", body: "{}" }), ["analyses"], { fetch: fetchImpl, config: CONFIG });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect((await envelopeOf(response)).error.code).toBe("TOO_MANY_ANALYSES");
  });

  it("answers 502 with the error envelope when the backend is unreachable", async () => {
    const { fetchImpl } = upstream(() => {
      throw new TypeError("fetch failed");
    });
    const response = await proxyRequest(req("health"), ["health"], { fetch: fetchImpl, config: CONFIG });
    expect(response.status).toBe(502);
    const { error } = await envelopeOf(response);
    expect(error).toMatchObject({ code: "INTERNAL_ERROR", retryable: true, details: { reason: "upstream_unreachable" } });
    expect(JSON.stringify(error)).not.toContain("super-secret-key");
  });

  it("answers 500 when the proxy is misconfigured, without leaking the value", async () => {
    vi.stubEnv("BAY_API_URL", "not a url");
    const { fetchImpl, calls } = upstream(() => json(200, {}));
    const response = await proxyRequest(req("health"), ["health"], { fetch: fetchImpl });
    expect(response.status).toBe(500);
    expect((await envelopeOf(response)).error.code).toBe("INTERNAL_ERROR");
    expect(calls).toHaveLength(0);
  });

  it("consults the session seam on every request", async () => {
    const session = vi.fn(async () => ({ kind: "anonymous" as const }));
    const { fetchImpl } = upstream(() => json(200, {}));
    await proxyRequest(req("health"), ["health"], { fetch: fetchImpl, config: CONFIG, session });
    expect(session).toHaveBeenCalledTimes(1);
  });
});

describe("proxyEventStream", () => {
  function liveUpstream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const encoder = new TextEncoder();
    const { fetchImpl, calls } = upstream(() => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    return {
      fetchImpl,
      calls,
      push: (text: string) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
    };
  }

  async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const { value, done } = await reader.read();
    if (done) return "<done>";
    return new TextDecoder().decode(value);
  }

  it("streams chunk by chunk with the SSE headers and the server-side key", async () => {
    const up = liveUpstream();
    const response = await proxyEventStream(req("analyses/an_1/events"), "an_1", { fetch: up.fetchImpl, config: CONFIG });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(up.calls[0].url).toBe("http://backend.test/api/v1/analyses/an_1/events");
    const sent = new Headers(up.calls[0].init.headers);
    expect(sent.get("authorization")).toBe("Bearer super-secret-key");
    expect(sent.get("accept")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    up.push(": connected\n\n");
    expect(await readChunk(reader)).toBe(": connected\n\n"); // delivered before anything else exists upstream
    up.push(toSse(HAPPY_PATH[0]));
    expect(await readChunk(reader)).toBe(toSse(HAPPY_PATH[0]));
    up.push(toSse(HAPPY_PATH[1]));
    expect(await readChunk(reader)).toBe(toSse(HAPPY_PATH[1]));
    up.end();
    expect(await readChunk(reader)).toBe("<done>");
  });

  it("forwards Last-Event-ID as a header and as ?after=", async () => {
    const up = liveUpstream();
    await proxyEventStream(req("analyses/an_1/events", { headers: { "last-event-id": "7" } }), "an_1", { fetch: up.fetchImpl, config: CONFIG });
    expect(up.calls[0].url).toBe("http://backend.test/api/v1/analyses/an_1/events?after=7");
    expect(new Headers(up.calls[0].init.headers).get("last-event-id")).toBe("7");

    const explicit = liveUpstream();
    await proxyEventStream(req("analyses/an_1/events?after=12"), "an_1", { fetch: explicit.fetchImpl, config: CONFIG });
    expect(explicit.calls[0].url).toBe("http://backend.test/api/v1/analyses/an_1/events?after=12");

    const garbage = liveUpstream();
    await proxyEventStream(req("analyses/an_1/events?after=abc"), "an_1", { fetch: garbage.fetchImpl, config: CONFIG });
    expect(garbage.calls[0].url).toBe("http://backend.test/api/v1/analyses/an_1/events");
  });

  it("aborts the upstream request when the browser cancels the stream", async () => {
    const up = liveUpstream();
    const response = await proxyEventStream(req("analyses/an_1/events"), "an_1", { fetch: up.fetchImpl, config: CONFIG });
    const signal = up.calls[0].init.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await response.body!.cancel();
    expect(signal.aborted).toBe(true);
  });

  it("aborts the upstream request when the incoming request signal fires", async () => {
    const up = liveUpstream();
    const controller = new AbortController();
    await proxyEventStream(req("analyses/an_1/events", { signal: controller.signal }), "an_1", { fetch: up.fetchImpl, config: CONFIG });
    controller.abort();
    expect((up.calls[0].init.signal as AbortSignal).aborted).toBe(true);
  });

  it("passes a backend error envelope through instead of opening a stream", async () => {
    const { fetchImpl } = upstream(() => json(404, { error: { code: "NOT_FOUND", message: "No analysis exists with that id.", retryable: false } }));
    const response = await proxyEventStream(req("analyses/an_missing/events"), "an_missing", { fetch: fetchImpl, config: CONFIG });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect((await envelopeOf(response)).error.code).toBe("NOT_FOUND");
  });

  it("rejects an id that is not an analysis id and answers 502 when unreachable", async () => {
    const { fetchImpl, calls } = upstream(() => {
      throw new TypeError("fetch failed");
    });
    const bad = await proxyEventStream(req("analyses/x/events"), "../health", { fetch: fetchImpl, config: CONFIG });
    expect(bad.status).toBe(404);
    expect(calls).toHaveLength(0);
    const down = await proxyEventStream(req("analyses/an_1/events"), "an_1", { fetch: fetchImpl, config: CONFIG });
    expect(down.status).toBe(502);
  });
});

describe("route handlers", () => {
  it("are dynamic, on the Node runtime, and delegate to the proxy", async () => {
    expect(catchAllDynamic).toBe("force-dynamic");
    expect(catchAllRuntime).toBe("nodejs");
    expect(eventsDynamic).toBe("force-dynamic");
    expect(eventsRuntime).toBe("nodejs");

    vi.stubEnv("BAY_API_URL", "http://backend.test/api/v1");
    vi.stubEnv("BAY_API_KEY", "route-key");
    const { fetchImpl, calls } = upstream((call) =>
      call.url.includes("/events")
        ? new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": connected\n\n")); c.close(); } }), { status: 200 })
        : json(200, { status: "ok" }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const health = await catchAllGet(req("health") as NextRequest, { params: Promise.resolve({ path: ["health"] }) });
    expect(health.status).toBe(200);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer route-key");

    const created = await catchAllPost(req("analyses", { method: "POST", body: "{}" }) as NextRequest, { params: Promise.resolve({ path: ["analyses"] }) });
    expect(created.status).toBe(200);
    expect(calls[1].init.method).toBe("POST");

    const events = await eventsGet(req("analyses/an_1/events", { headers: { "last-event-id": "3" } }) as NextRequest, { params: Promise.resolve({ id: "an_1" }) });
    expect(events.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(calls[2].url).toBe("http://backend.test/api/v1/analyses/an_1/events?after=3");
    expect(await events.text()).toBe(": connected\n\n");
  });
});
