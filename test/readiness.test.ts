import { describe, expect, it, vi } from "vitest";
import { checkBayReadiness } from "@/lib/server/readiness";

const config = { apiUrl: "https://backend.example/api/v1", apiKey: "secret" };

describe("production readiness", () => {
  it("is ready when the backend reports status ok", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
      return new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await checkBayReadiness({ config, fetch });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 when the backend is unreachable", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await checkBayReadiness({ config, fetch });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "backend_unreachable" });
  });

  it("returns 503 when the backend rejects the health request", async () => {
    const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const response = await checkBayReadiness({ config, fetch });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "backend_unhealthy", upstream_status: 401 });
  });

  it.each(["degraded", "down"])("returns 503 when the backend reports %s", async (backendStatus) => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: backendStatus, version: "0.1.0", components: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const response = await checkBayReadiness({ config, fetch });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "backend_not_ready", backend_status: backendStatus });
  });

  it("returns 503 when a 2xx body is not the backend health JSON", async () => {
    for (const body of ["<html>proxy page</html>", '{"status":"starting"}', "[]"]) {
      const fetch = vi.fn(async () => new Response(body, { status: 200 }));
      const response = await checkBayReadiness({ config, fetch });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "backend_not_ready", backend_status: "unknown" });
    }
  });
});
