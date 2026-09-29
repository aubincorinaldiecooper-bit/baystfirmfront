import "server-only";

import { readBayServerConfig, type BayServerConfig } from "./env";

export interface ReadinessDeps {
  fetch?: typeof fetch;
  config?: BayServerConfig;
  timeoutMs?: number;
}

export async function checkBayReadiness(deps: ReadinessDeps = {}): Promise<Response> {
  let config: BayServerConfig;
  try {
    config = deps.config ?? readBayServerConfig();
  } catch {
    return Response.json({ status: "misconfigured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000);
  const headers = new Headers({ accept: "application/json" });
  if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);

  try {
    const upstream = await (deps.fetch ?? fetch)(`${config.apiUrl}/health`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return Response.json(
        { status: "backend_unhealthy", upstream_status: upstream.status },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json({ status: "ok" }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "backend_unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timeout);
  }
}
