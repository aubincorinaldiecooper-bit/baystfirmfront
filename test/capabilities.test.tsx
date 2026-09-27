/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* vitest runs without globals, so Testing Library cannot register its own cleanup */
afterEach(cleanup);
import { BayApiClient } from "@/lib/api/client";
import { loadCapabilities, profileUnavailableMessage, toCapabilitiesView, useCapabilities } from "@/lib/api/capabilities";
import type { Capabilities } from "@/lib/api/types";

const CAPABILITIES: Capabilities = {
  profiles: {
    fast: { available: true, context_ceiling: 32768, reason: null, code: null },
    deep: { available: false, context_ceiling: 131072, reason: "not enough free memory for a 128K context", code: "MEMORY_PRESSURE" },
  },
  voice: false,
  deployment: "local",
  research: true,
  execution: { spark_mode: "managed", whisper_mode: "disabled", deployment: "local", search_configured: false },
};

function clientReturning(status: number, body: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  return { client: new BayApiClient({ fetch: fetchImpl }), fetchImpl };
}

function Probe({ client }: { client: BayApiClient }) {
  const { status, capabilities, error, reload } = useCapabilities(client);
  return (
    <div>
      <span data-testid="status">{status}</span>
      {capabilities && (
        <ul>
          <li data-testid="fast">{capabilities.profiles.fast.available ? "fast:on" : "fast:off"}</li>
          <li data-testid="deep">{capabilities.profiles.deep.available ? "deep:on" : `deep:off:${capabilities.profiles.deep.code}`}</li>
          <li data-testid="default">{capabilities.defaultProfile}</li>
        </ul>
      )}
      {error && <span data-testid="error">{error.code}</span>}
      <button type="button" onClick={reload}>
        reload
      </button>
    </div>
  );
}

describe("toCapabilitiesView", () => {
  it("exposes availability, reasons, codes and the default profile", () => {
    const view = toCapabilitiesView(CAPABILITIES);
    expect(view.profiles.fast).toEqual({ profile: "fast", available: true, contextCeiling: 32768, reason: null, code: null });
    expect(view.profiles.deep).toMatchObject({ available: false, code: "MEMORY_PRESSURE", reason: "not enough free memory for a 128K context" });
    expect(view.defaultProfile).toBe("fast");
    expect(view.anyProfileAvailable).toBe(true);
    expect(view.voice).toBe(false);
  });

  it("never assumes a profile the backend did not report", () => {
    const view = toCapabilitiesView({ ...CAPABILITIES, profiles: { deep: CAPABILITIES.profiles.deep } });
    expect(view.profiles.fast.available).toBe(false);
    expect(view.defaultProfile).toBeNull();
    expect(view.anyProfileAvailable).toBe(false);
  });

  it("produces the concise product copy for an unavailable profile", () => {
    const view = toCapabilitiesView(CAPABILITIES);
    expect(profileUnavailableMessage(view.profiles.deep)).toBe("Deep analysis isn't available on this machine right now. Try Fast.");
    expect(profileUnavailableMessage(view.profiles.fast)).toBeNull();
    expect(profileUnavailableMessage({ ...view.profiles.fast, available: false, code: "SPARK_START_FAILED" })).toMatch(/synthesis model/);
  });
});

describe("useCapabilities", () => {
  it("loads once per client and shares the result", async () => {
    const { client, fetchImpl } = clientReturning(200, CAPABILITIES);
    render(
      <>
        <Probe client={client} />
        <Probe client={client} />
      </>,
    );
    expect(screen.getAllByTestId("status")[0].textContent).toBe("loading");
    await waitFor(() => expect(screen.getAllByTestId("status").map((n) => n.textContent)).toEqual(["ready", "ready"]));
    expect(screen.getAllByTestId("deep")[0].textContent).toBe("deep:off:MEMORY_PRESSURE");
    expect(screen.getAllByTestId("default")[0].textContent).toBe("fast");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(loadCapabilities(client)).resolves.toEqual(CAPABILITIES);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces an ApiError and reloads on demand", async () => {
    const { client, fetchImpl } = clientReturning(503, { error: { code: "SPARK_START_FAILED", message: "no runtime", retryable: true } });
    render(<Probe client={client} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("SPARK_START_FAILED");
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(CAPABILITIES), { status: 200, headers: { "content-type": "application/json" } }));
    await act(async () => {
      screen.getByText("reload").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
