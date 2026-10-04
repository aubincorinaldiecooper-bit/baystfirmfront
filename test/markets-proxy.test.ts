import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BAYST_API_URL, readBaystServerConfig } from "@/lib/server/baystEnv";
import { proxyMarketsRequest, proxyMarketsStream } from "@/lib/server/baystProxy";

const CONFIG = { apiUrl: "http://bayst.test", apiKey: "crypto-key" };

function upstream(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const session = async () => ({ kind: "anonymous" as const });

describe("readBaystServerConfig", () => {
  it("defaults to the local Baystfirm service and rejects bad URLs", () => {
    expect(readBaystServerConfig({})).toEqual({ apiUrl: DEFAULT_BAYST_API_URL, apiKey: null });
    expect(readBaystServerConfig({ BAYST_API_URL: "https://c.example.test/", BAYST_API_KEY: " k " })).toEqual({ apiUrl: "https://c.example.test", apiKey: "k" });
    expect(() => readBaystServerConfig({ BAYST_API_URL: "ftp://x" })).toThrow(/http or https/);
  });
});

describe("proxyMarketsRequest", () => {
  it("maps the read routes, attaches the key server-side and forwards only known query params", async () => {
    const { fetchImpl, calls } = upstream(() => new Response('{"runs":[]}', { status: 200, headers: { "content-type": "application/json" } }));
    const request = new Request("http://localhost:3000/api/markets/classifications?symbol=USDC&limit=5&x=1", { headers: { cookie: "a=b" } });
    const response = await proxyMarketsRequest(request, ["classifications"], { fetch: fetchImpl, config: CONFIG, session });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"runs":[]}');
    expect(calls[0].url).toBe("http://bayst.test/v1/classifications?symbol=USDC&limit=5");
    const sent = new Headers(calls[0].init.headers);
    expect(sent.get("authorization")).toBe("Bearer crypto-key");
    expect(sent.get("cookie")).toBeNull();
  });

  it("forwards the live and backtest track-record routes with window_hours", async () => {
    const { fetchImpl, calls } = upstream(() => new Response('{"groups":[]}', { status: 200 }));
    await proxyMarketsRequest(new Request("http://localhost:3000/api/markets/track-record?window_hours=168&x=1"), ["track-record"], {
      fetch: fetchImpl,
      config: CONFIG,
      session,
    });
    await proxyMarketsRequest(new Request("http://localhost:3000/api/markets/track-record/backtest"), ["track-record", "backtest"], {
      fetch: fetchImpl,
      config: CONFIG,
      session,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://bayst.test/v1/track-record?window_hours=168",
      "http://bayst.test/v1/track-record/backtest",
    ]);
  });

  it("forwards candle selectors through the server-side proxy", async () => {
    const { fetchImpl, calls } = upstream(() => new Response('{"candles":[]}', { status: 200 }));
    const request = new Request(
      "http://localhost:3000/api/markets/candles?venue=binanceus&symbol=BTC-USDT&interval=1w&limit=200&key=ignored",
    );
    const response = await proxyMarketsRequest(request, ["candles"], {
      fetch: fetchImpl,
      config: CONFIG,
      session,
    });
    expect(response.status).toBe(200);
    expect(calls[0].url).toBe(
      "http://bayst.test/v1/candles?venue=binanceus&symbol=BTC-USDT&interval=1w&limit=200",
    );
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer crypto-key");
  });

  it("forwards every repeated indicator spec on candle requests", async () => {
    const { fetchImpl, calls } = upstream(() => new Response('{"candles":[]}', { status: 200 }));
    const request = new Request(
      "http://localhost:3000/api/markets/candles?venue=okx&symbol=BTC-USDT&interval=1h&indicator=sma:20&indicator=macd:12,26,9",
    );
    await proxyMarketsRequest(request, ["candles"], { fetch: fetchImpl, config: CONFIG, session });
    expect(calls[0].url).toBe(
      "http://bayst.test/v1/candles?venue=okx&symbol=BTC-USDT&interval=1h&indicator=sma%3A20&indicator=macd%3A12%2C26%2C9",
    );
  });

  it("refuses unknown routes and non-GET methods without calling upstream", async () => {
    const { fetchImpl, calls } = upstream(() => new Response("{}"));
    const deps = { fetch: fetchImpl, config: CONFIG, session };
    expect((await proxyMarketsRequest(new Request("http://l/api/markets/admin"), ["admin"], deps)).status).toBe(404);
    expect((await proxyMarketsRequest(new Request("http://l/api/markets/snapshot", { method: "POST" }), ["snapshot"], deps)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("reports an unreachable backend in the error envelope", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const response = await proxyMarketsRequest(new Request("http://l/api/markets/snapshot"), ["snapshot"], { fetch: fetchImpl, config: CONFIG, session });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("proxyMarketsStream", () => {
  it("pipes the live stream with SSE headers and a validated symbols filter", async () => {
    const body = "event: market_event\ndata: {}\n\n";
    const { fetchImpl, calls } = upstream(() => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const response = await proxyMarketsStream(new Request("http://l/api/markets/stream?symbols=BTC-USD,USDC-USD"), { fetch: fetchImpl, config: CONFIG, session });
    expect(calls[0].url).toBe("http://bayst.test/v1/stream/sse?symbols=BTC-USD%2CUSDC-USD");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await response.text()).toBe(body);

    await proxyMarketsStream(new Request("http://l/api/markets/stream?symbols=../../x"), { fetch: fetchImpl, config: CONFIG, session });
    expect(calls[1].url).toBe("http://bayst.test/v1/stream/sse");
  });
});
