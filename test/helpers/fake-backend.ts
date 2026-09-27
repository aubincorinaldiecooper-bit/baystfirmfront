/**
 * Test doubles for the browser side of the contract: a stub `fetch` that
 * routes `/api/bay/*` requests to per-test handlers (recording every call),
 * and a controllable EventSource the real SSE handle runs on. They carry no
 * data of their own; tests feed them the backend-produced fixtures.
 */

import { vi } from "vitest";
import { BayApiClient } from "@/lib/api/client";
import { openAnalysisEvents, type EventSourceLike } from "@/lib/api/sse";
import type { AnalysisEvent } from "@/lib/api/types";

export interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

export type RouteHandler = (call: RecordedCall) => Response | Promise<Response>;

export function stubBackend(routes: Record<string, RouteHandler>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://test");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/bay/, "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const call = { method, path, search: url.searchParams, body };
    calls.push(call);
    const key = Object.keys(routes).find((pattern) => {
      const [m, p] = pattern.split(" ");
      return m === method && new RegExp(`^${p}$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `no stub for ${method} ${path}`, retryable: false } }), { status: 404 });
    return routes[key](call);
  });
  const client = new BayApiClient({ baseUrl: "/api/bay", fetch: fetchImpl });
  return { client, calls, fetchImpl, callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

type Listener = (event: MessageEvent<string> | Event) => void;

export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  static reset() {
    FakeEventSource.instances = [];
  }
  static latest(): FakeEventSource {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!es) throw new Error("no EventSource was opened");
    return es;
  }

  readyState = 0;
  closed = false;
  readonly url: string;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close() {
    this.readyState = 2;
    this.closed = true;
  }

  private dispatch(type: string, event: MessageEvent<string> | Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  /** Deliver one backend event exactly as the wire carries it (`event:` name, flat `data:`). */
  emit(event: AnalysisEvent) {
    const { event: name, ...payload } = event;
    this.dispatch(name, { data: JSON.stringify(payload), lastEventId: String(event.seq) } as MessageEvent<string>);
  }

  emitAll(events: AnalysisEvent[]) {
    for (const event of events) this.emit(event);
  }

  /** A transport error: CONNECTING (0) while the browser retries, CLOSED (2) when it gives up. */
  fail(readyState: 0 | 2 = 0) {
    this.readyState = readyState;
    this.dispatch("error", new Event("error"));
  }
}

/** The real SSE handle, running on the fake EventSource. */
export const openWithFakeEventSource: typeof openAnalysisEvents = (analysisId, handlers, options = {}) =>
  openAnalysisEvents(analysisId, handlers, {
    ...options,
    transport: "eventsource",
    EventSource: FakeEventSource,
  });
