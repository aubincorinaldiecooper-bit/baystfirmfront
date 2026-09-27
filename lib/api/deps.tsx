"use client";

/**
 * The API client and the event-stream opener the UI uses, provided through
 * context so tests (and nothing else) can substitute stubs. The defaults are
 * the shared same-origin client (`/api/bay/*`) and the real SSE handle.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { bayApi, type BayApiClient } from "./client";
import { openAnalysisEvents } from "./sse";

export interface ApiDeps {
  client: BayApiClient;
  openStream: typeof openAnalysisEvents;
}

const DEFAULT_DEPS: ApiDeps = { client: bayApi, openStream: openAnalysisEvents };

const ApiDepsContext = createContext<ApiDeps>(DEFAULT_DEPS);

export function ApiDepsProvider({ value, children }: { value: Partial<ApiDeps>; children: ReactNode }) {
  const { client = DEFAULT_DEPS.client, openStream = DEFAULT_DEPS.openStream } = value;
  const deps = useMemo(() => ({ client, openStream }), [client, openStream]);
  return <ApiDepsContext.Provider value={deps}>{children}</ApiDepsContext.Provider>;
}

export function useApiDeps(): ApiDeps {
  return useContext(ApiDepsContext);
}
