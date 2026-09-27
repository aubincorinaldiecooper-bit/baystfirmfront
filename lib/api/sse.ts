/**
 * SSE client for `GET /api/bay/analyses/{id}/events`.
 *
 * Transport choice
 * ----------------
 * In the browser the native `EventSource` is used. It suffices because the
 * stream is same-origin through the proxy: no custom headers are needed (the
 * backend credential is attached server-side, and a future session cookie is
 * sent automatically), and on a dropped connection the browser reconnects on
 * its own with the `Last-Event-ID` header, which the proxy forwards so the
 * backend replays only the tail (spec section 25: "allow native reconnect").
 *
 * Where `EventSource` is unavailable (Node, tests) or a caller needs request
 * headers one day, the same handle runs on `fetch` + `ReadableStream`,
 * reconnecting with both `Last-Event-ID` and `?after=`. Both transports share
 * one frame parser, one seq-based dedupe and one terminal/fallback policy.
 *
 * Termination
 * -----------
 * The stream closes itself after `analysis.completed` / `analysis.failed`
 * (a cancel arrives as `analysis.failed` with `status: "cancelled"`). If the
 * stream cannot be recovered, `onFallback` fires once so the caller can read
 * the durable state from `GET /analyses/{id}`; nothing is replayed locally.
 */

import { ApiError, errorFromResponse, isAbortError } from "./client";
import { DEFAULT_API_BASE } from "./client";
import type { AnalysisEvent, EventName } from "./types";
import { EVENT_NAMES, isEventName, isTerminalEvent } from "./types";

/* ── frame parser (WHATWG EventSource grammar) ───────────── */

export interface SseFrame {
  id: string | null;
  event: string | null;
  data: string;
  retry: number | null;
}

/**
 * Incremental parser: feed text chunks in any split, get complete frames
 * back. Handles `\n`, `\r\n` and `\r` line endings, `:` comment lines
 * (keepalives), multi-line `data:`, a leading BOM and unknown fields.
 */
export class SseParser {
  private buffer = "";
  private data: string[] = [];
  private eventName: string | null = null;
  private id: string | null = null;
  private retry: number | null = null;
  private hasFields = false;
  private first = true;

  feed(chunk: string): SseFrame[] {
    if (this.first) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      this.first = false;
    }
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const match = /\r\n|\n|\r/.exec(this.buffer);
      if (!match) break;
      /* a lone \r at the very end could be the first half of \r\n */
      if (match[0] === "\r" && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Flush a trailing frame that was never terminated by a blank line. */
  end(): SseFrame[] {
    const frames: SseFrame[] = [];
    if (this.buffer.length > 0) {
      const frame = this.line(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
      if (frame) frames.push(frame);
    }
    const last = this.dispatch();
    if (last) frames.push(last);
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null; /* comment / keepalive */
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventName = value;
        this.hasFields = true;
        break;
      case "data":
        this.data.push(value);
        this.hasFields = true;
        break;
      case "id":
        if (!value.includes("\0")) this.id = value;
        this.hasFields = true;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        this.hasFields = true;
        break;
      default:
        break; /* unknown fields are ignored per spec */
    }
    return null;
  }

  private dispatch(): SseFrame | null {
    if (!this.hasFields) return null;
    const frame: SseFrame = {
      id: this.id,
      event: this.eventName,
      data: this.data.join("\n"),
      retry: this.retry,
    };
    this.data = [];
    this.eventName = null;
    this.retry = null;
    this.hasFields = false;
    /* per spec the last event id persists across frames; the backend sets it on every event */
    return frame;
  }
}

/** Decode one frame into a typed event, or null if it is not an analysis event. */
export function parseAnalysisEvent(frame: SseFrame): AnalysisEvent | null {
  if (!frame.event || !isEventName(frame.event)) return null;
  return decodeEventData(frame.event, frame.data);
}

export function decodeEventData(name: EventName, data: string): AnalysisEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.analysis_id !== "string" || typeof record.seq !== "number") return null;
  return { ...record, event: name } as AnalysisEvent;
}

/* ── the stream handle ───────────────────────────────────── */

export type StreamFallbackReason =
  | { kind: "http"; error: ApiError }
  | { kind: "closed"; message: string }
  | { kind: "exhausted"; attempts: number }
  | { kind: "ended"; message: string };

export interface AnalysisStreamHandlers {
  /** Every new event in seq order; replayed duplicates are dropped before this. */
  onEvent: (event: AnalysisEvent) => void;
  onOpen?: () => void;
  /** The transport lost the connection and is about to retry. */
  onReconnecting?: (info: { attempt: number; lastEventId: number | null }) => void;
  /** Fired once, after `onEvent`, for `analysis.completed` / `analysis.failed`. */
  onTerminal?: (event: AnalysisEvent) => void;
  /** Fired once when the stream cannot be recovered; read `GET /analyses/{id}`. */
  onFallback: (reason: StreamFallbackReason) => void;
  /** A well-formed frame with an unknown event name (forward compatibility). */
  onUnknownEvent?: (frame: SseFrame) => void;
}

export interface AnalysisStreamOptions {
  baseUrl?: string;
  /** "auto" picks EventSource when the global exists, otherwise fetch. */
  transport?: "auto" | "eventsource" | "fetch";
  /** Resume after this seq (e.g. from a previous handle's `lastEventId`). */
  after?: number | null;
  /** Consecutive reconnects without a new event before giving up. Default 5. */
  maxReconnects?: number;
  /** Delay before a fetch-transport reconnect when the stream sent no `retry:`. */
  retryDelayMs?: number;
  signal?: AbortSignal;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  EventSource?: EventSourceConstructor;
}

export interface AnalysisStreamHandle {
  close: () => void;
  readonly transport: "eventsource" | "fetch";
  /** Seq of the last event delivered (or the `after` we started from). */
  readonly lastEventId: number | null;
  readonly closed: boolean;
}

/** Minimal structural type so tests can supply a fake EventSource. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: MessageEvent<string> | Event) => void) => void;
  close: () => void;
}
export type EventSourceConstructor = new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;

const ES_CONNECTING = 0;
const ES_CLOSED = 2;

export function eventsUrl(baseUrl: string, analysisId: string, after: number | null): string {
  const base = `${baseUrl.replace(/\/+$/, "")}/analyses/${encodeURIComponent(analysisId)}/events`;
  return after !== null && after > 0 ? `${base}?after=${after}` : base;
}

export function openAnalysisEvents(
  analysisId: string,
  handlers: AnalysisStreamHandlers,
  options: AnalysisStreamOptions = {},
): AnalysisStreamHandle {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const maxReconnects = options.maxReconnects ?? 5;
  const EventSourceImpl =
    options.EventSource ?? (typeof EventSource !== "undefined" ? (EventSource as unknown as EventSourceConstructor) : undefined);
  const transport: "eventsource" | "fetch" =
    options.transport === "fetch" || (options.transport !== "eventsource" && !EventSourceImpl) ? "fetch" : "eventsource";
  if (transport === "eventsource" && !EventSourceImpl) {
    throw new Error("EventSource transport requested but no EventSource implementation is available.");
  }

  const state = {
    lastEventId: options.after ?? null,
    closed: false,
    finished: false, /* terminal delivered or fallback signalled */
    attempts: 0,
  };

  const finish = (fn: () => void) => {
    if (state.finished) return;
    state.finished = true;
    fn();
  };

  /** Shared per-frame policy: dedupe by seq, deliver, stop on terminal. Returns true when terminal. */
  const deliver = (frame: SseFrame): boolean => {
    if (!frame.event) return false;
    if (!isEventName(frame.event)) {
      handlers.onUnknownEvent?.(frame);
      return false;
    }
    const event = decodeEventData(frame.event, frame.data);
    if (!event || event.analysis_id !== analysisId) return false;
    if (state.lastEventId !== null && event.seq <= state.lastEventId) return false;
    state.lastEventId = event.seq;
    state.attempts = 0;
    handlers.onEvent(event);
    if (isTerminalEvent(event.event)) {
      finish(() => handlers.onTerminal?.(event));
      return true;
    }
    return false;
  };

  let closeTransport: () => void = () => {};

  if (transport === "eventsource") {
    const es = new EventSourceImpl!(eventsUrl(baseUrl, analysisId, state.lastEventId));
    closeTransport = () => es.close();
    es.addEventListener("open", () => handlers.onOpen?.());
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, (raw) => {
        if (state.closed) return;
        const message = raw as MessageEvent<string>;
        const terminal = deliver({ id: message.lastEventId ?? null, event: name, data: message.data, retry: null });
        if (terminal) close();
      });
    }
    es.addEventListener("error", () => {
      if (state.closed) return;
      if (es.readyState === ES_CLOSED) {
        /* the browser gave up: a non-200 status, a wrong content type, or a redirect it refuses */
        close();
        finish(() => handlers.onFallback({ kind: "closed", message: "The event stream was closed by the browser." }));
        return;
      }
      if (es.readyState === ES_CONNECTING) {
        state.attempts += 1;
        if (state.attempts > maxReconnects) {
          close();
          finish(() => handlers.onFallback({ kind: "exhausted", attempts: state.attempts - 1 }));
          return;
        }
        handlers.onReconnecting?.({ attempt: state.attempts, lastEventId: state.lastEventId });
      }
    });
  } else {
    const fetchImpl = options.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    closeTransport = () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };

    const run = async (): Promise<void> => {
      let retryDelay = options.retryDelayMs ?? 1000;
      while (!state.closed && !state.finished) {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (state.lastEventId !== null && state.lastEventId > 0) headers["last-event-id"] = String(state.lastEventId);
        let response: Response;
        try {
          response = await fetchImpl(eventsUrl(baseUrl, analysisId, state.lastEventId), {
            headers,
            signal: controller.signal,
            credentials: "same-origin",
            cache: "no-store",
          });
        } catch (cause) {
          if (state.closed || isAbortError(cause)) return;
          if (!(await backoff())) return;
          continue;
        }
        if (!response.ok) {
          const error = await errorFromResponse(response);
          close();
          finish(() => handlers.onFallback({ kind: "http", error }));
          return;
        }
        handlers.onOpen?.();
        const body = response.body;
        if (!body) {
          if (!(await backoff())) return;
          continue;
        }
        const reader = body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        let sawEvent = false;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            const frames = done ? parser.end() : parser.feed(decoder.decode(value, { stream: true }));
            for (const frame of frames) {
              if (frame.retry !== null) retryDelay = frame.retry;
              if (frame.event) sawEvent = true;
              if (deliver(frame)) {
                close();
                return;
              }
            }
            if (done) break;
          }
        } catch (cause) {
          if (state.closed || isAbortError(cause)) return;
        }
        /* the stream ended without a terminal event: reconnect from the last id */
        if (sawEvent) state.attempts = 0;
        if (!(await backoff())) return;
      }

      async function backoff(): Promise<boolean> {
        state.attempts += 1;
        if (state.attempts > maxReconnects) {
          close();
          finish(() => handlers.onFallback({ kind: "exhausted", attempts: state.attempts - 1 }));
          return false;
        }
        handlers.onReconnecting?.({ attempt: state.attempts, lastEventId: state.lastEventId });
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, retryDelay);
        });
        return !state.closed;
      }
    };
    void run();
  }

  function close(): void {
    if (state.closed) return;
    state.closed = true;
    closeTransport();
  }

  options.signal?.addEventListener("abort", close, { once: true });

  return {
    close,
    transport,
    get lastEventId() {
      return state.lastEventId;
    },
    get closed() {
      return state.closed;
    },
  };
}
