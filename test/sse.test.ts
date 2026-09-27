import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  SseParser,
  eventsUrl,
  openAnalysisEvents,
  parseAnalysisEvent,
  type EventSourceLike,
  type SseFrame,
  type StreamFallbackReason,
} from "@/lib/api/sse";
import type { AnalysisEvent } from "@/lib/api/types";
import { ANALYSIS_ID, HAPPY_PATH, toSse, toSseStream } from "./fixtures/events";

/* ── parser ──────────────────────────────────────────────── */

describe("SseParser", () => {
  it("parses the backend wire format, comments included", () => {
    const parser = new SseParser();
    const frames = parser.feed(toSseStream(HAPPY_PATH.slice(0, 2), ["connected", "keepalive"]));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ id: "1", event: "analysis.started", retry: null });
    expect(JSON.parse(frames[0].data)).toMatchObject({ analysis_id: ANALYSIS_ID, seq: 1, query: "Assess Example Holdings." });
    expect(frames[1]).toMatchObject({ id: "2", event: "instrument.resolved" });
  });

  it("reassembles frames split at arbitrary byte boundaries", () => {
    const wire = toSseStream(HAPPY_PATH.slice(0, 5), ["connected"]);
    const parser = new SseParser();
    const frames: SseFrame[] = [];
    for (let i = 0; i < wire.length; i += 7) frames.push(...parser.feed(wire.slice(i, i + 7)));
    frames.push(...parser.end());
    expect(frames.map((f) => f.event)).toEqual(HAPPY_PATH.slice(0, 5).map((e) => e.event));
    expect(frames.map((f) => f.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("handles CRLF and lone CR line endings, multi-line data and retry", () => {
    const parser = new SseParser();
    const frames = [
      ...parser.feed("retry: 2500\r\nevent: spark.token\r\nid: 9\r\ndata: {\"a\":\r\ndata: 1}\r\n\r\n"),
      ...parser.feed("event: x\rdata: y\r\r"),
      ...parser.end(), // a trailing lone CR is held until more input or end(): it may be half of CRLF
    ];
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ id: "9", event: "spark.token", data: '{"a":\n1}', retry: 2500 });
    expect(frames[1]).toEqual({ id: "9", event: "x", data: "y", retry: null }); // the last event id persists across frames (EventSource spec)
  });

  it("does not emit a frame while a CRLF pair is split across chunks", () => {
    const parser = new SseParser();
    expect(parser.feed("data: a\r")).toEqual([]);
    expect(parser.feed("\n\r\n")).toEqual([{ id: null, event: null, data: "a", retry: null }]);
  });

  it("ignores a BOM, unknown fields, and keeps the value after a single leading space", () => {
    const parser = new SseParser();
    const frames = parser.feed("﻿foo: bar\ndata:  two spaces\nevent:name\n\n");
    expect(frames).toEqual([{ id: null, event: "name", data: " two spaces", retry: null }]);
  });

  it("flushes a trailing unterminated frame on end()", () => {
    const parser = new SseParser();
    expect(parser.feed("event: e\ndata: d")).toEqual([]);
    expect(parser.end()).toEqual([{ id: null, event: "e", data: "d", retry: null }]);
    expect(parser.end()).toEqual([]);
  });

  it("emits nothing for comment-only input", () => {
    const parser = new SseParser();
    expect(parser.feed(": keepalive\n\n: keepalive\n\n")).toEqual([]);
    expect(parser.end()).toEqual([]);
  });
});

describe("parseAnalysisEvent", () => {
  it("decodes a known event and rejects unknown names or malformed payloads", () => {
    const frame = new SseParser().feed(toSse(HAPPY_PATH[25]))[0];
    const event = parseAnalysisEvent(frame);
    expect(event).toMatchObject({ event: "spark.token", seq: 26, text: "Revenue " });
    expect(parseAnalysisEvent({ id: "1", event: "not.an.event", data: "{}", retry: null })).toBeNull();
    expect(parseAnalysisEvent({ id: "1", event: "spark.token", data: "not json", retry: null })).toBeNull();
    expect(parseAnalysisEvent({ id: "1", event: "spark.token", data: '{"seq":"1"}', retry: null })).toBeNull();
  });
});

describe("eventsUrl", () => {
  it("adds ?after= only for a positive seq", () => {
    expect(eventsUrl("/api/bay", "an_1", null)).toBe("/api/bay/analyses/an_1/events");
    expect(eventsUrl("/api/bay/", "an_1", 0)).toBe("/api/bay/analyses/an_1/events");
    expect(eventsUrl("/api/bay", "an_1", 12)).toBe("/api/bay/analyses/an_1/events?after=12");
  });
});

/* ── fetch transport ─────────────────────────────────────── */

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      /* deliver in small pieces so the parser is exercised across reads */
      for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
      controller.close();
    },
  });
}

function sseResponse(text: string): Response {
  return new Response(streamOf(text), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function collect() {
  const events: AnalysisEvent[] = [];
  const terminal: AnalysisEvent[] = [];
  const fallbacks: StreamFallbackReason[] = [];
  const reconnects: { attempt: number; lastEventId: number | null }[] = [];
  return {
    events,
    terminal,
    fallbacks,
    reconnects,
    handlers: {
      onEvent: (e: AnalysisEvent) => events.push(e),
      onTerminal: (e: AnalysisEvent) => terminal.push(e),
      onFallback: (r: StreamFallbackReason) => fallbacks.push(r),
      onReconnecting: (info: { attempt: number; lastEventId: number | null }) => reconnects.push(info),
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("openAnalysisEvents (fetch transport)", () => {
  it("delivers events in order, stops on the terminal event and closes the handle", async () => {
    const fetchSpy = vi.fn(async () => sseResponse(toSseStream(HAPPY_PATH, ["connected"])));
    const c = collect();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    expect(handle.transport).toBe("fetch");
    await vi.waitFor(() => expect(c.terminal).toHaveLength(1));
    expect(c.events.map((e) => e.seq)).toEqual(HAPPY_PATH.map((e) => e.seq));
    expect(c.terminal[0].event).toBe("analysis.completed");
    expect(handle.closed).toBe(true);
    expect(handle.lastEventId).toBe(HAPPY_PATH.length);
    expect(c.fallbacks).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/bay/analyses/${ANALYSIS_ID}/events`);
    expect(new Headers(init.headers).get("accept")).toBe("text/event-stream");
    expect(new Headers(init.headers).has("last-event-id")).toBe(false);
  });

  it("reconnects with Last-Event-ID and ?after= when the stream ends early, dropping replayed events", async () => {
    const first = toSseStream(HAPPY_PATH.slice(0, 3), ["connected"]);
    const second = toSseStream(HAPPY_PATH.slice(1), ["connected"]); // the backend replays from the tail; overlap is expected
    const fetchSpy = vi.fn().mockResolvedValueOnce(sseResponse(first)).mockResolvedValueOnce(sseResponse(second));
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.terminal).toHaveLength(1));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/bay/analyses/${ANALYSIS_ID}/events?after=3`);
    expect(new Headers(init.headers).get("last-event-id")).toBe("3");
    expect(c.reconnects).toEqual([{ attempt: 1, lastEventId: 3 }]);
    expect(c.events.map((e) => e.seq)).toEqual(HAPPY_PATH.map((e) => e.seq));
  });

  it("resumes from the `after` option without re-delivering older events", async () => {
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => sseResponse(toSseStream(HAPPY_PATH.slice(10))));
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0, after: 12 });
    await vi.waitFor(() => expect(c.terminal).toHaveLength(1));
    expect(fetchSpy.mock.calls[0][0]).toBe(`/api/bay/analyses/${ANALYSIS_ID}/events?after=12`);
    expect(c.events[0].seq).toBe(13);
  });

  it("signals fallback with the parsed error when the stream answers with an HTTP error", async () => {
    const body = JSON.stringify({ error: { code: "NOT_FOUND", message: "No analysis exists with that id.", retryable: false } });
    const fetchSpy = vi.fn(async () => new Response(body, { status: 404, headers: { "content-type": "application/json" } }));
    const c = collect();
    const handle = openAnalysisEvents("an_missing", c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.fallbacks).toHaveLength(1));
    const reason = c.fallbacks[0];
    expect(reason.kind).toBe("http");
    if (reason.kind === "http") {
      expect(reason.error).toBeInstanceOf(ApiError);
      expect(reason.error.code).toBe("NOT_FOUND");
      expect(reason.error.httpStatus).toBe(404);
    }
    expect(handle.closed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxReconnects consecutive dead connections", async () => {
    const fetchSpy = vi.fn(async () => sseResponse(": connected\n\n"));
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0, maxReconnects: 2 });
    await vi.waitFor(() => expect(c.fallbacks).toHaveLength(1));
    expect(c.fallbacks[0]).toEqual({ kind: "exhausted", attempts: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(c.reconnects.map((r) => r.attempt)).toEqual([1, 2]);
  });

  it("treats a network failure as a reconnect, not a fallback", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(sseResponse(toSseStream(HAPPY_PATH)));
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.terminal).toHaveLength(1));
    expect(c.fallbacks).toEqual([]);
    expect(c.reconnects).toHaveLength(1);
  });

  it("close() aborts the in-flight request and stops everything quietly", async () => {
    let captured: AbortSignal | undefined;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init?.signal ?? undefined;
      return new Response(new ReadableStream({ start() {} }), { status: 200 });
    });
    const c = collect();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    await settle();
    handle.close();
    expect(captured?.aborted).toBe(true);
    await settle();
    expect(c.fallbacks).toEqual([]);
    expect(handle.closed).toBe(true);
  });

  it("ignores events for another analysis and reports unknown event names", async () => {
    const foreign = { ...HAPPY_PATH[0], analysis_id: "an_other" } as AnalysisEvent;
    const wire = toSse(foreign) + "id: 1\nevent: future.event\ndata: {}\n\n" + toSseStream(HAPPY_PATH);
    const unknown: SseFrame[] = [];
    const fetchSpy = vi.fn(async () => sseResponse(wire));
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, { ...c.handlers, onUnknownEvent: (f) => unknown.push(f) }, { transport: "fetch", fetch: fetchSpy, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.terminal).toHaveLength(1));
    expect(c.events).toHaveLength(HAPPY_PATH.length);
    expect(unknown.map((f) => f.event)).toEqual(["future.event"]);
  });
});

/* ── EventSource transport ───────────────────────────────── */

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string> | Event) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    for (const l of this.listeners.get("open") ?? []) l(new Event("open"));
  }
  emit(event: AnalysisEvent): void {
    const { event: name, ...payload } = event;
    const message = { data: JSON.stringify(payload), lastEventId: String(event.seq) } as unknown as MessageEvent<string>;
    for (const l of this.listeners.get(name) ?? []) l(message);
  }
  fail(readyState: number): void {
    this.readyState = readyState;
    for (const l of this.listeners.get("error") ?? []) l(new Event("error"));
  }
}

describe("openAnalysisEvents (EventSource transport)", () => {
  it("uses EventSource when available, tracks the last id and closes on the terminal event", () => {
    FakeEventSource.instances = [];
    const c = collect();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { EventSource: FakeEventSource, after: null });
    expect(handle.transport).toBe("eventsource");
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(`/api/bay/analyses/${ANALYSIS_ID}/events`);
    es.open();
    for (const event of HAPPY_PATH.slice(0, 5)) es.emit(event);
    es.emit(HAPPY_PATH[2]); // a replayed duplicate after a browser-side reconnect
    for (const event of HAPPY_PATH.slice(5)) es.emit(event);
    expect(c.events.map((e) => e.seq)).toEqual(HAPPY_PATH.map((e) => e.seq));
    expect(handle.lastEventId).toBe(HAPPY_PATH.length);
    expect(c.terminal).toHaveLength(1);
    expect(es.closed).toBe(true);
    expect(handle.closed).toBe(true);
    es.emit(HAPPY_PATH[3]); // nothing after close
    expect(c.events).toHaveLength(HAPPY_PATH.length);
  });

  it("starts from ?after= when resuming and reports browser reconnects", () => {
    FakeEventSource.instances = [];
    const c = collect();
    openAnalysisEvents(ANALYSIS_ID, c.handlers, { EventSource: FakeEventSource, after: 4, maxReconnects: 2 });
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(`/api/bay/analyses/${ANALYSIS_ID}/events?after=4`);
    es.emit(HAPPY_PATH[3]); // seq 4: at or below `after`, dropped
    es.emit(HAPPY_PATH[4]);
    expect(c.events.map((e) => e.seq)).toEqual([5]);
    es.fail(0); // CONNECTING: the browser is retrying with Last-Event-ID
    expect(c.reconnects).toEqual([{ attempt: 1, lastEventId: 5 }]);
    es.emit(HAPPY_PATH[5]); // a new event resets the attempt counter
    es.fail(0);
    es.fail(0);
    expect(c.fallbacks).toEqual([]);
    es.fail(0); // third consecutive failure exceeds maxReconnects = 2
    expect(c.fallbacks).toEqual([{ kind: "exhausted", attempts: 2 }]);
    expect(es.closed).toBe(true);
  });

  it("falls back at once when the browser closes the source (non-200, wrong content type)", () => {
    FakeEventSource.instances = [];
    const c = collect();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { EventSource: FakeEventSource });
    FakeEventSource.instances[0].fail(2);
    expect(c.fallbacks).toHaveLength(1);
    expect(c.fallbacks[0].kind).toBe("closed");
    expect(handle.closed).toBe(true);
  });

  it("an external AbortSignal closes the source", () => {
    FakeEventSource.instances = [];
    const c = collect();
    const controller = new AbortController();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { EventSource: FakeEventSource, signal: controller.signal });
    controller.abort();
    expect(handle.closed).toBe(true);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("auto transport picks fetch when no EventSource global exists", () => {
    const fetchSpy = vi.fn(async () => sseResponse(toSseStream(HAPPY_PATH)));
    const c = collect();
    const handle = openAnalysisEvents(ANALYSIS_ID, c.handlers, { fetch: fetchSpy, retryDelayMs: 0 });
    expect(handle.transport).toBe("fetch");
    handle.close();
  });
});
