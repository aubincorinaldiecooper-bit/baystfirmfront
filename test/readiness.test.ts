import { describe, expect, it, vi } from "vitest";
import { checkBayReadiness } from "@/lib/server/readiness";

const config = { apiUrl: "https://backend.example/api/v1", apiKey: "secret" };

describe("production readiness", () => {
  it("is ready only when the backend health endpoint is reachable", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
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
});
